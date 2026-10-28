import { z } from "zod";

export const Product = z.object({
  found: z.boolean().describe("False if the page/image has no product dimensions at all."),
  name: z.string().nullable(),
  width_in: z.number().nullable().describe("Overall assembled width (side to side), inches."),
  depth_in: z.number().nullable().describe("Overall assembled depth (front to back), inches."),
  height_in: z.number().nullable().describe("Overall assembled height, inches."),
  dims_kind: z
    .enum(["assembled", "package", "unclear"])
    .describe("Whether the reported numbers are the assembled product or the shipping box."),
  footprint: z.object({
    shape: z.enum(["rectangle", "l_shape", "corner", "round", "oval", "other"]),
    detail: z
      .string()
      .nullable()
      .describe("For non-rectangles: the extra dimensions, e.g. 'chaise side 62 in deep, left-facing'."),
  }),
  sub_dimensions: z
    .array(z.object({ label: z.string(), inches: z.number() }))
    .describe("Secondary measurements such as seat height or arm height. Never used as overall size."),
  variant_note: z
    .string()
    .nullable()
    .describe("If the page lists several sizes/variants, which one these numbers belong to."),
  evidence: z.string().describe("The exact text the overall dimensions were read from."),
  confidence: z.enum(["high", "medium", "low"]),
});

export type Product = z.infer<typeof Product>;
