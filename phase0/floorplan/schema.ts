import { z } from "zod";

// All lengths in inches. "width" is the room's horizontal extent as drawn in the
// image and "length" its vertical extent; scoring treats the pair as unordered
// because listings label rooms "11' x 12'" without saying which is which.

const Confidence = z.enum(["high", "medium", "low"]);
const Wall = z.enum(["top", "right", "bottom", "left"]);

export const Room = z.object({
  name: z.string().describe("Room name as labeled, e.g. 'Bedroom 2', 'Living/Dining'."),
  label_text: z
    .string()
    .nullable()
    .describe("Dimension label copied verbatim from the image, e.g. 11'2\" x 12'0\". Null if unlabeled."),
  width_in: z.number().nullable().describe("Horizontal extent as drawn, in inches."),
  length_in: z.number().nullable().describe("Vertical extent as drawn, in inches."),
  dims_source: z
    .enum(["labeled", "inferred_from_scale", "none"])
    .describe("labeled = read from a printed number; inferred_from_scale = measured using the plan's scale."),
  bbox_px: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .describe("Room bounding box in image pixels, origin top-left."),
  confidence: Confidence,
});

export const Opening = z.object({
  type: z.enum(["door", "sliding_door", "closet_door", "window", "open_passage"]),
  room: z.string().describe("Name of the room this opening belongs to (for a door between rooms, the room it swings into)."),
  wall: Wall.describe("Which wall of that room, as drawn in the image."),
  offset_in: z.number().nullable().describe("Distance from the wall's left/top end to the opening's near edge."),
  width_in: z.number().nullable(),
  swing: z.enum(["into_room", "out_of_room", "sliding", "none", "unknown"]),
  hinge: z.enum(["left", "right", "unknown"]).describe("Hinge side seen from inside the room facing the wall."),
  confidence: Confidence,
});

export const Layout = z.object({
  units_seen: z.enum(["ft_in", "metric", "mixed", "none"]),
  scale: z.object({
    pixels_per_foot: z.number().nullable(),
    derived_from: z.string().describe("Which labeled wall(s) the scale was worked out from, or why none."),
  }),
  rooms: z.array(Room),
  openings: z.array(Opening),
  warnings: z.array(z.string()).describe("Anything ambiguous: unreadable labels, conflicting numbers, cropped areas."),
});

export type Layout = z.infer<typeof Layout>;

/** Hand-labeled ground truth for one screenshot. Deliberately smaller than Layout. */
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
