# andrewboldi.com — personal site

A three.js-heavy personal website for Andrew Boldi: UC Berkeley Chemical Biology × CS,
AI for drug discovery, total synthesis, structural biology, and a polymath's worth of
other interests. Built with [Astro](https://astro.build) and [three.js](https://threejs.org).

## Concept

"Inside a simulation." A dark scientific-instrument aesthetic where every animation is
drawn from Andrew's actual fields — molecular interaction networks, real PDB molecules,
protein backbones folding, electron-density metaballs, energy landscapes. See
[`docs/DESIGN.md`](docs/DESIGN.md).

## Develop

```bash
pnpm install
pnpm dev      # http://localhost:4321
pnpm build    # static output to dist/
pnpm preview  # serve the build
```

## Structure

```
src/
  layouts/Base.astro        global shell, SEO, cursor, scroll-reveal
  components/               Nav, Footer, SceneHost
  lib/
    site.ts                 identity, nav, socials
    data.ts                 CV-derived content (fields, experience, projects)
    three/
      core.ts               renderer/scene/camera lifecycle + bloom
      MolecularNetwork.ts   hero — particle interaction network
      MoleculeViewer.ts     PDB ball-and-stick
      ProteinRibbon.ts      CA-trace backbone that folds in
      ElectronDensity.ts    marching-cubes metaballs
      EnergyLandscape.ts    shader wave grid
      Bookshelf.ts          interactive 3D spines
  content/
    blog/                   Markdown posts
    books/                  Markdown book entries
  pages/                   index, about, work, blog, bookshelf
```

## Deploy

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`. Enable Pages
→ "GitHub Actions" in the repo settings. For a custom domain, set `site` and drop `base`
in `astro.config.mjs`.
