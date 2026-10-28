// The fit engine: layout + items in, verdicts out. Pure; reads all clearances and use
// zones from the rules it is given (SPEC.md, "Fit engine rules").

import type { InventoryItem, Placement, Point, Reason, Result, Room, Verdict } from "../model/types.ts";
import {
  containment,
  distPointPolygonBoundary,
  distPolySegment,
  overlapDepth,
  pointInOrOn,
  rectPoly,
  type Poly,
} from "./geometry.ts";
import { clearance, type Rules, type Side } from "./rules.ts";
import {
  entryOpening,
  openingShape,
  placeItem,
  walls,
  zoneRects,
  type OpeningShape,
  type PlacedItem,
  type ZoneShape,
} from "./shapes.ts";
import { checkWalkways, type WalkwayResult, type WalkwayTarget } from "./walkway.ts";

export interface RoomInput {
  room: Room;
  items: InventoryItem[];
  /** Placements in this room. Placements whose item is missing are ignored. */
  placements: Placement[];
}

export interface EvaluateOptions {
  /** Skip the walkway check (tier 2), e.g. while an item is being dragged. */
  skipWalkway?: boolean;
  /** How lengths appear in reason messages, e.g. in the user's units. Defaults to "30 in". */
  format?: (inches: number) => string;
}

export interface ZoneStatus {
  placementId: string;
  zone: ZoneShape;
  /** Per side: clear depth available, up to the required depth. */
  available: Record<string, number>;
  ok: boolean;
}

export interface RoomReport {
  verdicts: Verdict[];
  zones: ZoneStatus[];
  openings: OpeningShape[];
  walkway: {
    checked: boolean;
    required: number;
    results: WalkwayResult[];
    /** Room-level findings that no single item causes. */
    notes: string[];
  };
}

export const formatInches = (inches: number) => `${Math.round(inches)} in`;
const RANK: Record<Result, number> = { fits: 0, tight: 1, "doesnt-fit": 2 };

