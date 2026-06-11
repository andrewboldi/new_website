/**
 * Client-side scene registry. Lazy-imports the right scene module per name so a
 * page only ships the three.js code for the scenes it actually uses.
 */
import { mount, type CreateSceneOpts } from './core';

export type SceneName =
  | 'network' | 'molecule' | 'protein' | 'density' | 'landscape'
  | 'neuralnet' | 'signal' | 'orbital' | 'helix' | 'statmech' | 'lattice'
  | 'threebody' | 'rubiks'
  | 'routegraph' | 'chromatography' | 'massspec' | 'gradientdescent' | 'fourier'
  | 'piano';

type BloomOpts = NonNullable<CreateSceneOpts['bloom']>;

const BLOOM: Record<SceneName, BloomOpts> = {
  network: { strength: 0.85, radius: 0.6, threshold: 0.05 },
  molecule: { strength: 0.55, radius: 0.5, threshold: 0.12 },
  protein: { strength: 0.7, radius: 0.5, threshold: 0.1 },
  density: { strength: 1.0, radius: 0.7, threshold: 0.0 },
  landscape: { strength: 0.8, radius: 0.6, threshold: 0.04 },
  neuralnet: { strength: 0.85, radius: 0.6, threshold: 0.03 },
  signal: { strength: 0.9, radius: 0.6, threshold: 0.02 },
  orbital: { strength: 0.55, radius: 0.5, threshold: 0.08 },
  helix: { strength: 0.6, radius: 0.5, threshold: 0.07 },
  statmech: { strength: 0.7, radius: 0.55, threshold: 0.04 },
  lattice: { strength: 0.6, radius: 0.5, threshold: 0.07 },
  threebody: { strength: 0.7, radius: 0.6, threshold: 0.05 },
  rubiks: { strength: 0.15, radius: 0.4, threshold: 0.6 },
  routegraph: { strength: 0.85, radius: 0.6, threshold: 0.04 },
  chromatography: { strength: 0.5, radius: 0.55, threshold: 0.15 },
  massspec: { strength: 0.9, radius: 0.6, threshold: 0.02 },
  gradientdescent: { strength: 0.45, radius: 0.5, threshold: 0.18 },
  fourier: { strength: 0.85, radius: 0.6, threshold: 0.03 },
  piano: { strength: 0.5, radius: 0.5, threshold: 0.15 },
};

export async function mountScene(
  host: HTMLElement,
  name: SceneName,
  extra: { pdb?: string } = {},
) {
  const bloom = BLOOM[name];
  switch (name) {
    case 'network': {
      const { molecularNetwork } = await import('./MolecularNetwork');
      return mount(host, (h) => molecularNetwork(h), { bloom });
    }
    case 'molecule': {
      const { moleculeViewer } = await import('./MoleculeViewer');
      return mount(host, (h) => moleculeViewer(h, { url: extra.pdb ?? '' }), { bloom });
    }
    case 'protein': {
      const { proteinRibbon } = await import('./ProteinRibbon');
      return mount(host, (h) => proteinRibbon(h), { bloom });
    }
    case 'density': {
      const { electronDensity } = await import('./ElectronDensity');
      return mount(host, (h) => electronDensity(h), { bloom, alpha: true });
    }
    case 'landscape': {
      const { energyLandscape } = await import('./EnergyLandscape');
      return mount(host, (h) => energyLandscape(h), { bloom });
    }
    case 'neuralnet': {
      const { neuralNet } = await import('./NeuralNet');
      return mount(host, (h) => neuralNet(h), { bloom });
    }
    case 'signal': {
      const { signal } = await import('./Signal');
      return mount(host, (h) => signal(h), { bloom });
    }
    case 'statmech': {
      const { statMech } = await import('./StatMech');
      return mount(host, (h) => statMech(h), { bloom });
    }
    case 'threebody': {
      const { threeBody } = await import('./ThreeBody');
      return mount(host, (h) => threeBody(h), { bloom });
    }
    case 'rubiks': {
      const { rubiksCube } = await import('./RubiksCube');
      return mount(host, (h) => rubiksCube(h), { bloom });
    }
    case 'routegraph': {
      const { routeGraph } = await import('./RouteGraph');
      return mount(host, (h) => routeGraph(h), { bloom });
    }
    case 'chromatography': {
      const { chromatography } = await import('./Chromatography');
      return mount(host, (h) => chromatography(h), { bloom });
    }
    case 'massspec': {
      const { massSpec } = await import('./MassSpec');
      return mount(host, (h) => massSpec(h), { bloom });
    }
    case 'gradientdescent': {
      const { gradientDescent } = await import('./GradientDescent');
      return mount(host, (h) => gradientDescent(h), { bloom });
    }
    case 'fourier': {
      const { fourier } = await import('./Fourier');
      return mount(host, (h) => fourier(h), { bloom });
    }
    case 'piano': {
      const { piano } = await import('./Piano');
      return mount(host, (h) => piano(h), { bloom, alpha: false });
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
      return mount(host, (h) => shapeScene(h, { gen, ...cfg }), { bloom });
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
