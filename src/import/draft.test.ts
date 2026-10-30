import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRules, evaluateRoom } from "../engine/index.ts";
import { draftFromReading, draftFromText, draftToRoom } from "./draft.ts";
import { parseListingText } from "./labels.ts";
import { PlanReading } from "./reading.ts";

const fixture = PlanReading.parse(
  JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/sample-plan.reading.json"), "utf8")),
);

describe("draftFromReading", () => {
  const plan = draftFromReading(fixture);
  const room = (name: string) => plan.rooms.find((r) => r.name === name)!;

  it("works out the drawing's scale from labeled rooms", () => {
    expect(plan.pxPerInch).toBeCloseTo(2.5, 6);
  });

  it("matches the longer label number to the longer side as drawn", () => {
    expect(room("Living Room")).toMatchObject({ width: 186, length: 144, widthSource: "labeled", lengthSource: "labeled" });
    // Label says 11' x 10' and the room is drawn wider than tall.
    expect(room("Bedroom")).toMatchObject({ width: 132, length: 120 });
  });

  it("measures unlabeled rooms with the scale and tags them inferred", () => {
    expect(room("Closet")).toMatchObject({ width: 48, length: 20, widthSource: "inferred", lengthSource: "inferred" });
    expect(room("Closet").issues.join(" ")).toMatch(/measured from the drawing/);
  });

  it("flags a label that disagrees with the drawing", () => {
    expect(room("Bath").issues.join(" ")).toMatch(/doesn't match how big the room is drawn/);
    expect(room("Living Room").issues).toEqual([]);
  });

  it("places doors in room terms", () => {
    const [entry, window] = room("Living Room").openings;
    // Bottom wall runs right to left: 20 in from the plan's left corner is 130 in from its start.
    expect(entry).toMatchObject({ type: "door", wall: 2, offset: 130, width: 36, swing: "in", hinge: "right", confirmed: false });
    expect(window).toMatchObject({ type: "window", wall: 0, offset: 68, width: 48 });
    expect(room("Bedroom").openings[0]).toMatchObject({ wall: 3, offset: 4, width: 32, hinge: "left" });
    expect(room("Closet").openings[0]).toMatchObject({ type: "closet_door", operation: "sliding", wall: 0, offset: 4, width: 40 });
  });

  it("places built-ins in room inches, unconfirmed, and marks doubtful ones", () => {
    // Living room starts at px (30, 30), labeled scale 2.5 px/in: the fireplace is
    // flush with the right wall, 48 in from the top.
    expect(room("Living Room").builtIns).toEqual([
      expect.objectContaining({ label: "fireplace", x: 162, y: 48, width: 24, length: 48, confirmed: false }),
    ]);
    expect(room("Living Room").doubtfulBuiltIns).toEqual([]);
    const [vanity] = room("Bath").builtIns;
    expect(vanity).toMatchObject({ label: "vanity", confirmed: false });
    expect(room("Bath").doubtfulBuiltIns).toEqual([vanity.id]);
  });

  it("clips a built-in to its room and notes ones in no known room", () => {
    const odd = draftFromReading({
      ...fixture,
      built_ins: [
        { label: "counter", room: "Bedroom", bbox_px: { x: 800, y: 30, w: 100, h: 50 }, confidence: "high" },
        { label: "stairs", room: "Attic", bbox_px: { x: 0, y: 0, w: 10, h: 10 }, confidence: "high" },
      ],
    });
    const counter = odd.rooms.find((r) => r.name === "Bedroom")!.builtIns[0];
    expect(counter.x + counter.width).toBe(132);
    expect(odd.notes.join(" ")).toMatch(/1 built-in\(s\) couldn't be matched/);
  });

  it("marks doubtful openings", () => {
    expect(room("Bath").doubtfulOpenings).toHaveLength(1);
    expect(room("Living Room").doubtfulOpenings).toHaveLength(0);
  });

  it("asks for every size when no label can be read", () => {
    const blank = draftFromReading({ ...fixture, rooms: fixture.rooms.map((r) => ({ ...r, label_text: null })) });
    expect(blank.pxPerInch).toBeNull();
    expect(blank.rooms.every((r) => r.width === null && r.length === null)).toBe(true);
    expect(blank.notes.join(" ")).toMatch(/needs to be typed/);
  });

  it("produces rooms the fit engine can use, with walls tagged and doors confirmed", () => {
    const r = draftToRoom(room("Closet"), "c");
    expect(r.wallSources).toEqual(["inferred", "inferred", "inferred", "inferred"]);
    expect(r.openings.every((o) => o.confirmed)).toBe(true);
    const living = draftToRoom(room("Living Room"), "l");
    expect(living.builtIns?.map((b) => [b.label, b.confirmed])).toEqual([["fireplace", true]]);
    const report = evaluateRoom({ room: living, items: [], placements: [] }, defaultRules);
    expect(report.openings.map((o) => o.label)).toEqual(["entry door", "window"]);
  });
});

describe("L-shaped rooms", () => {
  // The living room read as an L: its top-right 100 x 150 px (40 x 60 in) is missing,
  // with a door on the inside corner's top-to-bottom wall.
  const reading = {
    ...fixture,
    rooms: fixture.rooms.map((r) => (r.name === "Living Room" ? { ...r, notch_px: { corner: "top_right" as const, w: 100, h: 150 } } : r)),
    openings: [
      ...fixture.openings.filter((o) => o.room !== "Living Room"),
      { type: "window" as const, room: "Living Room", wall: "top" as const, start_px: 50, end_px: 170, swing: "none" as const, hinge_at: "unknown" as const, confidence: "high" as const },
      { type: "door" as const, room: "Living Room", wall: "inner_down" as const, start_px: 60, end_px: 135, swing: "into_room" as const, hinge_at: "start" as const, confidence: "high" as const },
    ],
  };
  const plan = draftFromReading(reading);
  const living = plan.rooms.find((r) => r.name === "Living Room")!;

  it("keeps the overall size, measures the cut-out and asks for a check", () => {
    // An L's label may give only one arm, so the scale comes from the rectangles alone.
    const withoutLiving = draftFromReading({ ...fixture, rooms: fixture.rooms.filter((r) => r.name !== "Living Room") });
    expect(plan.pxPerInch).toBe(withoutLiving.pxPerInch);
    expect(living).toMatchObject({ width: 186, length: 144, notch: { corner: "top-right", width: 40, length: 60 }, notchSource: "inferred" });
    expect(living.issues.join(" ")).toMatch(/L-shaped/);
  });

  it("puts doors on the inside corner's walls", () => {
    const [door, window] = living.openings;
    // Walls of a top-right L: top, inner top-to-bottom, inner left-to-right, right, bottom, left.
    expect(door).toMatchObject({ type: "door", wall: 1, offset: 12, width: 30, hinge: "left" });
    expect(window).toMatchObject({ type: "window", wall: 0, offset: 8, width: 48 });
  });

  it("becomes a room the fit engine treats as an L, with the cut-out's walls tagged inferred", () => {
    const room = draftToRoom(living, "l");
    expect(room.outline).toHaveLength(6);
    expect(room.wallSources).toEqual(["labeled", "inferred", "inferred", "labeled", "labeled", "labeled"]);
    const box = { id: "b", nickname: "Box", kind: "generic", source: { type: "manual" as const }, width: 10, depth: 10, height: 10, footprint: { shape: "rect" as const }, addOns: [] };
    const report = evaluateRoom({ room, items: [box], placements: [{ id: "p", itemId: "b", roomId: "l", x: 170, y: 20, rotation: 0 }] }, defaultRules);
    expect(report.verdicts[0].reasons.map((r) => r.code)).toEqual(["outside-room"]);
  });
});

describe("draftFromText", () => {
  it("makes approximate rectangles with no doors", () => {
    const plan = draftFromText(parseListingText("Bedroom 2: 11' x 12'"));
    const r = draftToRoom(plan.rooms[0], "b");
    expect(r).toMatchObject({ name: "Bedroom 2", approximate: true, openings: [] });
    expect(r.outline[2]).toEqual({ x: 132, y: 144 });
    const report = evaluateRoom(
      {
        room: r,
        items: [{ id: "d", nickname: "Desk", kind: "desk", source: { type: "manual" }, width: 48, depth: 24, height: 30, footprint: { shape: "rect" }, addOns: [] }],
        placements: [{ id: "p", itemId: "d", roomId: "b", x: 66, y: 12, rotation: 0 }],
      },
      defaultRules,
    );
    expect(report.verdicts[0].approximate).toBe(true);
  });
});
