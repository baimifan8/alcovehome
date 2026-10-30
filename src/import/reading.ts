// What the AI is asked to read off a floor plan image. Deliberately no arithmetic:
// it reports what is printed and where things are in the image's own pixels; code
// (draft.ts) works out scale and sizes. Shared by the server and the Phase 0 tests.

import { z } from "zod";

const Confidence = z.enum(["high", "medium", "low"]);
const Wall = z.enum(["top", "right", "bottom", "left"]);

export const PlanReading = z.object({
  units_seen: z.enum(["ft_in", "metric", "mixed", "none"]),
  rooms: z.array(
    z.object({
      name: z.string().describe("Room name as printed, e.g. 'Bedroom 2'. Make one up ('Hall', 'Closet') if unlabeled."),
      label_text: z
        .string()
        .nullable()
        .describe("This room's dimension label copied exactly as printed, e.g. 11'2\" x 12'0\". Null if it has none."),
      bbox_px: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .describe("The room's inside wall-to-wall extent in image pixels, origin at the image's top-left."),
      confidence: Confidence,
    }),
  ),
  openings: z.array(
    z.object({
      type: z.enum(["door", "sliding_door", "closet_door", "window", "open_passage"]),
      room: z.string().describe("Name of the room it belongs to (for a door between rooms, the room it swings into)."),
      wall: Wall.describe("Which side of that room's box it is on."),
      start_px: z.number().describe("Where the opening starts along that wall, in image pixels: x for top/bottom walls, y for left/right walls."),
      end_px: z.number().describe("Where it ends, same axis as start_px."),
      swing: z.enum(["into_room", "out_of_room", "sliding", "none", "unknown"]),
      hinge_at: z.enum(["start", "end", "unknown"]).describe("Which end the hinge is at: start = the smaller pixel coordinate."),
      confidence: Confidence,
    }),
  ),
  built_ins: z.array(
    z.object({
      label: z.string().describe("What it is, in plain words: 'kitchen island', 'counter', 'fireplace', 'radiator', 'built-in shelves'."),
      room: z.string().describe("Name of the room it is in."),
      bbox_px: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .describe("Its footprint on the floor in image pixels, origin at the image's top-left."),
      confidence: Confidence,
    }),
  ),
  warnings: z.array(z.string()).describe("Anything ambiguous: unreadable labels, conflicting numbers, cropped areas."),
});

export type PlanReading = z.infer<typeof PlanReading>;

export const READING_SYSTEM = `You read real-estate floor plan images and report what they show, as structured data.

Rules:
- Report every room, closet and hallway you can see.
- Copy each room's printed dimension label exactly as printed into label_text. Do not convert or compute anything.
- Give positions in the image's own pixel coordinates (origin top-left). The image size is stated in the request.
- bbox_px is the inside of the room's walls, not the wall lines themselves.
- Doors: report the swing direction from the drawn arc and which end the hinge is at. Closet doors are closet_door; bifold or sliding closet doors use swing "sliding".
- Built-ins are fixed things furniture can't be placed on: kitchen islands and peninsulas, counters and cabinet runs (one per straight run, appliances included), built-in shelving, desks or benches, fireplaces and hearths, radiators, columns, stairs, bathtubs, showers, vanities and toilets. Report each with its floor footprint. Don't report furniture drawn only for decoration (beds, sofas, tables, rugs).
- Never invent a printed number. If a label is unreadable, say so in warnings and lower that room's confidence.
- Use confidence "low" for anything a person should double-check.`;

export function readingInstruction(width: number, height: number): string {
  return `This floor plan image is ${width} x ${height} pixels. Read it.`;
}
