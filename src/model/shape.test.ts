import { describe, expect, it } from "vitest";
import { defaultRules, evaluateRoom } from "../engine/index.ts";
import type { Opening, Room } from "./types.ts";
import { clampShape, openingFromEdge, reshapeRoom, shapeOf, shapeOutline, type RoomShape } from "./shape.ts";

const room = (shape: RoomShape, openings: Opening[] = []): Room => {
  const { outline } = shapeOutline(shape);
  return { id: "r", name: "R", outline, wallSources: outline.map(() => "labeled"), openings };
};
const door = (wall: number, offset: number, width = 32): Opening => ({
  id: `d${wall}`,
  type: "door",
  wall,
  offset,
  width,
  operation: "swing",
  swing: "in",
  hinge: "left",
  confirmed: true,
});

describe("room shapes", () => {
  it("builds a rectangle with walls top, right, bottom, left", () => {
    expect(shapeOutline({ width: 144, length: 120, notch: null })).toEqual({
      outline: [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 120 },
        { x: 0, y: 120 },
      ],
      roles: ["top", "right", "bottom", "left"],
    });
  });

  it("builds an L the same way the golden L-room case is drawn", () => {
    // golden case 26: [[0,0],[144,0],[144,60],[72,60],[72,120],[0,120]]
    const { outline, roles } = shapeOutline({ width: 144, length: 120, notch: { corner: "bottom-right", width: 72, length: 60 } });
    expect(outline.map((p) => [p.x, p.y])).toEqual([[0, 0], [144, 0], [144, 60], [72, 60], [72, 120], [0, 120]]);
    expect(roles).toEqual(["top", "right", "notch-across", "notch-down", "bottom", "left"]);
  });

  it.each(["top-left", "top-right", "bottom-right", "bottom-left"] as const)("round-trips an L cut at the %s corner, starting with the top wall", (corner) => {
    const shape: RoomShape = { width: 150, length: 130, notch: { corner, width: 40, length: 50 } };
    const r = room(shape);
    expect(shapeOf(r)).toEqual(shape);
    const { roles } = shapeOutline(shape);
    expect(roles[0]).toBe("top");
    expect([...roles].sort()).toEqual(["bottom", "left", "notch-across", "notch-down", "right", "top"]);
    // Every wall is axis-aligned and the room's inside is on its right: the fit engine
    // accepts a piece in the arm and refuses one in the cut-out.
    const nx = corner.endsWith("left") ? 20 : 130;
    const ny = corner.startsWith("top") ? 25 : 105;
    const piece = (id: string, x: number, y: number) => ({ id, itemId: "box", roomId: "r", x, y, rotation: 0 });
    const report = evaluateRoom(
      {
        room: r,
        items: [{ id: "box", nickname: "box", kind: "generic", source: { type: "manual" }, width: 10, depth: 10, height: 10, footprint: { shape: "rect" }, addOns: [] }],
        placements: [piece("cut", nx, ny), piece("ok", 150 - nx, 130 - ny)],
      },
      defaultRules,
    );
    expect(report.verdicts.map((v) => [v.placementId, v.result])).toEqual([
      ["cut", "doesnt-fit"],
      ["ok", "fits"],
    ]);
  });

  it("doesn't recognize other polygons", () => {
    expect(shapeOf({ ...room({ width: 100, length: 100, notch: null }), outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })).toBeNull();
  });

  it("keeps a cut-out that leaves room on both sides", () => {
    expect(clampShape({ width: 100, length: 100, notch: { corner: "top-left", width: 99, length: 5 } }).notch).toEqual({ corner: "top-left", width: 88, length: 12 });
    expect(clampShape({ width: 20, length: 100, notch: { corner: "top-left", width: 10, length: 10 } }).notch).toBeNull();
  });
});

describe("reshapeRoom", () => {
  it("cuts a corner out of a rectangle, keeping doors where they were on the plan", () => {
    // Doors on the bottom wall at x 100…132 and on the left wall.
    const rect = room({ width: 144, length: 120, notch: null }, [door(2, 12), door(3, 10)]);
    const fromEdge = rect.openings.map((o) => openingFromEdge(rect, o));
    const l = reshapeRoom(rect, { width: 144, length: 120, notch: { corner: "bottom-right", width: 72, length: 60 } });
    expect(shapeOf(l)?.notch?.corner).toBe("bottom-right");
    // The bottom wall is now x 0…72 (wall 4); the door slides back onto it.
    expect(l.openings[0]).toMatchObject({ wall: 4, width: 32 });
    expect(openingFromEdge(l, l.openings[0])).toBe(40);
    // The left wall is unchanged, so its door stays put.
    expect(l.openings[1].wall).toBe(5);
    expect(openingFromEdge(l, l.openings[1])).toBe(fromEdge[1]);
    // Walls that changed length were just typed; the left wall keeps its source.
    expect(l.wallSources).toEqual(["labeled", "user-edited", "user-edited", "user-edited", "user-edited", "labeled"]);
  });

  it("moves doors on the cut-out's walls to the outer wall when the room becomes a rectangle", () => {
    const l = room({ width: 144, length: 120, notch: { corner: "top-right", width: 40, length: 50 } });
    const withDoor = { ...l, openings: [door(1, 4, 30)] }; // wall 1 = notch-down, x = 104
    const rect = reshapeRoom(withDoor, { width: 144, length: 120, notch: null });
    expect(rect.outline).toHaveLength(4);
    expect(rect.openings[0]).toMatchObject({ wall: 1, width: 30 }); // now on the right wall
  });

  it("resizes an L, keeping its cut-out and built-ins inside", () => {
    const l = { ...room({ width: 144, length: 120, notch: { corner: "top-left", width: 40, length: 40 } }), builtIns: [{ id: "k", label: "counter", x: 110, y: 90, width: 30, length: 24, confirmed: true }] };
    const smaller = reshapeRoom(l, { ...shapeOf(l)!, width: 120 });
    expect(shapeOf(smaller)).toEqual({ width: 120, length: 120, notch: { corner: "top-left", width: 40, length: 40 } });
    expect(smaller.builtIns?.[0]).toMatchObject({ x: 90 });
  });
});
