/**
 * HeroField — the homepage CROWN JEWEL.
 *
 * A GPU-driven (GPGPU FBO ping-pong) curl-noise particle field that DENOISES,
 * on scroll, into the real caffeine ball-and-stick molecule — then disperses as
 * you leave the hero. This is Andrew's beloved "real iterative diffusion": a
 * divergence-free curl-noise flow keeps ~262k particles swirling organically
 * (never collapsing), and a baked target texture lets the vertex shader
 * `mix(simPos, targetPos, smoothstep(uProgress))` crisp the cloud into a
 * recognizable molecule as curl jitter fades to nothing.
 *
 * Architecture (per the research blueprint, §1+§2+§3a):
 *   - GPUComputationRenderer holds a position + velocity float texture.
 *   - velocity shader = curl(simplex noise) advection + gentle pull-home so the
 *     cloud breathes around a sphere instead of flying off; speed-clamped.
 *   - position shader = Euler-integrate velocity, capped delta.
 *   - a baked TARGET position+color DataTexture (one texel per particle) from the
 *     caffeine PDB skeleton (shapes.caffeineTarget — no faked geometry).
 *   - Points render: VS samples sim + target, lerps by uProgress, adds curl
 *     jitter that fades as uProgress→1; FS draws a soft additive radial sprite.
 *
 * Smoothness (Andrew's #1 rule): capped delta, DPR≤2, frustumCulled=false,
 * IntersectionObserver pauses compute offscreen (handled by core's loop), no
 * per-frame allocation, eased scroll. Reduced motion → frozen formed molecule,
 * zero compute. Fallback: if WebGL2 float render targets are unavailable (or the
 * swiftshader test renderer can't run GPGPU), a CPU Points morph renders instead
 * so the hero NEVER breaks.
 *
 * ADAPTIVE COST (handle.onQuality, §Performance budget): the hero always renders
 * at full rate, so its GPGPU compute + 262k-point draw is a steady GPU load. When
 * the global governor reports the page is GPU-bound (q drops 1 → 0.75 → 0.5), the
 * hero scales ITSELF down without hurting the look on capable machines:
 *   - active particle count eases down via a SHUFFLED draw range (the refs are
 *     permuted once so dropping the tail removes a spatially-uniform subset of
 *     BOTH the swirling cloud and the formed molecule — no chunk pops out);
 *   - the GPGPU compute step is throttled to ~30fps (the denoise reads smooth
 *     even when the sim only advances every other frame — render still samples
 *     the latest position texture every frame);
 *   - point size + additive alpha ease UP slightly to keep the cloud's density
 *     and luminance constant as the count thins.
 * All transitions are eased per-frame (no popping) and reverse when q recovers.
 * At q=1 the full-quality denoise-into-caffeine is byte-identical to before.
 */
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';
import { caffeineTarget, CAFFEINE_RADIUS } from './shapes';

// World radius the molecule + cloud are fit to.
const R = 22;

/* ----------------------------- shared GLSL ------------------------------- */
// Ashima/webgl-noise simplex (snoise) + curl. Used by the GPGPU velocity shader
// and the render vertex shader's fading jitter.
const SNOISE = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  vec3 snoiseVec3(vec3 x){
    return vec3(snoise(x), snoise(x+vec3(123.4,234.5,345.6)), snoise(x+vec3(456.7,567.8,678.9)));
  }
  vec3 curlNoise(vec3 p){
    const float e=0.1; vec3 dx=vec3(e,0.0,0.0), dy=vec3(0.0,e,0.0), dz=vec3(0.0,0.0,e);
    vec3 px0=snoiseVec3(p-dx), px1=snoiseVec3(p+dx);
    vec3 py0=snoiseVec3(p-dy), py1=snoiseVec3(p+dy);
    vec3 pz0=snoiseVec3(p-dz), pz1=snoiseVec3(p+dz);
    float x=(py1.z-py0.z)-(pz1.y-pz0.y);
    float y=(pz1.x-pz0.x)-(px1.z-px0.z);
    float z=(px1.y-px0.y)-(py1.x-py0.x);
    return normalize(vec3(x,y,z)/(2.0*e));
  }
