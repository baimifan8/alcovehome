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
    const report = evaluateRoom({ room: living, items: [], placements: [] }, defaultRules);
    expect(report.openings.map((o) => o.label)).toEqual(["entry door", "window"]);
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
