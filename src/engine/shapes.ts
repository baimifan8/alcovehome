// World-space shapes for items, their use zones, walls and openings.

import { effectiveItem } from "../model/size.ts";
import type { InventoryItem, Opening, Placement, Point, Room } from "../model/types.ts";
import { add, rectPoly, rotate, scale, sub, unit, type Poly } from "./geometry.ts";
import { clearance, kindRule, type Rules, type Side, type ZoneRule } from "./rules.ts";

/** Axis-aligned rectangle in an item's own frame (see Footprint in types.ts). */
export interface LocalRect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export function localRects(raw: InventoryItem): LocalRect[] {
  const item = effectiveItem(raw);
  const main = { x: 0, y: 0, w: item.width, d: item.depth };
  const fp = item.footprint;
  if (fp.shape !== "l" || fp.returnDepth <= item.depth || fp.returnWidth <= 0) return [main];
  const rw = Math.min(fp.returnWidth, item.width);
  return [main, { x: fp.side === "left" ? 0 : item.width - rw, y: item.depth, w: rw, d: fp.returnDepth - item.depth }];
}

/** Overall bounding box of the footprint in the item's own frame. */
export function bboxSize(raw: InventoryItem) {
  const item = effectiveItem(raw);
  const fp = item.footprint;
  return { w: item.width, d: fp.shape === "l" ? Math.max(item.depth, fp.returnDepth) : item.depth };
}

export interface ZoneShape {
  rule: ZoneRule;
  depth: number;
  /** Polygons per side, already clipped so they don't cover the item itself. */
  sides: { side: Side; polys: Poly[] }[];
}

export interface PlacedItem {
  placement: Placement;
  item: InventoryItem;
  name: string;
  rects: LocalRect[];
  /** Footprint polygons in room coordinates (one per local rect, all convex). */
  polys: Poly[];
  zones: ZoneShape[];
  toWorld: (p: Point) => Point;
}

/** `item` is folded to its effective size (overrides and add-ons), and kept that way on the result. */
export function placeItem(placement: Placement, raw: InventoryItem, rules: Rules): PlacedItem {
  const item = effectiveItem(raw);
  const rects = localRects(item);
  const box = bboxSize(item);
  const toWorld = (p: Point) =>
    add({ x: placement.x, y: placement.y }, rotate({ x: p.x - box.w / 2, y: p.y - box.d / 2 }, placement.rotation));
  const rectToWorld = (r: LocalRect) => rectPoly(r.x, r.y, r.w, r.d).map(toWorld);

  const zones = kindRule(rules, item.kind).zones.map((rule) => {
    const depth = clearance(rules, rule.clearance);
    return {
      rule,
      depth,
      sides: rule.sides.map((side) => ({ side, polys: zoneRects(rects, side, depth).map(rectToWorld) })),
    };
  });

  return {
    placement,
    item,
    name: item.nickname || kindRule(rules, item.kind).label,
    rects,
    polys: rects.map(rectToWorld),
    zones,
    toWorld,
  };
}

/** Strips of `depth` along one side of each footprint rect, minus the footprint itself. */
export function zoneRects(rects: LocalRect[], side: Side, depth: number): LocalRect[] {
  if (depth <= 0) return [];
  let strips = rects.map((r) => {
    switch (side) {
      case "front":
        return { x: r.x, y: r.y + r.d, w: r.w, d: depth };
      case "back":
        return { x: r.x, y: r.y - depth, w: r.w, d: depth };
      case "left":
        return { x: r.x - depth, y: r.y, w: depth, d: r.d };
      case "right":
        return { x: r.x + r.w, y: r.y, w: depth, d: r.d };
    }
  });
  for (const r of rects) strips = strips.flatMap((s) => subtractRect(s, r));
  return strips.filter((s) => s.w > 1e-6 && s.d > 1e-6);
}

