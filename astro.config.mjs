import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Deployed to GitHub Pages on the custom domain https://andrewboldi.com.
//
// NO `base` HERE, deliberately. A custom domain serves the project site at the
// DOMAIN ROOT, so `base: '/new_website'` made every generated URL point at
// /new_website/... — which 404s on andrewboldi.com. That broke the whole site:
// all _astro CSS/JS 404'd (page rendered as unstyled plain text, no WebGL
// background) and every nav link 404'd, while the real pages sat at /work/ etc.
// `base` is only correct for the bare andrewboldi.github.io/new_website/ URL,
// which GitHub redirects to the custom domain anyway once a CNAME is set.
export default defineConfig({
  site: 'https://andrewboldi.com',
  integrations: [mdx(), sitemap()],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
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
