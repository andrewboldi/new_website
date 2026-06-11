export const SITE = {
  name: 'Andrew Boldi',
  role: 'Chemical Biology × Computer Science',
  tagline: 'Solving the hardest problems in science with computation.',
  location: 'San Carlos, CA',
  email: 'andrewjboldi@gmail.com',
  school: 'UC Berkeley',
  description:
    'Andrew Boldi — UC Berkeley Chemical Biology & CS. AI for drug discovery, ' +
    'molecular machine learning, total synthesis, structural biology, and a great deal else.',
};

export const SOCIALS = [
  { label: 'GitHub', handle: 'andrewboldi', href: 'https://github.com/andrewboldi' },
  { label: 'X', handle: '@andrewboldi', href: 'https://x.com/andrewboldi' },
  { label: 'LinkedIn', handle: 'andrewboldi', href: 'https://linkedin.com/in/andrewboldi' },
  { label: 'YouTube', handle: 'piano', href: 'https://youtube.com/@AndrewBoldiPiano' },
];

export const NAV = [
  { label: 'Index', path: '/' },
  { label: 'About', path: '/about' },
  { label: 'Work', path: '/work' },
  { label: 'Library', path: '/bookshelf' },
];

/** Build a path that respects Astro's configured base. */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return base || '/';
  return base + (path.startsWith('/') ? path : '/' + path);
}
