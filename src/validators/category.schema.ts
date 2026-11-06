import { z } from 'zod';

/** Body for POST/PUT /categories — same rules as the Angular form (R5 AC2, NFR3). */
export const categoryBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(30, 'Name must be at most 30 characters'),
  icon: z
    .string()
    .trim()
    .min(1, 'Icon is required')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Icon must be a Material icon name, e.g. "pets"'),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #E57373'),
});

export type CategoryBody = z.infer<typeof categoryBodySchema>;
