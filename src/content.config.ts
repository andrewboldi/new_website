import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    summary: z.string().optional(),
    draft: z.boolean().default(false),
    /** optional three.js scene to render at the top of the post */
    scene: z.enum([
      'network', 'molecule', 'protein', 'density', 'landscape',
      'neuralnet', 'signal', 'orbital', 'helix', 'statmech', 'lattice',
    ]).optional(),
  }),
});

const books = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/books' }),
  schema: z.object({
    title: z.string(),
    author: z.string(),
    status: z.enum(['reading', 'read', 'queued']),
    rating: z.number().min(0).max(5).optional(),
    tags: z.array(z.string()).default([]),
    started: z.string().optional(),
    finished: z.string().optional(),
    /** hex used for the 3D spine */
    spine: z.string().default('#13203a'),
    /** display order on the shelf, lower = left */
    order: z.number().default(0),
  }),
});

export const collections = { blog, books };
