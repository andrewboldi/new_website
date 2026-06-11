/**
 * Structured content distilled from Andrew's CV. Feeds the home, about, and
 * work pages so the narrative stays in one place.
 */

export interface Field {
  key: string;
  title: string;
  blurb: string;
  scene: string; // which three.js scene illustrates it
  accent: 'blue' | 'cyan' | 'violet' | 'amber';
}

export const FIELDS: Field[] = [
  {
    key: 'mlchem',
    title: 'Molecular machine learning',
    blurb:
      'Foundation models, finetuning, and explainability for molecular property ' +
      'prediction — turning chemistry into something a network can reason about.',
    scene: 'network',
    accent: 'blue',
  },
  {
    key: 'drugdiscovery',
    title: 'AI-driven drug discovery',
    blurb:
      'Generative chemistry and lead optimization: searching latent chemical space ' +
      'for molecules that are novel, synthesizable, and actually do something.',
    scene: 'density',
    accent: 'cyan',
  },
  {
    key: 'synthesis',
    title: 'Total synthesis',
    blurb:
      'Multi-step organic synthesis at the bench (Stoltz Lab) and deep RL for ' +
      'planning routes — building complex molecules atom by atom.',
    scene: 'molecule',
    accent: 'amber',
  },
  {
    key: 'structbio',
    title: 'Structural biology',
    blurb:
      'Protein structure and the machine-learning revolution around it — folding, ' +
      'function, and the geometry that connects them.',
    scene: 'protein',
    accent: 'cyan',
  },
  {
    key: 'physics',
    title: 'Physics & computation',
    blurb:
      'Statistical mechanics, quantum chemistry (DFT in ORCA), and the optimization ' +
      'landscapes that ML and the physical world quietly share.',
    scene: 'landscape',
    accent: 'violet',
  },
  {
    key: 'engineering',
    title: 'Engineering & making',
    blurb:
      'Electronics, M68k assembly, 3D printing, robotics automation, and shipping ' +
      'software people actually use. A polymath’s toolbox.',
    scene: 'network',
    accent: 'blue',
  },
];

export interface Experience {
  org: string;
  role: string;
  detail: string;
  when: string;
  where: string;
  kind: 'work' | 'research';
  highlights: string[];
  link?: { href: string; label: string };
}

export const EXPERIENCE: Experience[] = [
  {
    org: 'Soley Therapeutics',
    role: 'AI Intern — Molecular Machine Learning',
    detail: 'under Dr. Ankur Gupta',
    when: 'May 2025 — Present',
    where: 'South San Francisco / Remote',
    kind: 'work',
    highlights: [
      'Developed a new explainability technique for molecular ML models and showed its use in lead optimization (manuscript in progress, 10K+ lines).',
      'Finetuned hundreds of models on public + proprietary data to predict target candidate profiles and accelerate drug discovery.',
      'Built a generative-AI chemistry pipeline for novel molecule generation and lead optimization.',
      'Implemented and benchmarked ideas for better molecular property-prediction foundation models.',
      'Automated a model-benchmarking framework across 22 ADMET datasets (TDC) with cross-fold validation.',
      'Automated CDD protocol creation with Selenium — a 100+ hour manual task done in 5–6 hours.',
    ],
  },
  {
    org: 'Caltech — Stoltz Lab',
    role: 'Summer Research Intern',
    detail: 'with Dr. Scott Virgil',
    when: 'Summers 2022 & 2023',
    where: 'Pasadena, CA',
    kind: 'research',
    highlights: [
      'Completed 16 consecutive steps toward an intermediate of a diterpenoid total synthesis.',
      'Completed 10-step (korormicin) and 8-step (ineleganolide) fragment syntheses.',
      'Ran DFT modeling (ORCA) to determine selectivity in a late-stage stereoinversion.',
      'Built StremLigand, software for cataloguing catalysts & ligands.',
      'Designed and 3D-printed a replacement HPLC autosampler part, saving ~$250/part.',
    ],
    link: { href: 'https://github.com/andrewboldi/StremLigand', label: 'StremLigand' },
  },
  {
    org: 'Caltech — Center for Catalysis',
    role: 'Assistant Researcher',
    detail: 'with Dr. Scott Virgil',
    when: '2020 — 2022',
    where: 'Remote',
    kind: 'research',
    highlights: [
      'Wrote software to remotely automate robotic autosamplers (Python, VBA, M68k assembly).',
      'Reverse-engineered M68K assembly to write more efficient lab routines.',
      'Screened lanthanide–ligand catalysts for an asymmetric reduction.',
    ],
  },
];

export interface Project {
  name: string;
  blurb: string;
  tags: string[];
  link?: { href: string; label: string };
  year?: string;
  featured?: boolean;
}