export function evaluateRoom(input: RoomInput, rules: Rules, options: EvaluateOptions = {}): RoomReport {
  const { room } = input;
  const fmt = options.format ?? formatInches;
  const outline: Poly = room.outline;
  const itemById = new Map(input.items.map((i) => [i.id, i]));
  const placed: PlacedItem[] = input.placements
    .filter((p) => itemById.has(p.itemId))
    .map((p) => placeItem(p, itemById.get(p.itemId)!, rules));
  const openings = room.openings.map((o) => openingShape(room, o, rules));
  const reasons = new Map<string, Reason[]>(placed.map((p) => [p.placement.id, []]));
  const add = (id: string, r: Reason) => reasons.get(id)!.push(r);

  // Tier 0: walls, other items, doors.
  const blockedOpenings = new Set<string>();
  for (const p of placed) {
    const status = p.polys.map((poly) => containment(poly, outline));
    if (status.every((s) => s === "outside")) {
      add(p.placement.id, { tier: 0, code: "outside-room", message: "is outside the room", related: [] });
    } else if (status.some((s) => s !== "inside")) {
      add(p.placement.id, { tier: 0, code: "wall", message: wallMessage(p, room, fmt), related: [] });
    }

    for (const q of placed) {
      if (q === p) continue;
      const depth = maxOverlap(p.polys, q.polys);
      if (depth > 0) {
        add(p.placement.id, {
          tier: 0,
          code: "item-overlap",
          message: `overlaps ${q.name} by ${fmt(depth)}`,
          related: [q.placement.id],
        });
      }
    }

    for (const o of openings) {
      if (!o.keepClear.length) continue;
      if (maxOverlap(p.polys, o.keepClear) > 0) {
        blockedOpenings.add(o.opening.id);
        const closet = o.opening.type === "closet_door";
        const what = o.arc ? `${o.label} swing` : o.label;
        add(p.placement.id, {
          tier: 0,
          code: closet ? "closet-door" : "door",
          message: `blocks the ${what}`,
          related: [o.opening.id],
        });
      }
    }
  }

  // Tier 1: use zones must be clear of walls and other items.
  const zones: ZoneStatus[] = [];
  for (const p of placed) {
    const others = placed.filter((q) => q !== p);
    for (const zone of p.zones) {
      const available: Record<string, number> = {};
      const blockers = new Set<string>();
      for (const s of zone.sides) {
        available[s.side] = clearDepth(p, zone, s.side, outline, others);
        if (available[s.side] < zone.depth - 1e-6) {
          for (const name of zoneBlockers(s.polys, outline, others)) blockers.add(name);
        }
      }
      const depths = Object.values(available);
      const ok = zone.rule.mode === "any" ? depths.some((d) => d >= zone.depth - 1e-6) : depths.every((d) => d >= zone.depth - 1e-6);
      zones.push({ placementId: p.placement.id, zone, available, ok });
      if (!ok) {
        add(p.placement.id, {
          tier: 1,
          code: "use-zone",
          message: zoneMessage(zone, available, [...blockers], fmt),
          related: [],
        });
      }
    }
  }

  // Tier 2: walkway from the entry to every other door and every clear use zone.
  const required = clearance(rules, "mainWalkway");
  const entry = entryOpening(room);
  const notes: string[] = [];
  let results: WalkwayResult[] = [];
  const hasTier0 = (id: string) => reasons.get(id)!.some((r) => r.tier === 0);
  if (!options.skipWalkway && entry) {
    const entryShape = openings.find((o) => o.opening.id === entry.id)!;
    const targets: WalkwayTarget[] = [];
    for (const o of openings) {
      if (o.opening.id === entry.id || o.opening.type === "window" || blockedOpenings.has(o.opening.id)) continue;
      targets.push({ id: o.opening.id, label: `the ${o.label}`, shape: { kind: "segment", a: o.p0, b: o.p1 } });
    }
    for (const z of zones) {
      if (!z.ok || hasTier0(z.placementId)) continue;
      const p = placed.find((q) => q.placement.id === z.placementId)!;
      const sides = z.zone.sides.filter((s) => z.zone.rule.mode === "all" || z.available[s.side] >= z.zone.depth - 1e-6);
      const polys = sides.flatMap((s) => s.polys);
      if (polys.length) {
        targets.push({ id: `${z.placementId}:${z.zone.rule.label}`, label: `${p.name}'s ${z.zone.rule.label}`, shape: { kind: "polys", polys } });
      }
    }
    results = checkWalkways(
      outline,
      placed.map((p) => ({ id: p.placement.id, polys: p.polys })),
      { a: entryShape.p0, b: entryShape.p1 },
      targets,
      required,
    );
    // One walkway reason per item, naming every destination it narrows the way to.
    const blamed = new Map<string, WalkwayResult[]>();
    for (const r of results) {
      if (r.ok) continue;
      for (const id of r.narrowedBy) blamed.set(id, [...(blamed.get(id) ?? []), r]);
      if (!r.narrowedBy.length) notes.push(`The walls leave only ${fmt(r.width)} between the ${entryShape.label} and ${r.label}.`);
    }
    for (const [id, rs] of blamed) {
      const width = Math.min(...rs.map((r) => r.width));
      const to = listJoin(rs.map((r) => r.label));
      add(id, {
        tier: 2,
        code: "walkway",
        message:
          width === 0
            ? `blocks the way from the ${entryShape.label} to ${to}`
            : `narrows the walkway to ${fmt(width)} (needs ${fmt(required)}) between the ${entryShape.label} and ${to}`,
        related: rs.map((r) => r.targetId),
      });
    }
  }
  if (!options.skipWalkway && !entry && placed.length) {
    notes.push("Add an entry door to check walkways.");
  }

  // Confidence: anything that depends on an inferred wall or unconfirmed opening.
  const ws = walls(room);
  const verdicts: Verdict[] = placed.map((p) => {
    const rs = reasons.get(p.placement.id)!.sort((a, b) => a.tier - b.tier);
    const result: Result = rs.some((r) => r.tier === 0) ? "doesnt-fit" : rs.length ? "tight" : "fits";
    const reach = Math.max(required, ...p.zones.map((z) => z.depth));
    const approximateReasons: string[] = [];
    for (const w of ws) {
      if (room.wallSources[w.index] !== "inferred") continue;
      if (Math.min(...p.polys.map((poly) => distPolySegment(poly, w.a, w.b))) <= reach) {
        approximateReasons.push(`depends on the ${w.name}, whose length was inferred, not labeled`);
      }
    }
    for (const o of openings) {
      if (o.opening.confirmed) continue;
      if (Math.min(...p.polys.map((poly) => distPolySegment(poly, o.p0, o.p1))) <= o.opening.width + required) {
        approximateReasons.push(`is near the ${o.label}, which hasn't been confirmed`);
      }
    }
    return {
      placementId: p.placement.id,
      result,
      reasons: rs,
      approximate: approximateReasons.length > 0,
      approximateReasons,
    };
  });

  return { verdicts, zones, openings, walkway: { checked: !options.skipWalkway && !!entry, required, results, notes } };
}

