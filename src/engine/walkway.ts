// Tier 2: is there a walkway at least `required` inches wide from the entry to every
// other door and every usable zone?
//
// The room is rasterized on a fine grid. Each free cell gets the width of the widest
// corridor centered on it (twice the distance to the nearest blocked cell). A
// widest-path search from the entry then gives, for every target, the narrowest
// point on the best route to it. Items next to a too-narrow point on that route are
// the ones narrowing the walkway.

import type { Point } from "../model/types.ts";
import { bounds, distPointPolygon, distPointSegment, pointInPolygon, type Poly } from "./geometry.ts";

export const CELL = 0.5;

export interface WalkwayTarget {
  id: string;
  label: string;
  /** Reached when the walkway's centerline gets within half a walkway of this shape. */
  shape: { kind: "segment"; a: Point; b: Point } | { kind: "polys"; polys: Poly[] };
}

export interface WalkwayObstacle {
  id: string;
  polys: Poly[];
}

export interface WalkwayResult {
  targetId: string;
  label: string;
  /** Narrowest point on the best route, inches. 0 means no clear route at all. */
  width: number;
  ok: boolean;
  /** The best route from the entry, as plan points. */
  path: Point[];
  /** Points on the route narrower than required. */
  narrow: Point[];
  /** Obstacles (item ids) next to those narrow points. */
  narrowedBy: string[];
}

export function checkWalkways(
  outline: Poly,
  obstacles: WalkwayObstacle[],
  entry: { a: Point; b: Point },
  targets: WalkwayTarget[],
  required: number,
): WalkwayResult[] {
  if (!targets.length) return [];
  const reach = required / 2 + 1;
  const b = bounds(outline);
  const ox = b.minX - CELL;
  const oy = b.minY - CELL;
  const nx = Math.ceil((b.maxX - b.minX) / CELL) + 2;
  const ny = Math.ceil((b.maxY - b.minY) / CELL) + 2;
  const n = nx * ny;
  const center = (i: number): Point => ({ x: ox + ((i % nx) + 0.5) * CELL, y: oy + (Math.floor(i / nx) + 0.5) * CELL });

  // 0 = outside the room, 1 = floor, 2 = under furniture
  const kind = new Uint8Array(n);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (pointInPolygon(center(c), outline)) kind[c] = 1;
    }
  }
  for (const ob of obstacles) {
    for (const poly of ob.polys) {
      forCellsNear(poly, 0, (c, p) => {
        if (kind[c] === 1 && pointInPolygon(p, poly)) kind[c] = 2;
      });
    }
  }

  // Corridor width per cell, in quarter inches so the search can bucket by value.
  const dist2 = squaredEdt(kind, nx, ny);
  const widthQ = new Int32Array(n);
  for (let c = 0; c < n; c++) widthQ[c] = kind[c] === 1 ? Math.floor(2 * Math.sqrt(dist2[c]) * CELL * 4 + 1e-6) : 0;

  // Widest-path search (maximize the narrowest point) with a bucket queue.
  const INF = 1 << 30;
  const best = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  let maxQ = 0;
  for (let c = 0; c < n; c++) if (widthQ[c] > maxQ) maxQ = widthQ[c];
  const buckets: number[][] = Array.from({ length: maxQ + 2 }, () => []);
  const topBucket = maxQ + 1;
  forCellsNear([entry.a, entry.b], reach, (c, p) => {
    if (kind[c] !== 0 && distPointSegment(p, entry.a, entry.b) <= reach) {
      best[c] = INF;
      buckets[topBucket].push(c);
    }
  });
  for (let q = topBucket; q >= 0; q--) {
    const bucket = buckets[q];
    while (bucket.length) {
      const c = bucket.pop()!;
      const v = best[c];
      if ((v === INF ? topBucket : v) !== q) continue; // stale entry
      const i = c % nx;
      const neighbors = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx];
      for (const m of neighbors) {
        if (m < 0 || m >= n || kind[m] === 0) continue;
        const cand = Math.min(v, widthQ[m]);
        if (cand > best[m]) {
          best[m] = cand;
          parent[m] = c;
          buckets[Math.min(cand, topBucket)].push(m);
        }
      }
    }
  }

  return targets.map((t) => {
    let bestCell = -1;
    let bestVal = -1;
    const near = (p: Point) =>
      t.shape.kind === "segment"
        ? distPointSegment(p, t.shape.a, t.shape.b)
        : Math.min(...t.shape.polys.map((poly) => distPointPolygon(p, poly)));
    const shapePts = t.shape.kind === "segment" ? [t.shape.a, t.shape.b] : t.shape.polys.flat();
    forCellsNear(shapePts, reach, (c, p) => {
      if (kind[c] === 0 || best[c] <= bestVal) return;
      if (near(p) <= reach) {
        bestVal = best[c];
        bestCell = c;
      }
    });

    const width = bestVal < 0 ? 0 : bestVal === INF ? Infinity : bestVal / 4;
    const ok = width >= required - 1e-6;
    const path: Point[] = [];
    const narrow: Point[] = [];
    const narrowedBy = new Set<string>();
    for (let c = bestCell; c >= 0; c = parent[c]) {
      const p = center(c);
      path.push(p);
      if (!ok && widthQ[c] / 4 < required - 1e-6) {
        narrow.push(p);
        const r = widthQ[c] / 8 + 1;
        for (const ob of obstacles) {
          if (!narrowedBy.has(ob.id) && ob.polys.some((poly) => distPointPolygon(p, poly) <= r)) narrowedBy.add(ob.id);
        }
      }
    }
    return {
      targetId: t.id,
      label: t.label,
      width: Number.isFinite(width) ? width : required,
      ok,
      path: thin(path),
      narrow: thin(narrow),
      narrowedBy: [...narrowedBy],
    };
  });

  function forCellsNear(points: Point[], margin: number, fn: (c: number, p: Point) => void) {
    const pb = bounds(points);
    const i0 = Math.max(0, Math.floor((pb.minX - margin - ox) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((pb.maxX + margin - ox) / CELL));
    const j0 = Math.max(0, Math.floor((pb.minY - margin - oy) / CELL));
    const j1 = Math.min(ny - 1, Math.ceil((pb.maxY + margin - oy) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * nx + i, center(j * nx + i));
  }
}

/** Keep every 8th point (2 in apart) plus the ends: enough to draw a route. */
function thin(points: Point[]): Point[] {
  return points.filter((_, i) => i % 8 === 0 || i === points.length - 1);
}

/**
 * Squared Euclidean distance (in cells) from each cell center to the nearest
 * non-floor cell center (Felzenszwalb & Huttenlocher, two 1-D passes).
 */
function squaredEdt(kind: Uint8Array, nx: number, ny: number): Float64Array {
  const BIG = 1e20;
  const g = new Float64Array(nx * ny);
  for (let c = 0; c < g.length; c++) g[c] = kind[c] === 1 ? BIG : 0;
  const size = Math.max(nx, ny);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = g[j * nx + i];
    pass(ny);
    for (let j = 0; j < ny; j++) g[j * nx + i] = d[j];
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = g[j * nx + i];
    pass(nx);
    for (let i = 0; i < nx; i++) g[j * nx + i] = d[i];
  }
  return g;
}
