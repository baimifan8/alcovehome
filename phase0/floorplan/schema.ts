import { z } from "zod";

/** Hand-labeled ground truth for one screenshot: just what the scorer checks. */
export const Truth = z.object({
  image: z.string(),
  source_note: z.string().optional(),
  rooms: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()).optional(),
      width_in: z.number().nullable(),
      length_in: z.number().nullable(),
      doors: z.number().int(),
      windows: z.number().int(),
      closets: z.number().int().optional(),
    }),
  ),
});

export type Truth = z.infer<typeof Truth>;