export function worse(a: Result, b: Result): boolean {
  return RANK[a] > RANK[b];
}

function listJoin(xs: string[]): string {
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function maxOverlap(a: Poly[], b: Poly[]): number {
  let m = 0;
  for (const p of a) for (const q of b) m = Math.max(m, overlapDepth(p, q));
  return m;
}

function wallMessage(p: PlacedItem, room: Room, fmt: (inches: number) => string): string {
  // How far the deepest outside corner sticks out, and through which wall.
  let worst = 0;
  let wallName = "";
  const ws = walls(room);
  for (const poly of p.polys) {
    for (const v of poly) {
      if (pointInOrOn(v, room.outline)) continue;
      const d = distPointPolygonBoundary(v, room.outline);
      if (d > worst) {
        worst = d;
        wallName = nearestWall(v, ws).name;
      }
    }
  }
  return worst > 0 ? `goes ${fmt(Math.max(1, worst))} into the ${wallName}` : "crosses a wall";
}

function nearestWall(v: Point, ws: ReturnType<typeof walls>) {
  return ws.reduce((best, w) => (distPolySegment([v], w.a, w.b) < distPolySegment([v], best.a, best.b) ? w : best));
}

/** Largest depth (≤ the zone's) at which this side's strips are clear. */
function clearDepth(p: PlacedItem, zone: ZoneShape, side: Side, outline: Poly, others: PlacedItem[]): number {
  const full = zone.sides.find((s) => s.side === side)!.polys;
  if (isClear(full, outline, others)) return zone.depth;
  const at = (d: number) => zoneRects(p.rects, side, d).map((r) => rectPoly(r.x, r.y, r.w, r.d).map(p.toWorld));
  let lo = 0;
  let hi = zone.depth;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (isClear(at(mid), outline, others)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function isClear(polys: Poly[], outline: Poly, others: PlacedItem[]): boolean {
  for (const z of polys) {
    if (containment(z, outline) !== "inside") return false;
    for (const q of others) if (maxOverlap([z], q.polys) > 0) return false;
  }
  return true;
}

function zoneBlockers(polys: Poly[], outline: Poly, others: PlacedItem[]): string[] {
  const out = new Set<string>();
  for (const z of polys) {
    if (containment(z, outline) !== "inside") out.add("wall");
    for (const q of others) if (maxOverlap([z], q.polys) > 0) out.add(q.name);
  }
  return [...out];
}

function zoneMessage(
  zone: ZoneShape,
  available: Record<string, number>,
  blockers: string[],
  fmt: (inches: number) => string,
): string {
  const need = fmt(zone.depth);
  const by = blockers.length ? ` (${blockers.join(", ")})` : "";
  const sides = Object.entries(available);
  if (zone.rule.mode === "any" && sides.length > 1) {
    const list = sides.map(([side, d]) => `${side} has ${fmt(d)}`).join(", ");
    return `${zone.rule.label} needs ${need} on at least one side; ${list}${by}`;
  }
  const have = Math.min(...sides.map(([, d]) => d));
  return `${zone.rule.label} needs ${need}, has ${fmt(have)}${by}`;
}

