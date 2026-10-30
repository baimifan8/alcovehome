import { describe, expect, it } from "vitest";
import { defaultRules, placeItem } from "../engine/index.ts";
import type { InventoryItem, Placement, Room } from "../model/types.ts";
import { snap } from "./snap.ts";
import { resizeRoom } from "./store.ts";

const room: Room = {
  id: "r",
  name: "R",
  outline: [
    { x: 0, y: 0 },
    { x: 144, y: 0 },
    { x: 144, y: 120 },
    { x: 0, y: 120 },
  ],
  wallSources: ["user-edited", "user-edited", "user-edited", "user-edited"],
  openings: [],
};
const desk: InventoryItem = {
  id: "desk",
  nickname: "Desk",
  kind: "desk",
  source: { type: "manual" },
  width: 48,
  depth: 24,
  height: 30,
  footprint: { shape: "rect" },
  addOns: [],
};
const at = (x: number, y: number, rotation = 0): Placement => ({ id: "p", itemId: "desk", roomId: "r", x, y, rotation });

describe("snap", () => {
  it("pulls an item flush to a nearby wall", () => {
    expect(snap(room, desk, at(72, 14.2), [], 4)).toMatchObject({ x: 72, y: 12 });
    expect(snap(room, desk, at(26.5, 60), [], 4)).toMatchObject({ x: 24 });
  });

  it("pulls an item that slightly overlaps a wall back inside", () => {
    expect(snap(room, desk, at(72, 10), [], 4)).toMatchObject({ y: 12 });
  });

  it("uses the rotated size", () => {
    // Rotated 90: 24 wide, 48 deep. Flush to the right wall means x = 144 - 12.
    expect(snap(room, desk, at(130, 60, 90), [], 4)).toMatchObject({ x: 132 });
  });

  it("snaps to the edge of another item", () => {
    const other = placeItem({ id: "o", itemId: "desk", roomId: "r", x: 72, y: 60, rotation: 0 }, desk, defaultRules);
    // Other spans x 48..96. Our left edge at 98.5 -> flush at 96.
    expect(snap(room, desk, at(122.5, 60), [other], 4)).toMatchObject({ x: 120 });
  });

  it("snaps to the edge of a built-in", () => {
    const withIsland = { ...room, builtIns: [{ id: "k", label: "island", x: 48, y: 48, width: 48, length: 24, confirmed: true }] };
    // Island spans x 48..96; our right edge at 46 -> flush at 48.
    expect(snap(withIsland, desk, at(22, 60), [], 4)).toMatchObject({ x: 24 });
  });

  it("rounds to half inches when nothing is close", () => {
    expect(snap(room, desk, at(70.3, 60.8), [], 4)).toMatchObject({ x: 70.5, y: 61 });
  });

  it("leaves off-axis rotations unsnapped except rounding", () => {
    expect(snap(room, desk, at(30.2, 13.1, 45), [], 4)).toMatchObject({ x: 30, y: 13 });
  });
});

describe("resizeRoom", () => {
  it("keeps built-ins, pulled back inside a smaller room", () => {
    const withCounter = { ...room, builtIns: [{ id: "k", label: "counter", x: 100, y: 0, width: 44, length: 24, confirmed: true }] };
    expect(resizeRoom(withCounter, 120, 120).builtIns).toEqual([{ id: "k", label: "counter", x: 76, y: 0, width: 44, length: 24, confirmed: true }]);
    expect(resizeRoom(withCounter, 30, 120).builtIns?.[0]).toMatchObject({ x: 0, width: 30 });
  });
});