export const PROJECTS: Project[] = [
  {
    name: 'Trennen',
    blurb:
      'Predicting the direction of optical rotation for chiral molecules with a T-Net ' +
      'architecture — distilling 8M+ PubChem molecules to ~27K optically active ones, ' +
      'with DFT polarizability tensors (B3LYP/def2-SVP).',
    tags: ['Machine Learning', 'Chirality', 'DFT', 'RDKit'],
    link: { href: 'https://github.com/andrewboldi/Trennen', label: 'Trennen' },
    featured: true,
  },
  {
    name: 'DRL for Total Synthesis',
    blurb:
      'A proposal to plan total-synthesis routes with deep reinforcement learning — ' +
      'the bench meets the search tree.',
    tags: ['Deep RL', 'Synthesis', 'Proposal'],
    link: {
      href: 'https://drive.google.com/file/d/1tb4FmbWa_kB-IzOSVxSBt1PZdDzaw_Iu/view',
      label: 'Read proposal',
    },
    featured: true,
  },
  {
    name: 'Pathfinder',
    blurb:
      'A scenic-routing algorithm (modified A*) over San Mateo County — semantic ' +
      'segmentation of 250K+ Street View images on TPUs, with earth-curvature-aware ' +
      'heuristics and TIGER/Line road graphs.',
    tags: ['Deep Learning', 'Computer Vision', 'Geospatial'],
    link: { href: 'https://github.com/andrewboldi/Pathfinder', label: 'Pathfinder' },
    featured: true,
  },
  {
    name: 'AMC Trainer',
    blurb:
      'An interactive math-competition trainer built with my brother — used by 20K+ ' +
      'people across 50+ countries.',
    tags: ['Web', 'Education', 'Cloudflare'],
    link: { href: 'https://github.com/andrewboldi/AMC-Trainer', label: 'AMC Trainer' },
  },
  {
    name: 'Pacman + Bitcoin Miner',
    blurb:
      'A Pacman game with a built-in Bitcoin miner in 3000+ lines of Java — top 15 of ' +
      '~1400 students in Berkeley’s CS61B.',
    tags: ['Java', 'Games'],
    link: { href: 'https://www.youtube.com/watch?v=GyHNzA2-zqI', label: 'Video demo' },
  },
  {
    name: 'fibprimes',
    blurb:
      'A C program that writes MIDI files from the patterns of Fibonacci and prime ' +
      'numbers. Reached Hacker News.',
    tags: ['C', 'MIDI', 'Music'],
    link: { href: 'https://github.com/andrewboldi/fibprimes', label: 'fibprimes' },
  },
  {
    name: 'zipfai',
    blurb:
      'A study of Zipf’s law across 200+ GB of text — all of Wikipedia, scraped ' +
      'Project Gutenberg, and more.',
    tags: ['NLP', 'Data'],
    link: { href: 'https://github.com/andrewboldi/zipfai', label: 'zipfai' },
  },
  {
    name: 'Polyphenols in Tea',
    blurb:
      'Quantifying polyphenols in tea and kombucha with Fast Blue BB and a custom ' +
      '3D-printed high-throughput cuvette plate.',
    tags: ['Spectroscopy', 'Chemistry'],
    link: { href: 'https://youtu.be/xdqA7C0FEdU', label: 'Video demo' },
  },
  {
    name: 'Three-Body Invariants',
    blurb:
      'Searching for conserved quantities in the chaotic three-body problem via ' +
      'automatic generation of candidate symbolic expressions.',
    tags: ['Physics', 'Symbolic', 'Search'],
    link: { href: 'https://github.com/andrewboldi/tbp', label: 'tbp' },
  },
  {
    name: 'Oscillations',
    blurb: 'An interactive visualizer for damped harmonic oscillators — tune the damping and watch the phase portrait respond.',
    tags: ['Physics', 'Visualization'],
    link: { href: 'https://github.com/andrewboldi/oscillations', label: 'oscillations' },
  },
  {
    name: 'musalpha',
    blurb: 'Hear language as music — mapping the structure of text onto sound.',
    tags: ['Audio', 'Language'],
    link: { href: 'https://github.com/andrewboldi/musalpha', label: 'musalpha' },
  },
  {
    name: 'squanmate',
    blurb: 'A Square-1 trainer, solver, and analysis tool — for the speedcubing habit.',
    tags: ['Puzzles', 'Algorithms'],
    link: { href: 'https://github.com/andrewboldi/squanmate', label: 'squanmate' },
  },
  {
    name: 'Obsidian Vault Sync',
    blurb:
      'Streaming, REST-based GitHub sync for Obsidian that works on iOS for vaults of ' +
      'any size, images included.',
    tags: ['TypeScript', 'Tools'],
    link: { href: 'https://github.com/andrewboldi/obsidian-vault-sync', label: 'obsidian-vault-sync' },
  },
];

export interface Polymath {
  title: string;
  lines: string[];
  stat?: string;
}

export const POLYMATH: Polymath[] = [
  {
    title: 'Piano',
    stat: 'Carnegie Hall',
    lines: [
      'Classical pianist since age 7; 30+ competition recognitions.',
      'Performed at Carnegie Hall and Merkin Hall as a competition winner.',
      'Conducted a 200-person pep band; jazz ensemble pianist.',
    ],
  },
  {
    title: 'Speedcubing',
    stat: '9.42s',
    lines: [
      'Solved the 3×3 in 9.42 seconds — and blindfolded.',
      'Fluent on 2×2 through 7×7, Megaminx, and Square-1.',
    ],
  },
  {
    title: 'Teaching',
    stat: '460+ students',
    lines: [
      'Private tutor since 2018 (math & piano).',
      'Math program director for 460+ students (YAPA Kids).',
      'Workshop facilitator promoting STEM for grades 3–6.',
    ],
  },
];

export const COURSEWORK = {
  'Machine Learning & CS': [
    'Deep Neural Networks (CS182)', 'Computer Vision (CS180)', 'Machine Learning (CS189)',
    'Artificial Intelligence (CS188)', 'Data Structures & Algorithms (CS61B)',
    'Computer Architecture (CS61C)', 'Discrete Math & Probability',
  ],
  Chemistry: [
    'Computational Chemistry', 'Physical Chemistry (Quantum)',
    'Physical Chemistry (Stat Mech)', 'Honors Organic Chemistry I/II', 'Honors General Chemistry I/II',
  ],
  'Biology & Physics': [
    'Molecular Biology Lab', 'Macromolecular Biology', 'Biochemistry',
    'Biological Inorganic Chemistry', 'Human Physiology', 'Mechanics', 'E&M',
  ],
};
