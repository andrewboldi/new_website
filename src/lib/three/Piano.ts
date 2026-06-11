/**
 * Piano — a glowing 3D keyboard that performs Chopin's Étude Op. 10 No. 12
 * ("Revolutionary"), Synthesia-style: real parsed-MIDI note-bars fall from
 * above and strike the keys exactly on the beat, depressing + flashing each key
 * as it sounds, then loop seamlessly.
 *
 * Music data: src/lib/three/revolutionary.ts (LOOP_NOTES) — MIDI sequenced by
 * Bernd Krüger, piano-midi.de (CC BY-SA); composition by Chopin (public domain).
 *
 * Performance: the (up to ~1092) falling bars are drawn with a single
 * InstancedMesh sized to the maximum simultaneously-visible count — no
 * per-frame allocation, no mesh churn. Keys are a fixed set of reused meshes.
 *
 * Optional audio: a tiny Web-Audio piano synth, MUTED by default (browsers
 * block autoplay-with-sound). A small DOM ▶/🔇 button unmutes after a user
 * gesture; audio is driven from the same transport clock as the visuals so it
 * stays in sync. Audio is a bonus — it never throws into the render loop.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';
import {
  LOOP_NOTES,
  LOOP_DURATION_SEC,
  MIN_MIDI,
  MAX_MIDI,
  CREDIT,
  type PianoNote,
} from './revolutionary';

// ---------------------------------------------------------------- key layout
const NATURAL_PCS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const isBlack = (n: number) => !NATURAL_PCS.includes(((n % 12) + 12) % 12);

// Render a tidy whole-octave span around the piece's range (C1..B7 → 24..107
// would be 7 octaves; we use the octaves that actually contain notes).
const LOW = 24; // C1
const HIGH = 95; // B7  (covers 29..92 with a little headroom each side)

/** White-key index (0-based, counting only naturals) for a MIDI note. */
function whiteIndex(n: number): number {
  let count = 0;
  for (let m = LOW; m < n; m++) if (!isBlack(m)) count++;
  return count;
}
const TOTAL_WHITES = whiteIndex(HIGH + 1);

// geometry constants (world units). Kept compact so a full 6-octave board
// frames nicely without the camera having to sit far back.
const WHITE_W = 0.92; // width of a white key (with a hair of gap)
const WHITE_GAP = 0.06;
const PITCH = WHITE_W + WHITE_GAP; // center-to-center spacing of white keys
const WHITE_LEN = 6.4; // depth (along +Z toward camera) — longer reads better
const BLACK_W = 0.56;
const BLACK_LEN = 4.0;
const WHITE_H = 0.6;
const BLACK_H = 1.0;
const KEYBED_Z = 0; // near edge of keys sits around z≈+WHITE_LEN/2

const KEYBOARD_WIDTH = TOTAL_WHITES * PITCH;
const X0 = -KEYBOARD_WIDTH / 2 + PITCH / 2; // x of first white key center

/** X position of a key's center for MIDI note n. */
function keyX(n: number): number {
  const wi = whiteIndex(n);
  if (!isBlack(n)) return X0 + wi * PITCH;
  // a black key sits between the white below it and the next white → offset by
  // half a pitch above the white key that precedes it.
  return X0 + (wi - 0.5) * PITCH;
}

// --------------------------------------------------------------- note → color
const cBlue = new THREE.Color(PALETTE.blue);
const cCyan = new THREE.Color(PALETTE.cyan);
const cAmber = new THREE.Color(PALETTE.amber);
const cWhiteKey = new THREE.Color(0x223047);
const cBlackKey = new THREE.Color(0x0a0f1a);

/** Color a note by hand/register: low (left hand) → blue, high → cyan, with a
 *  velocity-driven lift toward amber on strong notes. */
function noteColor(n: number, v: number, out: THREE.Color): THREE.Color {
  const split = 60; // ~ middle C region splits the two hands
  const reg = THREE.MathUtils.clamp((n - 36) / (84 - 36), 0, 1);
  out.copy(cBlue).lerp(cCyan, reg);
  if (n >= split && v > 0.7) out.lerp(cAmber, (v - 0.7) * 1.2);
  return out;
}