`;

// GPGPU velocity update: curl-noise force + soft spring back toward a sphere
// shell so the field stays framed, speed-clamped, damped.
const velocityFrag = /* glsl */ `
  uniform float uTime;
  uniform float uDelta;
  uniform float uRadius;
  ${SNOISE}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D( texturePosition, uv ).xyz;
    vec3 vel = texture2D( textureVelocity, uv ).xyz;

    // curl-noise flow (divergence-free → organic swirl, never collapses)
    vec3 curl = curlNoise( pos * 0.045 + vec3(0.0, 0.0, uTime * 0.05) );
    vel += curl * uDelta * 9.0;

    // gentle spring back to a sphere shell of radius ~uRadius so the cloud
    // breathes in frame instead of dispersing to infinity
    float dist = length(pos);
    vec3 dir = dist > 0.0001 ? pos / dist : vec3(0.0);
    vel -= dir * (dist - uRadius * 0.92) * uDelta * 1.2;

    // damping + speed clamp (keeps it buttery, no blowups after tab-away)
    vel *= 0.96;
    float sp = length(vel);
    float maxSp = uRadius * 1.4;
    if (sp > maxSp) vel = vel / sp * maxSp;

    gl_FragColor = vec4(vel, 1.0);
  }
`;

const positionFrag = /* glsl */ `
  uniform float uDelta;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D( texturePosition, uv );
    vec3 vel = texture2D( textureVelocity, uv ).xyz;
    pos.xyz += vel * uDelta;
    gl_FragColor = pos;
  }
`;

// Render vertex shader: sample sim + target, blend by uProgress; fade curl
// jitter as the molecule forms; perspective-soft point size.
const renderVert = /* glsl */ `
  attribute vec2 aRef;          // this particle's texel in the sim/target textures
  uniform sampler2D texturePosition;
  uniform sampler2D uTarget;
  uniform sampler2D uTargetColor;
  uniform float uProgress;      // 0 = free cloud, 1 = crisp molecule
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec3 uCloudColor;
  varying vec3 vColor;
  varying float vForm;
  ${SNOISE}
  void main() {
    vec3 simPos = texture2D( texturePosition, aRef ).xyz;
    vec3 tgtPos = texture2D( uTarget, aRef ).xyz;
    vec3 tgtCol = texture2D( uTargetColor, aRef ).xyz;

    float form = smoothstep(0.0, 1.0, uProgress);
    vec3 pos = mix(simPos, tgtPos, form);

    // curl jitter that DENOISES away as the molecule forms (form→1 ⇒ 0 jitter)
    float jitter = (1.0 - form);
    vec3 jit = curlNoise(simPos * 0.06 + uTime * 0.08) * jitter * 1.6;
    pos += jit;

    vColor = mix(uCloudColor, tgtCol, form);
    vForm = form;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // perspective-soft size; molecule points crisp up a touch as they settle
    float size = uSize * (0.85 + 0.35 * form);
    gl_PointSize = size * uPixelRatio * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const renderFrag = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vForm;
  uniform float uAlpha;     // global alpha scale (lower for very dense GPGPU clouds)
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // Sprite tightens as the molecule forms: the cloud is a soft additive haze,
    // but formed points become crisp dots (tight core, fast falloff) so the
    // ball-and-stick structure stays legible instead of summing into a blob.
    float core = smoothstep(0.5, 0.0, d);
    float edge = mix(0.10, 0.34, vForm);          // disc tightens as it forms
    float alpha = smoothstep(0.5, edge, d);
    vec3 col = mix(vColor, vec3(1.0), core * (0.08 + 0.12 * vForm));
    // CRITICAL: as particles pile onto the thin molecule, additive overlap would
    // blow out to white. Drop alpha HARD with form so the structure reads as a
    // porous glowing ball-and-stick, never a white blob (Andrew principle #9).
    gl_FragColor = vec4(col, alpha * uAlpha * (1.0 - 0.62 * vForm));
  }
