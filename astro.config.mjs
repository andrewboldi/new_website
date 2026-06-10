import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Deployed to GitHub Pages at https://andrewboldi.github.io/new_website
// To switch to a custom domain (e.g. andrewboldi.com), set `site` and remove `base`.
export default defineConfig({
  site: 'https://andrewboldi.github.io',
  base: '/new_website',
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: true,
    },
  },
  vite: {
    ssr: {
      noExternal: ['three'],
    },
  },
});
