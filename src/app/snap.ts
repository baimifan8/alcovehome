// Snapping while dragging: flush against walls and other items' edges. Works on
// items and walls that are axis-aligned; anything rotated off-axis moves freely.

import { bboxSize, walls, type PlacedItem } from "../engine/index.ts";
import type { InventoryItem, Placement, Room } from "../model/types.ts";

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const axisAligned = (deg: number) => Math.abs(((deg % 90) + 90) % 90) < 1e-6;

export function boxOf(item: InventoryItem, p: Placement): Box {
  const { w, d } = bboxSize(item);
  const turned = Math.round(p.rotation / 90) % 2 !== 0;
  const hw = (turned ? d : w) / 2;
  const hd = (turned ? w : d) / 2;
  return { minX: p.x - hw, maxX: p.x + hw, minY: p.y - hd, maxY: p.y + hd };
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > -1;

/**
 * Snap `p` (item at its proposed spot) so an edge sits flush with a nearby wall or
 * item edge, when one is within `threshold` inches. Otherwise round to 0.5 in.
 */
export function snap(room: Room, item: InventoryItem, p: Placement, others: PlacedItem[], threshold: number): Placement {
  const round = (v: number) => Math.round(v * 2) / 2;
  if (!axisAligned(p.rotation)) return { ...p, x: round(p.x), y: round(p.y) };
  const b = boxOf(item, p);
  let bestX: number | null = null;
  let bestY: number | null = null;
  const tryX = (delta: number) => {
    if (Math.abs(delta) <= threshold && (bestX === null || Math.abs(delta) < Math.abs(bestX))) bestX = delta;
  };
  const tryY = (delta: number) => {
    if (Math.abs(delta) <= threshold && (bestY === null || Math.abs(delta) < Math.abs(bestY))) bestY = delta;
  };

  for (const w of walls(room)) {
    if (Math.abs(w.dir.y) < 1e-9) {
      // horizontal wall at y = w.a.y
      if (!overlaps(b.minX, b.maxX, Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x))) continue;
      tryY(w.a.y - (w.inward.y > 0 ? b.minY : b.maxY));
    } else if (Math.abs(w.dir.x) < 1e-9) {
      if (!overlaps(b.minY, b.maxY, Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y))) continue;
      tryX(w.a.x - (w.inward.x > 0 ? b.minX : b.maxX));
    }
  }

  for (const o of others) {
    if (!axisAligned(o.placement.rotation)) continue;
    const ob = boxOf(o.item, o.placement);
    if (overlaps(b.minY, b.maxY, ob.minY, ob.maxY)) {
      tryX(ob.maxX - b.minX);
      tryX(ob.minX - b.maxX);
    }
    if (overlaps(b.minX, b.maxX, ob.minX, ob.maxX)) {
      tryY(ob.maxY - b.minY);
      tryY(ob.minY - b.maxY);
    }
  }

  return {
    ...p,
    x: bestX === null ? round(p.x) : p.x + bestX,
    y: bestY === null ? round(p.y) : p.y + bestY,
  };
}