`;

// CPU fallback vertex shader (positions/colors fed from CPU buffers).
const cpuVert = /* glsl */ `
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vForm;
  void main() {
    vColor = aColor;
    vForm = 1.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

/* ----------------------------- the scene --------------------------------- */
export function heroField(handle: SceneHandle) {
  const { ctx, onFrame, onDispose, onQuality } = handle;
  const { scene, camera, renderer } = ctx;
  const reduced = prefersReducedMotion();

  camera.position.set(0, 0, 42);
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();
  scene.add(group);

  // --- capability detection: WebGL2 + float render targets required for GPGPU.
  const gl = renderer.getContext();
  const isWebGL2 = (renderer.capabilities as any).isWebGL2 ??
    (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
  const hasColorBufferFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('WEBGL_color_buffer_float'));
  // Test/CI override (swiftshader): window.__HERO_FORCE_CPU__ = true forces the
  // CPU fallback path so we can verify it renders without real float targets.
  const forceCPU = typeof window !== 'undefined' && (window as any).__HERO_FORCE_CPU__ === true;

  // Texture size: 512² (~262k) desktop, 256² (~65k) weaker GPUs / mobile.
  const mobile = ctx.width < 760 ||
    (typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent));
  const maxTex = (renderer.capabilities as any).maxTextureSize ?? 4096;
  const WIDTH = (mobile || maxTex < 4096) ? 256 : 512;
  const COUNT = WIDTH * WIDTH;

  const cloudColor = new THREE.Color(PALETTE.cyan).lerp(new THREE.Color(PALETTE.blue), 0.35);
  const dpr = Math.min(renderer.getPixelRatio(), 2);
  // Molecule fit: a touch larger than R so the ball-and-stick fills the frame.
  const molScale = (R * 1.15) / CAFFEINE_RADIUS;

  /* ----------------------------- try GPGPU ------------------------------ */
  // GPGPU drives WIDTH² particles entirely on the GPU (262k desktop / 65k weak).
  let gpu: GPUComputationRenderer | null = null;
  let positionVariable: any = null;
  let velocityVariable: any = null;
  let usedGPGPU = false;

  // Reduced motion wants a single STATIC molecule frame with no compute — the
  // CPU path bakes the molecule straight into the vertex buffer, so it renders
  // correctly in one frame (the GPGPU path needs compute passes to settle). So
  // under reduced motion we deliberately take the lightweight CPU path.
  if (isWebGL2 && hasColorBufferFloat && !forceCPU && !reduced) {
    try {
      gpu = new GPUComputationRenderer(WIDTH, WIDTH, renderer);
      const dtPos = gpu.createTexture();
      const dtVel = gpu.createTexture();
      seedPositionTexture(dtPos, WIDTH, R);
      seedVelocityTexture(dtVel, WIDTH);

      velocityVariable = gpu.addVariable('textureVelocity', velocityFrag, dtVel);
      positionVariable = gpu.addVariable('texturePosition', positionFrag, dtPos);
      gpu.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
      gpu.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

      velocityVariable.material.uniforms.uTime = { value: 0 };
      velocityVariable.material.uniforms.uDelta = { value: 0 };
      velocityVariable.material.uniforms.uRadius = { value: R };
      positionVariable.material.uniforms.uDelta = { value: 0 };

      const err = gpu.init();
      if (err !== null) throw new Error(err);
      usedGPGPU = true;
    } catch {
      // float-target / GPGPU not actually usable (e.g. swiftshader) → fall back
      gpu = null;
      usedGPGPU = false;
    }
  }

  // Render particle count: GPGPU uses the full sim grid; the CPU fallback uses a
  // far smaller cloud (the CPU can't move 262k points at 60fps), which ALSO reads
  // crisper as a molecule. One texel/vertex per particle either way.
  const RENDER_W = usedGPGPU ? WIDTH : (mobile ? 64 : 90); // 90²≈8100, 64²≈4096
  const RENDER_COUNT = RENDER_W * RENDER_W;

  // ---- bake the caffeine TARGET (one entry per RENDERED particle) ---------
  const targetPos = new Float32Array(RENDER_COUNT * 3);
  const targetCol = new Float32Array(RENDER_COUNT * 3);
  caffeineTarget(targetPos, targetCol, RENDER_COUNT, molScale);

  // references (texel uv per particle) for the GPGPU render shader.
  // The texel index order is SHUFFLED (fixed permutation) so that rendering only
  // the first `n` vertices (adaptive draw range) yields a spatially-uniform
  // subset of both the cloud and the molecule — dropping the tail never carves a
  // contiguous chunk (e.g. all the bond particles) out of the formed structure.
  // aRef indexes the sim AND the target textures identically, so the shuffle
  // keeps each particle paired to its own cloud-texel and molecule-texel.
  const refs = new Float32Array(RENDER_COUNT * 2);
  {
    const order = new Uint32Array(RENDER_COUNT);
    for (let i = 0; i < RENDER_COUNT; i++) order[i] = i;
    // Deterministic Fisher–Yates (mulberry32) — stable across reloads, no global
    // RNG dependence, runs once at build (not per frame).
    let s = 0x9e3779b9 >>> 0;
    const rand = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = RENDER_COUNT - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    for (let i = 0; i < RENDER_COUNT; i++) {
      const src = order[i];
      refs[i * 2] = (src % RENDER_W) / RENDER_W;
      refs[i * 2 + 1] = Math.floor(src / RENDER_W) / RENDER_W;
    }
  }

  /* ----------------------------- geometry ------------------------------- */
  const geo = new THREE.BufferGeometry();
  const cpuPositions = new Float32Array(RENDER_COUNT * 3); // CPU path only
  const cpuColors = new Float32Array(RENDER_COUNT * 3);    // CPU path only
  geo.setAttribute('position', new THREE.BufferAttribute(cpuPositions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
  geo.setAttribute('aColor', new THREE.BufferAttribute(cpuColors, 3).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R * 3);

  // target textures (only needed by the GPGPU render material)
  let targetTex: THREE.DataTexture | null = null;
  let targetColTex: THREE.DataTexture | null = null;

  // point size: smaller when very dense (GPGPU 262k), larger for the sparse CPU cloud
  const pointSize = usedGPGPU ? (WIDTH === 512 ? 1.6 : 2.4) : 2.8;
  // global alpha: the denser the cloud, the lower per-point alpha must be so
  // additive overlap doesn't saturate to white (esp. once formed onto the molecule).
  const alphaScale = usedGPGPU ? (WIDTH === 512 ? 0.085 : 0.18) : 0.5;

  let renderMat: THREE.ShaderMaterial;
  if (usedGPGPU && gpu) {
    targetTex = makeDataTexture(targetPos, RENDER_W);
    targetColTex = makeDataTexture(targetCol, RENDER_W);
    renderMat = new THREE.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null },
        uTarget: { value: targetTex },
        uTargetColor: { value: targetColTex },
        uProgress: { value: reduced ? 1 : 0 },
        uTime: { value: 0 },
        uSize: { value: pointSize },
        uPixelRatio: { value: dpr },
        uCloudColor: { value: cloudColor },
        uAlpha: { value: alphaScale },
      },
      vertexShader: renderVert,
      fragmentShader: renderFrag,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  } else {
    renderMat = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: pointSize },
        uPixelRatio: { value: dpr },
        uAlpha: { value: alphaScale },
      },
      vertexShader: cpuVert,
      fragmentShader: renderFrag,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  }

  const points = new THREE.Points(geo, renderMat);
  points.frustumCulled = false;
  group.add(points);

  // expose the chosen render path (handy for debugging which path a device took)
  if (typeof window !== 'undefined') {
    (window as any).__HERO_PATH__ = usedGPGPU ? `gpgpu-${WIDTH}` : `cpu-${RENDER_W}`;
  }

  /* --------------------- CPU fallback state + ticker -------------------- */
  // Only allocated/used when usedGPGPU is false. RENDER_COUNT is small (~8k) so
  // the per-frame loop is cheap → buttery 60fps even under swiftshader.
  const cpuPhase = new Float32Array(usedGPGPU ? 0 : RENDER_COUNT);
  const cpuBase = new Float32Array(usedGPGPU ? 0 : RENDER_COUNT * 3);
  const cpuTick = (tt: number, prog: number) => {
    const form = prog * prog * (3 - 2 * prog); // smoothstep
    const jitter = (1 - form) * R * 0.14;
    for (let i = 0; i < RENDER_COUNT; i++) {
      const i3 = i * 3;
      const sx = cpuBase[i3] + Math.sin(tt * 0.6 + cpuPhase[i]) * jitter;
      const sy = cpuBase[i3 + 1] + Math.cos(tt * 0.5 + cpuPhase[i] * 1.3) * jitter;
      const sz = cpuBase[i3 + 2] + Math.sin(tt * 0.7 + cpuPhase[i] * 0.7) * jitter;
      cpuPositions[i3] = sx + (targetPos[i3] - sx) * form;
      cpuPositions[i3 + 1] = sy + (targetPos[i3 + 1] - sy) * form;
      cpuPositions[i3 + 2] = sz + (targetPos[i3 + 2] - sz) * form;
      cpuColors[i3] = cloudColor.r + (targetCol[i3] - cloudColor.r) * form;
      cpuColors[i3 + 1] = cloudColor.g + (targetCol[i3 + 1] - cloudColor.g) * form;
      cpuColors[i3 + 2] = cloudColor.b + (targetCol[i3 + 2] - cloudColor.b) * form;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
  };

  if (!usedGPGPU) {
    // seed a swirling cloud shell; fixed per-particle phase for cheap animation
    for (let i = 0; i < RENDER_COUNT; i++) {
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      const rr = R * (0.6 + 0.5 * Math.random());
      cpuBase[i * 3] = Math.sin(th) * Math.cos(ph) * rr;
      cpuBase[i * 3 + 1] = Math.sin(th) * Math.sin(ph) * rr;
      cpuBase[i * 3 + 2] = Math.cos(th) * rr;
      cpuPhase[i] = Math.random() * Math.PI * 2;
    }
    cpuTick(0, reduced ? 1 : 0); // initial fill (static molecule if reduced)
  }

  /* ----------------------------- scroll → progress ---------------------- */
  // Hero scroll forms the molecule. At the very top the cloud swirls (progress
  // small, gently oscillating so it's alive); scrolling down crisps it into the
  // molecule; past the hero it disperses gracefully.
  const heroProgress = () => {
    const vh = window.innerHeight || 1;
    const y = window.scrollY;
    // Form EARLY (crisp molecule by ~0.55vh) so it's admired while the hero text
    // is still on screen; hold formed; then disperse back to a cloud past ~1.2vh.
    const form = Math.min(1, y / (vh * 0.55));
    const disperse = Math.min(1, Math.max(0, (y - vh * 1.2) / (vh * 0.6)));
    return Math.max(0, form - disperse);
  };

  // Canvas fade: the field is a fixed full-screen overlay, so once the hero has
  // scrolled away we fade the whole canvas out (lower sections keep only the
  // page-wide MorphBackground — no double compositing / clutter).
  const canvas = renderer.domElement;
  const heroOpacity = () => {
    const vh = window.innerHeight || 1;
    const y = window.scrollY;
    return Math.min(1, Math.max(0, 1 - (y - vh * 1.25) / (vh * 0.5)));
  };

  let progress = reduced ? 1 : 0;

  /* --------------------- adaptive quality (governor) -------------------- */
  // The hero always renders at full rate, so it carries a steady GPU cost. When
  // the global governor reports the page is GPU-bound it calls onQuality(q) with
  // q stepping 1 → 0.75 → 0.5; we scale the hero's OWN work down (and back up)
  // smoothly. q=1 is byte-identical to the un-throttled full-quality look.
  //
  //   targetFrac     : fraction of particles drawn (eased via setDrawRange).
  //   computeStride  : run gpu.compute() every Nth frame (throttle the sim to
  //                    ~30fps when GPU-bound; the denoise reads smooth because
  //                    the render still samples the latest position texture
  //                    every frame — only the underlying swirl advances slower).
  // Sizes/alpha scale up a touch as the count thins so density + luminance hold.
  const Q_FRAC: Record<number, number> = { 1: 1, 0.75: 0.6, 0.5: 0.34 };
  const Q_STRIDE: Record<number, number> = { 1: 1, 0.75: 2, 0.5: 2 };
  let targetFrac = 1;          // where we're easing TO (set by onQuality)
  let activeFrac = 1;          // current eased fraction
  let computeStride = 1;       // 1 = every frame, 2 = ~30fps
  let computeAccum = 0;        // frames since last compute (throttle counter)

  // Only the GPGPU path adapts the draw range (the CPU fallback is already a tiny
  // sparse cloud — thinning it would just look sparse). Reduced motion is a static
  // single frame; nothing to throttle. Both keep the export signature intact.
  const applyQuality = (q: number) => {
    targetFrac = Q_FRAC[q] ?? 1;
    computeStride = Q_STRIDE[q] ?? 1;
    if (reduced || !usedGPGPU) targetFrac = 1; // keep full look on the static/CPU paths
  };
  onQuality(applyQuality);

  // DEV/test hook (tree-shaken from production): lets Playwright simulate a
  // governor quality drop/recovery without waiting for real GPU load, and read
  // back the live adaptive state to assert work actually scaled. Drives the EXACT
  // same applyQuality path the real governor uses.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as any).__HERO_FORCE_QUALITY__ = (q: number) => applyQuality(q);
    (window as any).__HERO_ADAPT__ = () => ({
      path: usedGPGPU ? `gpgpu-${WIDTH}` : `cpu-${RENDER_W}`,
      renderCount: RENDER_COUNT,
      targetFrac, activeFrac, computeStride,
      drawCount: (geo.drawRange.count === Infinity ? RENDER_COUNT : geo.drawRange.count),
      uSize: renderMat.uniforms.uSize?.value,
      uAlpha: renderMat.uniforms.uAlpha?.value,
    });
  }

  /* ----------------------------- frame loop ----------------------------- */
  onFrame((t, dt) => {
    const delta = Math.min(dt, 1 / 30); // cap delta → no blowups, buttery

    if (reduced) {
      // static formed molecule, no compute (core runs a single frame anyway)
      if (usedGPGPU) {
        renderMat.uniforms.uProgress.value = 1;
        if (gpu) renderMat.uniforms.texturePosition.value = gpu.getCurrentRenderTarget(positionVariable).texture;
      }
      group.rotation.y = 0.5;
      return;
    }

    // eased scroll progress (smooth, scrubbed — never snappy)
    const target = heroProgress();
    progress += (target - progress) * Math.min(1, delta * 4);

    // gentle "alive" breathing at the very top before the user scrolls
    const breathe = progress < 0.02 ? (Math.sin(t * 0.5) * 0.5 + 0.5) * 0.06 : 0;
    const formProgress = Math.min(1, progress + breathe);

    if (usedGPGPU && gpu) {
      // ease the active particle fraction toward the governor target (no popping)
      activeFrac += (targetFrac - activeFrac) * Math.min(1, delta * 3);
      // setDrawRange on the shuffled refs → spatially-uniform subset of cloud+mol.
      // (Floor to whole particles; clamp ≥1 so we never request a zero-count draw.)
      const drawCount = Math.max(1, Math.round(RENDER_COUNT * activeFrac));
      geo.setDrawRange(0, drawCount);
      // density/luminance compensation: fewer points → slightly bigger + brighter
      // so the cloud doesn't visibly thin. 1/sqrt(frac) keeps screen coverage ~flat.
      const comp = 1 / Math.sqrt(Math.max(0.2, activeFrac));
      renderMat.uniforms.uSize.value = pointSize * Math.min(comp, 1.7);
      renderMat.uniforms.uAlpha.value = alphaScale * Math.min(comp, 1.5);

      // throttle the GPGPU sim to ~30fps when GPU-bound: skip compute on the
      // off frames but accumulate their delta so the swirl speed is unchanged
      // when it DOES step (no slow-motion). Render samples the latest texture
      // every frame regardless → the eased denoise stays buttery-smooth.
      computeAccum += delta;
      const doCompute = computeStride <= 1 || (computeAccum >= (1 / 30));
      if (doCompute) {
        // Sim delta is still capped at 1/30 (the velocity shader's stable max) so
        // a throttled step never blows up; `delta` itself is already ≤1/30, so at
        // stride 1 this is identical to before.
        const simDelta = Math.min(computeAccum, 1 / 30);
        velocityVariable.material.uniforms.uTime.value = t;
        velocityVariable.material.uniforms.uDelta.value = simDelta;
        positionVariable.material.uniforms.uDelta.value = simDelta;
        gpu.compute();
        computeAccum = 0;
      }
      renderMat.uniforms.texturePosition.value = gpu.getCurrentRenderTarget(positionVariable).texture;
      renderMat.uniforms.uProgress.value = formProgress;
      renderMat.uniforms.uTime.value = t;
    } else {
      cpuTick(t, formProgress);
    }

    // slow cinematic spin; molecule settles upright as it forms
    group.rotation.y += delta * 0.06;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.12 - formProgress * 0.1, 0.04);

    // fade the fixed canvas out as the hero leaves (avoids overlaying lower sections)
    canvas.style.opacity = heroOpacity().toFixed(3);
  });

  onDispose(() => {
    geo.dispose();
    renderMat.dispose();
    targetTex?.dispose();
    targetColTex?.dispose();
    gpu?.dispose?.();
  });
}

