import { describe, expect, it } from "vitest";
import type { InventoryItem, Placement, Room } from "../model/types.ts";
import { containment, overlapDepth, rectPoly } from "./geometry.ts";
import { bboxSize, defaultRules, evaluateRoom, suggest } from "./index.ts";

const room: Room = {
  id: "r",
  name: "Bedroom",
  outline: [
    { x: 0, y: 0 },
    { x: 144, y: 0 },
    { x: 144, y: 120 },
    { x: 0, y: 120 },
  ],
  wallSources: ["labeled", "labeled", "labeled", "labeled"],
  openings: [
    { id: "entry", type: "door", wall: 2, offset: 106, width: 32, operation: "swing", swing: "in", hinge: "right", confirmed: true },
  ],
};

const item = (id: string, kind: string, width: number, depth: number): InventoryItem => ({
  id,
  nickname: id,
  kind,
  source: { type: "manual" },
  width,
  depth,
  height: 30,
  footprint: { shape: "rect" },
  addOns: [],
});

describe("geometry", () => {
  it("treats touching shapes as not overlapping", () => {
    expect(overlapDepth(rectPoly(0, 0, 10, 10), rectPoly(10, 0, 10, 10))).toBe(0);
    expect(overlapDepth(rectPoly(0, 0, 10, 10), rectPoly(9, 0, 10, 10))).toBeCloseTo(1);
  });
  it("classifies containment", () => {
    const outline = room.outline;
    expect(containment(rectPoly(0, 0, 10, 10), outline)).toBe("inside");
    expect(containment(rectPoly(-5, 0, 10, 10), outline)).toBe("crosses");
    expect(containment(rectPoly(200, 0, 10, 10), outline)).toBe("outside");
  });
});

describe("evaluateRoom", () => {
  it("is pure: same input, same output, input untouched", () => {
    const placements: Placement[] = [{ id: "p", itemId: "desk", roomId: "r", x: 20, y: 12, rotation: 0 }];
    const input = { room, items: [item("desk", "desk", 48, 24)], placements };
    const snapshot = JSON.stringify(input);
    const a = evaluateRoom(input, defaultRules);
    const b = evaluateRoom(input, defaultRules);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(a.verdicts).toEqual(b.verdicts);
  });

  it("ignores placements whose item is missing", () => {
    const placements: Placement[] = [{ id: "p", itemId: "gone", roomId: "r", x: 20, y: 12, rotation: 0 }];
    expect(evaluateRoom({ room, items: [], placements }, defaultRules).verdicts).toEqual([]);
  });

  it("can skip the walkway check for fast feedback while dragging", () => {
    const placements: Placement[] = [{ id: "p", itemId: "d", roomId: "r", x: 86.5, y: 60, rotation: 0 }];
    const closet = { ...room, openings: [...room.openings, { id: "c", type: "closet_door" as const, wall: 0, offset: 100, width: 40, operation: "sliding" as const, swing: "in" as const, hinge: "left" as const, confirmed: true }] };
    const input = { room: closet, items: [item("d", "generic", 115, 20)], placements };
    expect(evaluateRoom(input, defaultRules).verdicts[0].result).toBe("tight");
    const fast = evaluateRoom(input, defaultRules, { skipWalkway: true });
    expect(fast.verdicts[0].result).toBe("fits");
    expect(fast.walkway.checked).toBe(false);
  });

  it("says when there is no entry door to check walkways from", () => {
    const placements: Placement[] = [{ id: "p", itemId: "d", roomId: "r", x: 72, y: 12, rotation: 0 }];
    const report = evaluateRoom({ room: { ...room, openings: [] }, items: [item("d", "desk", 48, 24)], placements }, defaultRules);
    expect(report.walkway.notes).toContain("Add an entry door to check walkways.");
  });
});

describe("suggest (tier 3)", () => {
  const items = [item("desk", "desk", 48, 24)];
  const placements: Placement[] = [{ id: "p", itemId: "desk", roomId: "r", x: 20, y: 12, rotation: 0 }];

  it("offers a change that fixes the item", () => {
    const s = suggest({ room, items, placements }, defaultRules, "p", "Desk");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].message).toBe("Move Desk 6 in right");
    const after = evaluateRoom({ room, items, placements: [s[0].placement] }, defaultRules);
    expect(after.verdicts[0].result).toBe("fits");
  });

  it("never changes the verdict it advises on", () => {
    const before = evaluateRoom({ room, items, placements }, defaultRules);
    suggest({ room, items, placements }, defaultRules, "p", "Desk");
    expect(evaluateRoom({ room, items, placements }, defaultRules)).toEqual(before);
  });

  it("offers nothing for an item that already fits", () => {
    const ok: Placement[] = [{ ...placements[0], x: 72 }];
    expect(suggest({ room, items, placements: ok }, defaultRules, "p", "Desk")).toEqual([]);
  });
});

describe("overrides and add-ons", () => {
  const base = item("desk", "desk", 48, 24);
  const at = (x: number): Placement[] => [{ id: "p", itemId: "desk", roomId: "r", x, y: 12, rotation: 0 }];

  it("uses the user's own size instead of the store's", () => {
    // 48 in wide flush against the left wall at x = 24 fits; 60 in wide crosses it.
    const mine = { ...base, overrides: { width: 60 } };
    expect(evaluateRoom({ room, items: [base], placements: at(24) }, defaultRules).verdicts[0].result).toBe("fits");
    expect(evaluateRoom({ room, items: [mine], placements: at(24) }, defaultRules).verdicts[0].reasons.map((r) => r.code)).toContain("wall");
  });

  it("adds switched-on add-ons to the size, and ignores switched-off ones", () => {
    const leaf = { id: "a", label: "leaf", width: 18, depth: 0, height: 0, on: true };
    expect(evaluateRoom({ room, items: [{ ...base, addOns: [leaf] }], placements: at(24) }, defaultRules).verdicts[0].result).toBe("doesnt-fit");
    expect(evaluateRoom({ room, items: [{ ...base, addOns: [{ ...leaf, on: false }] }], placements: at(24) }, defaultRules).verdicts[0].result).toBe("fits");
  });

  it("keeps an L-shaped piece's return when depth grows", () => {
    const sofa: InventoryItem = { ...item("s", "sofa", 100, 36), footprint: { shape: "l", side: "left", returnWidth: 36, returnDepth: 66 } };
    const deeper = { ...sofa, addOns: [{ id: "a", label: "deeper cushions", width: 0, depth: 4, height: 0, on: true }] };
    expect(bboxSize(deeper)).toEqual({ w: 100, d: 70 });
  });
});