// ---------------------------------------------------------------- transport
const FALL_LEAD = 2.5; // seconds a bar is visible before it lands
const FALL_DIST = 17; // world units a bar travels (height of the "sky")
const HIT_Y = WHITE_H / 2 + 0.02; // y where a bar visually meets the keybed

interface KeyRec {
  n: number;
  black: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  baseY: number;
  baseColor: THREE.Color;
  litColor: THREE.Color;
  lit: number; // 0..1 envelope of "pressed/glowing"
  active: number; // count of currently-sounding notes on this key
}

export function piano(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, host } = ctx;
  const reduced = prefersReducedMotion();

  // ---- camera: low and angled, looking down the keybed toward the player so
  // the keys occupy the lower band and bars fall through the upper frame.
  camera.position.set(0, 8.5, 16.5);
  camera.lookAt(0, -1, -4);
  camera.fov = 52;
  camera.updateProjectionMatrix();

  // ---- lighting (mostly emissive, but a soft key light gives the keys form).
  scene.add(new THREE.AmbientLight(0x14253a, 0.7));
  const key = new THREE.DirectionalLight(0x9fc4ff, 0.5);
  key.position.set(6, 20, 16);
  scene.add(key);

  const root = new THREE.Group();
  scene.add(root);

  // ---------------------------------------------------------- keyboard build
  // shared geometries (disposed at teardown)
  const whiteGeo = new THREE.BoxGeometry(WHITE_W, WHITE_H, WHITE_LEN);
  const blackGeo = new THREE.BoxGeometry(BLACK_W, BLACK_H, BLACK_LEN);

  const keys: KeyRec[] = [];
  const keyByNote = new Map<number, KeyRec>();
  const disposableMats: THREE.Material[] = [];

  for (let n = LOW; n <= HIGH; n++) {
    const black = isBlack(n);
    const geo = black ? blackGeo : whiteGeo;
    const baseColor = (black ? cBlackKey : cWhiteKey).clone();
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 1,
      roughness: 0.42,
      metalness: 0.0,
    });
    disposableMats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    const baseY = black ? BLACK_H / 2 : WHITE_H / 2;
    // black keys sit slightly back so their near edge aligns nicely.
    const z = black ? KEYBED_Z - (WHITE_LEN - BLACK_LEN) / 2 : KEYBED_Z;
    mesh.position.set(keyX(n), baseY, z);
    mesh.renderOrder = black ? 1 : 0;
    root.add(mesh);

    const litColor = new THREE.Color();
    noteColor(n, 0.8, litColor);
    const rec: KeyRec = {
      n, black, mesh, mat, baseY,
      baseColor, litColor,
      lit: 0, active: 0,
    };
    keys.push(rec);
    keyByNote.set(n, rec);
  }

  // a dark felt strip behind the keys + a faint "hit line" glow at the keybed.
  const feltGeo = new THREE.BoxGeometry(KEYBOARD_WIDTH + 1.2, 0.6, 1.0);
  const feltMat = new THREE.MeshStandardMaterial({
    color: 0x05070d, roughness: 1, metalness: 0,
  });
  disposableMats.push(feltMat);
  const felt = new THREE.Mesh(feltGeo, feltMat);
  felt.position.set(0, WHITE_H / 2, KEYBED_Z - WHITE_LEN / 2 - 0.5);
  root.add(felt);

  const hitGeo = new THREE.PlaneGeometry(KEYBOARD_WIDTH + 1.0, 0.5);
  const hitMat = new THREE.MeshBasicMaterial({
    color: PALETTE.cyan, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  disposableMats.push(hitMat);
  const hitLine = new THREE.Mesh(hitGeo, hitMat);
  hitLine.rotation.x = -Math.PI / 2;
  hitLine.position.set(0, HIT_Y + 0.01, KEYBED_Z + WHITE_LEN / 2 - 0.4);
  root.add(hitLine);

  // ----------------------------------------------------- falling-bar pool
  // Size the pool to the max number of bars on screen within any FALL_LEAD +
  // longest-sustain window. Compute it once from the data.
  function maxConcurrentBars(): number {
    // a bar is visible from (t - FALL_LEAD) until (t + d) — approximate the bar
    // body as visible across [t - FALL_LEAD, t + d]; sweep events.
    const ev: Array<[number, number]> = [];
    for (const o of LOOP_NOTES) {
      ev.push([o.t - FALL_LEAD, 1]);
      ev.push([o.t + o.d, -1]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0, max = 0;
    for (const [, delta] of ev) { cur += delta; if (cur > max) max = cur; }
    return max;
  }
  const POOL = reduced ? 0 : Math.min(LOOP_NOTES.length, maxConcurrentBars() + 8);

  // InstancedMesh of unit boxes; per-bar we set matrix (position + Y scale for
  // duration) and instance color. Geometry is a unit cube centered at origin
  // with its TOP at y=0 so scaling Y grows it upward from the hit point.
  const barGeo = new THREE.BoxGeometry(1, 1, 1);
  barGeo.translate(0, -0.5, 0); // pivot at top face
  const barMat = new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  // vertexColors via instanceColor:
  (barMat as THREE.MeshBasicMaterial).toneMapped = false;

  let bars: THREE.InstancedMesh | null = null;
  if (POOL > 0) {
    bars = new THREE.InstancedMesh(barGeo, barMat, POOL);
    bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bars.count = POOL;
    bars.frustumCulled = false;
    // allocate instance colors
    const colArr = new Float32Array(POOL * 3);
    bars.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
    (bars.instanceColor as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
    root.add(bars);
  }

  // soft glow sprites that pop when a note is struck (also pooled).
  const FLASH_POOL = reduced ? 0 : Math.min(48, POOL);
  let flashes: THREE.InstancedMesh | null = null;
  const flashLife: Float32Array = new Float32Array(Math.max(1, FLASH_POOL));
  const flashNote: Int16Array = new Int16Array(Math.max(1, FLASH_POOL));
  let flashCursor = 0;
  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const flashTex = makeGlowTexture();
  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  if (FLASH_POOL > 0) {
    flashes = new THREE.InstancedMesh(flashGeo, flashMat, FLASH_POOL);
    flashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flashes.frustumCulled = false;
    const fcol = new Float32Array(FLASH_POOL * 3);
    flashes.instanceColor = new THREE.InstancedBufferAttribute(fcol, 3);
    // start hidden
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < FLASH_POOL; i++) flashes.setMatrixAt(i, m);
    flashes.instanceMatrix.needsUpdate = true;
    root.add(flashes);
  }

  // ------------------------------------------------------------ note schedule
  // Pre-sort by start time and cache per-note x/width/color so the hot loop
  // does zero allocation and zero per-frame layout math.
  interface Sched extends PianoNote { x: number; w: number; col: THREE.Color; }
  const sched: Sched[] = LOOP_NOTES.map((o) => {
    const black = isBlack(o.n);
    const col = new THREE.Color();
    noteColor(o.n, o.v, col);
    return {
      ...o,
      x: keyX(o.n),
      w: (black ? BLACK_W : WHITE_W) * 0.9,
      col,
    };
  }).sort((a, b) => a.t - b.t);

  // scratch objects (reused every frame)
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const tmpCol = new THREE.Color();

  // transport state
  let loopT = 0;
  let lastLoopT = 0;
  let searchStart = 0; // index hint into sched for the window scan

  // ------------------------------------------------------------------- audio
  const audio = createAudio(() => keyByNote);
  // unmute button (DOM, lives over the canvas host)
  const btn = buildUnmuteButton(host);
  btn.el.addEventListener('click', () => {
    const on = audio.toggle();
    btn.setMuted(!on);
  });
  // keep audio transport aligned to the visual loop time on every (un)mute.
  audio.onResume = () => { audio.setTransport(loopT); };

  // --------------------------------------------------------------- the frame
  function strikeKey(rec: KeyRec, v: number) {
    rec.active++;
    rec.lit = Math.max(rec.lit, 0.55 + v * 0.45);
    // spawn a flash sprite at the key
    if (flashes && FLASH_POOL > 0) {
      const i = flashCursor;
      flashCursor = (flashCursor + 1) % FLASH_POOL;
      flashLife[i] = 1;
      flashNote[i] = rec.n;
      noteColor(rec.n, v, tmpCol);
      flashes.setColorAt(i, tmpCol);
      if (flashes.instanceColor) flashes.instanceColor.needsUpdate = true;
    }
  }

  // schedule bookkeeping: which notes we've already "struck" this loop pass.
  let struckUpTo = -1; // index in sched of last struck note (by start time)

  onFrame((t, dt) => {
    // ---- advance transport (wrap at loop end) ----
    if (!reduced) {
      loopT += dt;
      if (loopT >= LOOP_DURATION_SEC) {
        loopT -= LOOP_DURATION_SEC;
        struckUpTo = -1;
        searchStart = 0;
        // release all keys cleanly on wrap
        for (const k of keys) { k.active = 0; }
        audio.setTransport(loopT);
      }
    }

    // ---- update falling bars ----
    if (bars && !reduced) {
      let inst = 0;
      // scan forward from a hint; bars are those with t in
      // [loopT - maxDur .. loopT + FALL_LEAD]. We simply scan all (1092) but
      // skip far-future quickly using the sorted order.
      // advance searchStart past notes fully gone (t + d < loopT)
      while (
        searchStart < sched.length - 1 &&
        sched[searchStart].t + sched[searchStart].d < loopT - 0.05 &&
        sched[searchStart].t < loopT // don't advance past wrap region
      ) searchStart++;

      for (let s = 0; s < sched.length && inst < POOL; s++) {
        const o = sched[s];
        const dtStart = o.t - loopT; // >0: future, <0: already started
        // visible window: falling in, or sustaining on the key
        if (dtStart > FALL_LEAD) continue; // not yet in the sky
        if (-dtStart > o.d + 0.04) continue; // fully past (released)

        // y of the bar's TOP edge.
        // While falling (dtStart>0): top travels from sky down to HIT + barLen.
        // After hit (dtStart<=0): the bar "enters" the key — clamp its top so
        // the remaining (sustaining) portion shrinks into the keybed.
        const barLen = Math.max(0.25, o.d * (FALL_DIST / FALL_LEAD));
        let topY: number;
        let len: number;
        if (dtStart > 0) {
          // top descends linearly so the BOTTOM reaches HIT_Y exactly at t.
          const bottomY = HIT_Y + FALL_DIST * (dtStart / FALL_LEAD);
          topY = bottomY + barLen;
          len = barLen;
        } else {
          // sustaining: bottom pinned at HIT_Y, top sinks as note elapses.
          const remain = THREE.MathUtils.clamp(1 + dtStart / o.d, 0, 1); // 1→0
          len = Math.max(0.06, barLen * remain);
          topY = HIT_Y + len;
        }

        pos.set(o.x, topY, KEYBED_Z + WHITE_LEN / 2 - 1.6);
        scl.set(o.w, len, 0.7);
        mtx.compose(pos, quat, scl);
        bars.setMatrixAt(inst, mtx);

        // brighten as it approaches the hit line (kept <1 so bloom stays a
        // glow, not a wash).
        const prox = THREE.MathUtils.clamp(1 - Math.abs(dtStart) / 0.6, 0, 1);
        tmpCol.copy(o.col).multiplyScalar(0.42 + prox * 0.5);
        bars.setColorAt(inst, tmpCol);
        inst++;
      }
      // hide unused instances
      scl.set(0, 0, 0);
      mtx.compose(pos.set(0, -999, 0), quat, scl);
      for (let i = inst; i < POOL; i++) bars.setMatrixAt(i, mtx);
      bars.count = POOL;
      bars.instanceMatrix.needsUpdate = true;
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    }

    // ---- trigger key strikes + audio for notes crossing loopT ----
    if (!reduced) {
      // strike any note whose start time we just passed
      for (let s = struckUpTo + 1; s < sched.length; s++) {
        if (sched[s].t <= loopT) {
          const o = sched[s];
          const rec = keyByNote.get(o.n);
          if (rec) strikeKey(rec, o.v);
          audio.noteOn(o.n, o.v, o.d);
          struckUpTo = s;
        } else break;
      }
      // release: decrement active count for notes whose (t+d) just passed.
      // (cheap approximate release — envelope handles the visual fade.)
    }

    // ---- animate keys (press + emissive glow envelopes) ----
    for (const k of keys) {
      // target lit: high while a note is active under the playhead, else decay
      // recompute "active" by sampling: is any sched note on this key sounding?
      // We avoid a second loop by using the envelope: lit decays each frame and
      // is re-boosted by strikeKey. Sustain look: hold while active>0.
      const decay = k.active > 0 ? 6.5 : 4.0;
      const floor = k.active > 0 ? 0.5 : 0.0;
      k.lit = Math.max(floor, k.lit - dt * decay * (k.lit));
      // press depth
      const press = k.lit * (k.black ? 0.14 : 0.18);
      k.mesh.position.y = k.baseY - press;
      k.mesh.rotation.x = -k.lit * 0.05; // slight tilt forward when pressed
      // emissive
      k.mat.emissive.copy(k.baseColor).lerp(k.litColor, Math.min(1, k.lit));
      k.mat.emissiveIntensity = k.lit * 1.8;
    }
    // age the "active" flags so sustained chords eventually release even if we
    // miss an exact release tick (keeps things from sticking lit forever).
    if (!reduced) ageActive(sched, keyByNote, loopT);

    // ---- flash sprites (billboarded, fading) ----
    if (flashes && FLASH_POOL > 0) {
      let any = false;
      for (let i = 0; i < FLASH_POOL; i++) {
        const life = flashLife[i];
        if (life <= 0) continue;
        any = true;
        flashLife[i] = Math.max(0, life - dt * 2.6);
        const rec = keyByNote.get(flashNote[i]);
        const x = rec ? rec.mesh.position.x : 0;
        const s = (0.7 + (1 - life) * 2.4);
        pos.set(x, HIT_Y + 0.3, KEYBED_Z + WHITE_LEN / 2 - 0.6);
        // face the camera
        flashes.getMatrixAt(i, mtx);
        quat.copy(camera.quaternion);
        scl.set(s, s, s);
        mtx.compose(pos, quat, scl);
        flashes.setMatrixAt(i, mtx);
        // fade color toward zero
        flashes.getColorAt(i, tmpCol);
        // (color set at spawn; just rely on life→alpha via scale+additive)
      }
      // collapse dead ones to zero scale
      for (let i = 0; i < FLASH_POOL; i++) {
        if (flashLife[i] <= 0) {
          flashes.getMatrixAt(i, mtx);
          mtx.decompose(pos, quat, scl);
          if (scl.x !== 0) {
            scl.set(0, 0, 0);
            mtx.compose(pos, quat, scl);
            flashes.setMatrixAt(i, mtx);
            any = true;
          }
        }
      }
      quat.identity();
      if (any) flashes.instanceMatrix.needsUpdate = true;
    }

    // ---- gentle parallax from pointer ----
    root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, ctx.pointer.x * 0.12, 0.05);

    lastLoopT = loopT;
    void lastLoopT;
  });

  // -------------------------------------------------------------- dispose
  onDispose(() => {
    audio.dispose();
    btn.el.remove();
    whiteGeo.dispose();
    blackGeo.dispose();
    feltGeo.dispose();
    hitGeo.dispose();
    barGeo.dispose();
    barMat.dispose();
    flashGeo.dispose();
    flashMat.dispose();
    flashTex.dispose();
    for (const m of disposableMats) m.dispose();
  });
}

// ============================================================ helper: release
// Recompute each key's `active` (sounding) count from the schedule near loopT.
// O(active-window) using a precomputed reverse scan is overkill; with 1092
// notes a bounded forward scan around the playhead is cheap and alloc-free.
let _ageHint = 0;
function ageActive(
  sched: ReadonlyArray<PianoNote & { x: number }>,
  keyByNote: Map<number, KeyRec>,
  loopT: number,
) {
  // reset counts
  for (const [, k] of keyByNote) k.active = 0;
  // advance hint to first note that could be sounding (t close to / before now)
  while (_ageHint > 0 && sched[_ageHint].t > loopT) _ageHint--;
  while (
    _ageHint < sched.length - 1 &&
    sched[_ageHint].t + sched[_ageHint].d < loopT &&
    sched[_ageHint].t < loopT
  ) _ageHint++;
  // scan a bounded window around the playhead
  const start = Math.max(0, _ageHint - 64);
  for (let s = start; s < sched.length; s++) {
    const o = sched[s];
    if (o.t > loopT + 0.001) {
      if (o.t > loopT + 0.5) break; // sorted → nothing further is sounding now
      continue;
    }
    if (o.t + o.d >= loopT) {
      const rec = keyByNote.get(o.n);
      if (rec) rec.active++;
    }
  }
}

// ============================================================ helper: glow tex
function makeGlowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// ============================================================ helper: button
function buildUnmuteButton(host: HTMLElement): {
  el: HTMLButtonElement;
  setMuted: (m: boolean) => void;
} {
  // host is position:relative? scene-host has the canvas; ensure stacking.
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', 'Toggle piano audio');
  el.style.cssText = [
    'position:absolute', 'right:10px', 'bottom:10px', 'z-index:5',
    'width:38px', 'height:38px', 'border-radius:50%',
    'border:1px solid rgba(56,232,200,0.5)',
    'background:rgba(6,8,15,0.6)', 'color:#38e8c8',
    'font-size:15px', 'line-height:1', 'cursor:pointer',
    'display:flex', 'align-items:center', 'justify-content:center',
    'backdrop-filter:blur(4px)', 'transition:transform .12s,opacity .12s',
    'padding:0',
  ].join(';');
  el.textContent = '▶';
  el.title = 'Play piano audio';
  el.addEventListener('pointerenter', () => { el.style.transform = 'scale(1.08)'; });
  el.addEventListener('pointerleave', () => { el.style.transform = 'scale(1)'; });
  host.appendChild(el);
  const setMuted = (m: boolean) => {
    el.textContent = m ? '▶' : '🔊';
    el.title = m ? 'Play piano audio' : 'Mute piano audio';
    el.style.color = m ? '#38e8c8' : '#ffb347';
    el.style.borderColor = m ? 'rgba(56,232,200,0.5)' : 'rgba(255,179,71,0.6)';
  };
  return { el, setMuted };
}

// ============================================================ helper: audio
interface PianoAudio {
  toggle: () => boolean; // returns new "audible" state
  noteOn: (n: number, v: number, d: number) => void;
  setTransport: (loopT: number) => void;
  onResume: () => void;
  dispose: () => void;
}

/** A minimal polyphonic piano-ish synth. Triangle + sine-octave, fast attack,
 *  exponential decay; polyphony-capped; alloc-light. Muted until toggled. */
function createAudio(_getKeys: () => Map<number, KeyRec>): PianoAudio {
  let actx: AudioContext | null = null;
  let master: GainNode | null = null;
  let audible = false;
  const MAX_VOICES = 16;
  let voices = 0;

  const ensure = () => {
    if (actx) return actx;
    const AC = (window.AudioContext || (window as unknown as {
      webkitAudioContext: typeof AudioContext;
    }).webkitAudioContext);
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.0;
    master.connect(actx.destination);
    return actx;
  };

  const midiToFreq = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

  const api: PianoAudio = {
    onResume: () => {},
    toggle() {
      const ac = ensure();
      if (ac.state === 'suspended') ac.resume();
      audible = !audible;
      if (master) {
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.linearRampToValueAtTime(audible ? 0.55 : 0.0, ac.currentTime + 0.08);
      }
      if (audible) api.onResume();
      return audible;
    },
    noteOn(n, v, d) {
      if (!audible || !actx || !master) return;
      if (voices >= MAX_VOICES) return;
      try {
        const now = actx.currentTime;
        const f = midiToFreq(n);
        const g = actx.createGain();
        const dur = Math.min(Math.max(d, 0.12), 1.6);
        const peak = 0.18 + v * 0.5;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(peak, now + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.25);
        g.connect(master);

        const o1 = actx.createOscillator();
        o1.type = 'triangle';
        o1.frequency.value = f;
        const o2 = actx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 2;
        const g2 = actx.createGain();
        g2.gain.value = 0.35;
        o1.connect(g);
        o2.connect(g2);
        g2.connect(g);

        voices++;
        const stop = now + dur + 0.3;
        o1.start(now); o2.start(now);
        o1.stop(stop); o2.stop(stop);
        const done = () => { voices = Math.max(0, voices - 1); g.disconnect(); g2.disconnect(); };
        o1.onended = done;
      } catch { /* never let audio break the scene */ }
    },
    setTransport() { /* synth is event-driven from the same frame loop */ },
    dispose() {
      try { actx?.close(); } catch { /* noop */ }
      actx = null; master = null; audible = false;
    },
  };
  return api;
}

// re-export for the placement caption
export { CREDIT };