/* ----------------------------- helpers ----------------------------------- */
function makeDataTexture(data: Float32Array, width: number): THREE.DataTexture {
  // pack RGB triplets into an RGBA float texture (one texel per particle)
  const rgba = new Float32Array(width * width * 4);
  for (let i = 0; i < width * width; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = 1;
  }
  const tex = new THREE.DataTexture(rgba, width, width, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

function seedPositionTexture(tex: THREE.DataTexture, width: number, r: number) {
  const a = tex.image.data as unknown as Float32Array;
  for (let i = 0; i < width * width; i++) {
    const th = Math.acos(2 * Math.random() - 1);
    const ph = Math.random() * Math.PI * 2;
    const rr = r * (0.55 + 0.55 * Math.random());
    a[i * 4] = Math.sin(th) * Math.cos(ph) * rr;
    a[i * 4 + 1] = Math.sin(th) * Math.sin(ph) * rr;
    a[i * 4 + 2] = Math.cos(th) * rr;
    a[i * 4 + 3] = 1;
  }
}

function seedVelocityTexture(tex: THREE.DataTexture, width: number) {
  const a = tex.image.data as unknown as Float32Array;
  for (let i = 0; i < width * width; i++) {
    a[i * 4] = (Math.random() - 0.5) * 0.4;
    a[i * 4 + 1] = (Math.random() - 0.5) * 0.4;
    a[i * 4 + 2] = (Math.random() - 0.5) * 0.4;
    a[i * 4 + 3] = 1;
  }
}
