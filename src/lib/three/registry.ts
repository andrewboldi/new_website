/**
 * Client-side scene registry. Lazy-imports the right scene module per name so a
 * page only ships the three.js code for the scenes it actually uses.
 */
import { mount, type CreateSceneOpts, type SceneTier } from './core';

export type SceneName =
  | 'network' | 'molecule' | 'protein' | 'density' | 'landscape'
  | 'neuralnet' | 'signal' | 'orbital' | 'helix' | 'statmech' | 'lattice'
  | 'threebody' | 'rubiks'
  | 'routegraph' | 'chromatography' | 'massspec' | 'gradientdescent' | 'fourier'
  | 'piano';

type BloomOpts = NonNullable<CreateSceneOpts['bloom']>;

/**
 * Per-scene quality TIER (see core.ts CreateSceneOpts.tier).
 *  - 'feature' → full composer (bloom + filmic finish + SMAA). Reserved for the
 *    visually-dominant lab/curiosity scenes whose glow + thin-line AA carry the
 *    look (protein ribbon, molecule, the molecular network, neural net,
 *    electron density, the signal/mass-spec traces).
 *  - 'tile' → CHEAP chain (single bloom pass → output, no SMAA/no filmic).
 *    Everything else. These are smaller and usually appear several-at-once on
 *    busy pages (About), so they get the lean path. They DON'T go dim: dropping
 *    the finish pass removes a slight vignette darkening (if anything they read
 *    a touch brighter), and their bloom thresholds below stay LOW so additive
 *    emissive geometry still crosses the bloom cutoff and glows.
 * The governor strips finish+SMAA from feature scenes automatically under load.
 */
const TIER: Record<SceneName, SceneTier> = {
  network: 'feature',
  molecule: 'feature',
  protein: 'feature',
  density: 'feature',
  neuralnet: 'feature',
  signal: 'feature',
  massspec: 'feature',
  landscape: 'tile',
  orbital: 'tile',
  helix: 'tile',
  statmech: 'tile',
  lattice: 'tile',
  threebody: 'tile',
  rubiks: 'tile',
  routegraph: 'tile',
  chromatography: 'tile',
  gradientdescent: 'tile',
  fourier: 'tile',
  piano: 'tile',
};

// Per-scene bloom, retuned for the upgraded composer (default threshold is now
// 0.5). FEATURE scenes run the full vignette/grain/dither + SMAA chain after
// bloom; TILE scenes run bloom→output only (cheap). Goal: accents glow but
// nothing washes to white, and no scene goes dim/flat. Emissive line & particle
// scenes keep a LOWER threshold so their additive geometry still crosses the
// bloom cutoff; solid/lit scenes sit higher. Tile scenes that lost the filmic
// finish get a small threshold nudge DOWN so their glow doesn't read weaker on
// the cheap path.
const BLOOM: Record<SceneName, BloomOpts> = {
  network: { strength: 0.6, radius: 0.55, threshold: 0.32 },
  molecule: { strength: 0.5, radius: 0.5, threshold: 0.45 },
  protein: { strength: 0.55, radius: 0.5, threshold: 0.42 },
  density: { strength: 0.7, radius: 0.65, threshold: 0.25 },
  landscape: { strength: 0.62, radius: 0.55, threshold: 0.27 },
  neuralnet: { strength: 0.62, radius: 0.55, threshold: 0.3 },
  signal: { strength: 0.7, radius: 0.55, threshold: 0.28 },
  orbital: { strength: 0.54, radius: 0.5, threshold: 0.36 },
  helix: { strength: 0.56, radius: 0.5, threshold: 0.36 },
  statmech: { strength: 0.6, radius: 0.55, threshold: 0.32 },
  lattice: { strength: 0.56, radius: 0.5, threshold: 0.36 },
  threebody: { strength: 0.62, radius: 0.55, threshold: 0.3 },
  rubiks: { strength: 0.16, radius: 0.4, threshold: 0.58 },
  routegraph: { strength: 0.64, radius: 0.55, threshold: 0.27 },
  chromatography: { strength: 0.48, radius: 0.5, threshold: 0.36 },
  massspec: { strength: 0.7, radius: 0.55, threshold: 0.28 },
  gradientdescent: { strength: 0.46, radius: 0.5, threshold: 0.38 },
  fourier: { strength: 0.64, radius: 0.55, threshold: 0.27 },
  piano: { strength: 0.48, radius: 0.5, threshold: 0.36 },
};