function subtractRect(a: LocalRect, b: LocalRect): LocalRect[] {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.d, b.y + b.d);
  if (x2 - x1 <= 1e-9 || y2 - y1 <= 1e-9) return [a];
  const out: LocalRect[] = [];
  if (y1 > a.y) out.push({ x: a.x, y: a.y, w: a.w, d: y1 - a.y });
  if (y2 < a.y + a.d) out.push({ x: a.x, y: y2, w: a.w, d: a.y + a.d - y2 });
  if (x1 > a.x) out.push({ x: a.x, y: y1, w: x1 - a.x, d: y2 - y1 });
  if (x2 < a.x + a.w) out.push({ x: x2, y: y1, w: a.x + a.w - x2, d: y2 - y1 });
  return out;
}

export interface WallInfo {
  index: number;
  a: Point;
  b: Point;
  /** Unit vector from a to b. */
  dir: Point;
  /** Unit normal pointing into the room. */
  inward: Point;
  length: number;
  name: string;
}

export function walls(room: Room): WallInfo[] {
  const pts = room.outline;
  return pts.map((a, index) => {
    const b = pts[(index + 1) % pts.length];
    const dir = unit(sub(b, a));
    const inward = { x: -dir.y, y: dir.x };
    return { index, a, b, dir, inward, length: Math.hypot(b.x - a.x, b.y - a.y), name: wallName(inward) };
  });
}

/** Plan-relative wall name from the direction the wall faces. */
function wallName(inward: Point): string {
  if (inward.y > 0.9) return "top wall";
  if (inward.y < -0.9) return "bottom wall";
  if (inward.x < -0.9) return "right wall";
  if (inward.x > 0.9) return "left wall";
  return "angled wall";
}

export interface OpeningShape {
  opening: Opening;
  label: string;
  /** Jambs: p0 nearer the wall's start vertex, p1 nearer its end. */
  p0: Point;
  p1: Point;
  inward: Point;
  /** Areas furniture must keep clear (tier 0). Empty for windows. */
  keepClear: Poly[];
  /** Swing arc, for drawing; null unless a door swings into the room. */
  arc: { hinge: Point; closedTip: Point; radius: number } | null;
}

const ARC_STEPS = 16;

export function openingLabel(o: Opening, isEntry: boolean): string {
  if (o.label) return o.label;
  if (isEntry) return o.type === "passage" ? "entry opening" : "entry door";
  if (o.type === "closet_door") return "closet door";
  if (o.type === "window") return "window";
  if (o.type === "passage") return "opening";
  return "door";
}

export function openingShape(room: Room, o: Opening, rules: Rules): OpeningShape {
  const w = walls(room)[o.wall];
  const p0 = add(w.a, scale(w.dir, o.offset));
  const p1 = add(w.a, scale(w.dir, o.offset + o.width));
  const shape: OpeningShape = { opening: o, label: openingLabel(o, entryOpening(room)?.id === o.id), p0, p1, inward: w.inward, keepClear: [], arc: null };
  if (o.type === "window") return shape;

  const isDoor = o.type === "door" || o.type === "closet_door";
  let depth = clearance(rules, "doorwayFront");
  if (isDoor && o.operation === "bifold") depth = Math.max(depth, o.width * rules.doors.bifoldProjection);
  shape.keepClear.push([p0, p1, add(p1, scale(w.inward, depth)), add(p0, scale(w.inward, depth))]);

  if (isDoor && o.operation === "swing" && o.swing === "in") {
    const hinge = o.hinge === "left" ? p0 : p1;
    const toward = unit(sub(o.hinge === "left" ? p1 : p0, hinge));
    const sector: Poly = [hinge];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = (i / ARC_STEPS) * (Math.PI / 2);
      sector.push(add(hinge, add(scale(toward, o.width * Math.cos(t)), scale(w.inward, o.width * Math.sin(t)))));
    }
    shape.keepClear.push(sector);
    shape.arc = { hinge, closedTip: add(hinge, scale(toward, o.width)), radius: o.width };
  }
  return shape;
}

/** The opening people come in through: the one marked entry, else the first door or passage. */
export function entryOpening(room: Room): Opening | null {
  return (
    room.openings.find((o) => o.entry && (o.type === "door" || o.type === "passage")) ??
    room.openings.find((o) => o.type === "door" || o.type === "passage") ??
    null
  );
}
