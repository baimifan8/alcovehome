import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRoom, withClearances, defaultRules } from "../index.ts";
import type { Footprint, InventoryItem, Opening, Placement, Room, WallSource } from "../../model/types.ts";

interface GoldenOpening extends Partial<Omit<Opening, "wall">> {
  id: string;
  type: Opening["type"];
  wall: "top" | "right" | "bottom" | "left" | number;
  offset: number;
  width: number;
}

interface GoldenCase {
  name: string;
  room: {
    width?: number;
    length?: number;
    outline?: [number, number][];
    openings: GoldenOpening[];
    wallSources?: Partial<Record<"top" | "right" | "bottom" | "left", WallSource>>;
  };
  clearances?: Record<string, number>;
  items: {
    id: string;
    kind: string;
    width: number;
    depth: number;
    footprint?: Footprint;
    x: number;
    y: number;
    rotation: number;
  }[];
  expect: Record<string, { result: string; codes: string[]; approximate?: boolean }>;
}

const WALLS = ["top", "right", "bottom", "left"] as const;

function buildRoom(c: GoldenCase["room"]): Room {
  const outline = c.outline
    ? c.outline.map(([x, y]) => ({ x, y }))
    : [
        { x: 0, y: 0 },
        { x: c.width!, y: 0 },
        { x: c.width!, y: c.length! },
        { x: 0, y: c.length! },
      ];
  const wallSources: WallSource[] = outline.map((_, i) => (!c.outline && c.wallSources?.[WALLS[i]]) || "labeled");
  const openings: Opening[] = c.openings.map((o) => ({
    operation: "swing",
    swing: "in",
    hinge: "left",
    confirmed: true,
    ...o,
    wall: typeof o.wall === "number" ? o.wall : WALLS.indexOf(o.wall),
  }));
  return { id: "room", name: "Room", outline, wallSources, openings };
}

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "cases");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("golden cases", () => {
  it("exist", () => expect(files.length).toBeGreaterThanOrEqual(20));

  for (const file of files) {
    const c: GoldenCase = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    it(`${file}: ${c.name}`, () => {
      const room = buildRoom(c.room);
      const items: InventoryItem[] = c.items.map((i) => ({
        id: i.id,
        nickname: i.id,
        kind: i.kind,
        source: { type: "manual" },
        width: i.width,
        depth: i.depth,
        height: 30,
        footprint: i.footprint ?? { shape: "rect" },
        addOns: [],
      }));
      const placements: Placement[] = c.items.map((i) => ({
        id: i.id,
        itemId: i.id,
        roomId: room.id,
        x: i.x,
        y: i.y,
        rotation: i.rotation,
      }));
      const rules = c.clearances ? withClearances(defaultRules, c.clearances) : defaultRules;
      const report = evaluateRoom({ room, items, placements }, rules);

      const got = Object.fromEntries(
        report.verdicts.map((v) => [
          v.placementId,
          {
            result: v.result,
            codes: [...new Set(v.reasons.map((r) => r.code))].sort(),
            approximate: v.approximate,
            messages: v.reasons.map((r) => r.message),
          },
        ]),
      );
      for (const [id, want] of Object.entries(c.expect)) {
        const g = got[id];
        expect(g, `no verdict for ${id}`).toBeDefined();
        const ctx = `${id}: ${JSON.stringify(g.messages)}`;
        expect(g.result, ctx).toBe(want.result);
        expect(g.codes, ctx).toEqual([...want.codes].sort());
        if (want.approximate !== undefined) expect(g.approximate, ctx).toBe(want.approximate);
      }
    });
  }
});