export async function mountScene(
  host: HTMLElement,
  name: SceneName,
  extra: { pdb?: string } = {},
) {
  const bloom = BLOOM[name];
  const tier = TIER[name];
  switch (name) {
    case 'network': {
      const { molecularNetwork } = await import('./MolecularNetwork');
      return mount(host, (h) => molecularNetwork(h), { bloom, tier });
    }
    case 'molecule': {
      const { moleculeViewer } = await import('./MoleculeViewer');
      // SOLID: the ball-and-stick body occludes the background (over-composite).
      return mount(host, (h) => moleculeViewer(h, { url: extra.pdb ?? '' }), { bloom, tier, solid: true });
    }
    case 'protein': {
      const { proteinRibbon } = await import('./ProteinRibbon');
      return mount(host, (h) => proteinRibbon(h), { bloom, tier });
    }
    case 'density': {
      const { electronDensity } = await import('./ElectronDensity');
      return mount(host, (h) => electronDensity(h), { bloom, tier, alpha: true });
    }
    case 'landscape': {
      const { energyLandscape } = await import('./EnergyLandscape');
      return mount(host, (h) => energyLandscape(h), { bloom, tier });
    }
    case 'neuralnet': {
      const { neuralNet } = await import('./NeuralNet');
      return mount(host, (h) => neuralNet(h), { bloom, tier });
    }
    case 'signal': {
      const { signal } = await import('./Signal');
      return mount(host, (h) => signal(h), { bloom, tier });
    }
    case 'statmech': {
      const { statMech } = await import('./StatMech');
      return mount(host, (h) => statMech(h), { bloom, tier });
    }
    case 'threebody': {
      const { threeBody } = await import('./ThreeBody');
      return mount(host, (h) => threeBody(h), { bloom, tier });
    }
    case 'rubiks': {
      const { rubiksCube } = await import('./RubiksCube');
      // SOLID: a plastic cube occludes the background rather than glowing over it.
      return mount(host, (h) => rubiksCube(h), { bloom, tier, solid: true });
    }
    case 'routegraph': {
      const { routeGraph } = await import('./RouteGraph');
      return mount(host, (h) => routeGraph(h), { bloom, tier });
    }
    case 'chromatography': {
      const { chromatography } = await import('./Chromatography');
      return mount(host, (h) => chromatography(h), { bloom, tier });
    }
    case 'massspec': {
      const { massSpec } = await import('./MassSpec');
      return mount(host, (h) => massSpec(h), { bloom, tier });
    }
    case 'gradientdescent': {
      const { gradientDescent } = await import('./GradientDescent');
      return mount(host, (h) => gradientDescent(h), { bloom, tier });
    }
    case 'fourier': {
      const { fourier } = await import('./Fourier');
      return mount(host, (h) => fourier(h), { bloom, tier });
    }
    case 'piano': {
      const { piano } = await import('./Piano');
      // SOLID + opaque (alpha:false already fills its RT) — the keyboard occludes.
      return mount(host, (h) => piano(h), { bloom, tier, alpha: false, solid: true });
    }
    case 'orbital':
    case 'helix':
    case 'lattice': {
      const [{ shapeScene }, shapes] = await Promise.all([
        import('./ShapeScene'),
        import('./shapes'),
      ]);
      const gen = shapes[name];
      const cfg = {
        orbital: { spin: 0.14, count: 1500, cameraZ: 62 },
        helix: { spin: 0.18, count: 2600, cameraZ: 50 },
        lattice: { spin: 0.1, count: 2400, cameraZ: 52 },
      }[name];
      return mount(host, (h) => shapeScene(h, { gen, ...cfg }), { bloom, tier });
    }
  }
}

/** Find every [data-scene] host on the page and mount it. Idempotent. */
export function autoMountScenes() {
  const hosts = document.querySelectorAll<HTMLElement>('[data-scene]:not([data-mounted])');
  hosts.forEach((host) => {
    const name = host.dataset.scene as SceneName;
    mountScene(host, name, { pdb: host.dataset.pdb });
  });
}
