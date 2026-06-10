# Andrew Boldi — Personal Site Design

A personal website for Andrew Boldi: UC Berkeley Chemical Biology + CS, AI/ML for drug
discovery (Soley Therapeutics), total synthesis (Caltech / Stoltz Lab), and a polymath
across physics, electronics, structural biology, music, and puzzles.

## Concept

"Inside a simulation." The site feels like a high-end research instrument: dark, precise,
alive with motion that is *literally* drawn from Andrew's fields — molecules, protein
backbones, electron densities, particle interaction networks, energy landscapes. Every
animation means something; nothing is decoration for its own sake.

## Aesthetic

- **Palette** (dark): near-black blue-black canvas, anchored by the CV brand **electric
  blue `#0099ff`**, a bioluminescent **cyan `#38e8c8`** (GFP-like) as the "alive/bio"
  accent, and **amber `#ffae3b`** used sparingly for reaction-energy highlights.
- **Type**: `Instrument Serif` (expressive editorial display — the chemist/musician side)
  × `JetBrains Mono` (lab-instrument labels, data, formulae) × `Familjen Grotesk`
  (clean body/UI — the CS/data side).
- **Motion**: one orchestrated load with staggered reveals; scroll-driven scene changes;
  hover states with intent. Respects `prefers-reduced-motion`.

## Stack

- **Astro** static site. Content collections (Markdown) for blog + bookshelf.
- **three.js 0.184** scenes as bundled client islands: lazy-mounted via `client:visible`
  / IntersectionObserver, paused offscreen, capped pixel ratio, disposed on teardown.
- Deploy: GitHub Pages via Actions → `andrewboldi.github.io/new_website` (custom domain ready).

## Three.js scenes (each mapped to a real interest)

| Scene | Interest | Technique |
|-------|----------|-----------|
| `MolecularNetwork` (hero) | drug discovery / molecular ML | particle network, dynamic line draw-range, UnrealBloom |
| `MoleculeViewer` | organic chemistry | PDBLoader ball-and-stick, slow rotation, bloom |
| `ProteinRibbon` | structural biology / AI for protein structure | CA-trace CatmullRom → TubeGeometry that draws in (fold) |
| `ElectronDensity` | computational chemistry / DFT | MarchingCubes metaballs, shiny env-mapped material |
| `EnergyLandscape` | physics / gradient descent / RL | shader Points wave grid as an energy surface |
| `Bookshelf` | bookshelf section | 3D spines, hover pull-out, click → review |

## Pages

- `/` — hero (MolecularNetwork) + scroll narrative threading the other scenes.
- `/about` — bio, experience/research timeline, polymath dimensions (music, cubing), skills.
- `/work` — research + projects, each with a themed visual.
- `/blog` — list + posts (ports existing: LRP, Bayesian thinking, comp chem, signal/noise).
- `/bookshelf` — books read / reading / reviews on a 3D shelf.

## Identity

- X: [@andrewboldi](https://x.com/andrewboldi) · GitHub:
  [andrewboldi](https://github.com/andrewboldi) · LinkedIn:
  [andrewboldi](https://linkedin.com/in/andrewboldi)
- Tagline (from CV): "trying to solve the most difficult science problems with programming."
- San Carlos, CA.
