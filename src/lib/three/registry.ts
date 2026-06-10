/**
 * Client-side scene registry. Lazy-imports the right scene module per name so a
 * page only ships the three.js code for the scenes it actually uses.
 */
import { mount, type CreateSceneOpts } from './core';

export type SceneName = 'network' | 'molecule' | 'protein' | 'density' | 'landscape';

type BloomOpts = NonNullable<CreateSceneOpts['bloom']>;

const BLOOM: Record<SceneName, BloomOpts> = {
  network: { strength: 0.85, radius: 0.6, threshold: 0.05 },
  molecule: { strength: 0.55, radius: 0.5, threshold: 0.12 },
  protein: { strength: 0.7, radius: 0.5, threshold: 0.1 },
  density: { strength: 1.0, radius: 0.7, threshold: 0.0 },
  landscape: { strength: 0.8, radius: 0.6, threshold: 0.04 },
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
      const pdb = extra.pdb ?? '';
      return mount(host, (h) => moleculeViewer(h, { url: pdb }), { bloom });
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
  }
}

/** Find every [data-scene] host on the page and mount it. Idempotent. */
export function autoMountScenes() {
  const hosts = document.querySelectorAll<HTMLElement>('[data-scene]:not([data-mounted])');
  hosts.forEach((host) => {
    const name = host.dataset.scene as SceneName;
    const pdb = host.dataset.pdb;
    mountScene(host, name, { pdb });
  });
}
