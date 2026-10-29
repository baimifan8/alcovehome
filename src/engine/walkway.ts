// Tier 2: is there a walkway at least `required` inches wide from the entry to every
// other door and every usable zone?
//
// The room is rasterized on a fine grid. Each free cell gets the width of the widest
// corridor centered on it (twice the distance to the nearest blocked cell). A
// widest-path search from the entry then gives, for every target, the narrowest
// point on the best route to it. An item is blamed for a narrow walkway when taking
// it out of the room would widen that walkway.

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
  /** The best route from the entry, as plan points (for drawing). */
  path: Point[];
  /** Where the route is narrowest. */
  pinch: Point | null;
  /** Obstacles (item ids) whose removal would widen this walkway, or that form its pinch. */
  narrowedBy: string[];
}

interface Grid {
  ox: number;
  oy: number;
  nx: number;
  ny: number;
  center: (c: number) => Point;
  forCellsNear: (points: Point[], margin: number, fn: (c: number, p: Point) => void) => void;
}

interface Solved {
  /** Per target: best width (quarter inches, or INF) and the cell reaching it. */
  targets: { value: number; cell: number }[];
  widthQ: Int32Array;
  parent: Int32Array;
  best: Int32Array;
}

const INF = 1 << 30;

export function checkWalkways(
  outline: Poly,
  obstacles: WalkwayObstacle[],
  entry: { a: Point; b: Point },
  targets: WalkwayTarget[],
  required: number,
): WalkwayResult[] {
  if (!targets.length) return [];
  const reach = required / 2 + 1;
  const grid = makeGrid(outline);
  const { nx, ny } = grid;

  const floor = floorCells(outline, grid);

  // Cells under each obstacle, so solving without one is cheap to set up.
  const under = obstacles.map((ob) => {
    const cells: number[] = [];
    for (const poly of ob.polys) {
      grid.forCellsNear(poly, 0, (c, p) => {
        if (floor[c] && pointInPolygon(p, poly)) cells.push(c);
      });
    }
    return cells;
  });

  // Entry cells and target cells don't depend on furniture.
  const sources: number[] = [];
  grid.forCellsNear([entry.a, entry.b], reach, (c, p) => {
    if (floor[c] && distPointSegment(p, entry.a, entry.b) <= reach) sources.push(c);
  });
  const targetCells = targets.map((t) => {
    const near = (p: Point) =>
      t.shape.kind === "segment"
        ? distPointSegment(p, t.shape.a, t.shape.b)
        : Math.min(...t.shape.polys.map((poly) => distPointPolygon(p, poly)));
    const pts = t.shape.kind === "segment" ? [t.shape.a, t.shape.b] : t.shape.polys.flat();
    const cells: number[] = [];
    grid.forCellsNear(pts, reach, (c, p) => {
      if (floor[c] && near(p) <= reach) cells.push(c);
    });
    return cells;
  });

  const solve = (skip: number): Solved => {
    // 0 = outside the room, 1 = floor, 2 = under furniture
    const kind = floor.slice();
    under.forEach((cells, i) => {
      if (i !== skip) for (const c of cells) kind[c] = 2;
    });
    return widestPaths(kind, grid, sources, targetCells);
  };

  const base = solve(-1);
  const requiredQ = Math.floor(required * 4 + 1e-6);
  const failing = base.targets.map((t) => t.value < requiredQ);

  // Candidates for blame: obstacles next to too-narrow cells on a failing route.
  const routes = base.targets.map((t) => route(base, t.cell));
  const candidates = new Set<number>();
  routes.forEach((cells, ti) => {
    if (!failing[ti]) return;
    for (const c of cells) {
      if (base.widthQ[c] >= requiredQ) continue;
      const p = grid.center(c);
      const r = base.widthQ[c] / 8 + 1;
      obstacles.forEach((ob, i) => {
        if (!candidates.has(i) && ob.polys.some((poly) => distPointPolygon(p, poly) <= r)) candidates.add(i);
      });
    }
  });
  const blame: Set<string>[] = targets.map(() => new Set());
  for (const i of candidates) {
    const without = solve(i);
    without.targets.forEach((t, ti) => {
      if (failing[ti] && t.value >= base.targets[ti].value + 2) blame[ti].add(obstacles[i].id);
    });
  }
  // Two pinches in a row: removing either alone widens nothing. Blame what borders
  // the route where it is within an inch of its narrowest.
  routes.forEach((cells, ti) => {
    if (!failing[ti] || blame[ti].size) return;
    const limit = base.targets[ti].value + 4;
    for (const c of cells) {
      if (base.widthQ[c] > limit) continue;
      const p = grid.center(c);
      const r = base.widthQ[c] / 8 + 1;
      for (const i of candidates) {
        if (obstacles[i].polys.some((poly) => distPointPolygon(p, poly) <= r)) blame[ti].add(obstacles[i].id);
      }
    }
  });

  return targets.map((t, ti) => {
    const { value } = base.targets[ti];
    const width = value < 0 ? 0 : value === INF ? required : value / 4;
    const cells = routes[ti];
    let pinch: Point | null = null;
    if (failing[ti] && cells.length) {
      // Many cells can tie for narrowest; prefer those beside the items to blame.
      const min = Math.min(...cells.map((c) => base.widthQ[c]));
      const blamed = obstacles.filter((ob) => blame[ti].has(ob.id));
      const score = (c: number) => {
        const p = grid.center(c);
        const r = base.widthQ[c] / 8 + 1;
        return blamed.filter((ob) => ob.polys.some((poly) => distPointPolygon(p, poly) <= r)).length;
      };
      const ties = cells.filter((c) => base.widthQ[c] <= min + 1);
      const top = Math.max(...ties.map(score));
      const best = ties.filter((c) => score(c) === top);
      pinch = grid.center(best[Math.floor(best.length / 2)]);
    }
    return {
      targetId: t.id,
      label: t.label,
      width,
      ok: !failing[ti],
      path: simplify(cells.map(grid.center), 6),
      pinch,
      narrowedBy: [...blame[ti]],
    };
  });
}

// Which cells are inside the room depends only on its outline, which rarely changes
// while furniture moves; keep the last few. (A cache, so evaluation stays pure.)
const floorCache = new Map<string, Uint8Array>();

function floorCells(outline: Poly, grid: Grid): Uint8Array {
  const key = JSON.stringify(outline);
  let floor = floorCache.get(key);
  if (!floor) {
    floor = new Uint8Array(grid.nx * grid.ny);
    for (let c = 0; c < floor.length; c++) if (pointInPolygon(grid.center(c), outline)) floor[c] = 1;
    if (floorCache.size >= 8) floorCache.delete(floorCache.keys().next().value!);
    floorCache.set(key, floor);
  }
  return floor;
}

function makeGrid(outline: Poly): Grid {
  const b = bounds(outline);
  const ox = b.minX - CELL;
  const oy = b.minY - CELL;
  const nx = Math.ceil((b.maxX - b.minX) / CELL) + 2;
  const ny = Math.ceil((b.maxY - b.minY) / CELL) + 2;
  const center = (c: number): Point => ({ x: ox + ((c % nx) + 0.5) * CELL, y: oy + (Math.floor(c / nx) + 0.5) * CELL });
  const forCellsNear = (points: Point[], margin: number, fn: (c: number, p: Point) => void) => {
    const pb = bounds(points);
    const i0 = Math.max(0, Math.floor((pb.minX - margin - ox) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((pb.maxX + margin - ox) / CELL));
    const j0 = Math.max(0, Math.floor((pb.minY - margin - oy) / CELL));
    const j1 = Math.min(ny - 1, Math.ceil((pb.maxY + margin - oy) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * nx + i, center(j * nx + i));
  };
  return { ox, oy, nx, ny, center, forCellsNear };
}

/** Cells from a target back to the edge of the entry's approach area. */
function route(s: Solved, from: number): number[] {
  const cells: number[] = [];
  for (let c = from; c >= 0; c = s.parent[c]) {
    cells.push(c);
    if (s.best[c] === INF) break;
  }
  return cells;
}

/** Ramer–Douglas–Peucker: drop points within `eps` of the line through their neighbors. */
function simplify(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distPointSegment(points[i], a, b);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= eps) return [a, b];
  return [...simplify(points.slice(0, at + 1), eps).slice(0, -1), ...simplify(points.slice(at), eps)];
}

/**
 * Widest-path search (maximize the narrowest point) from the source cells, using a
 * bucket queue over corridor widths in quarter inches. Cells under furniture can be
 * crossed at width 0, so a fully blocked target still gets a route to blame.
 */
function widestPaths(kind: Uint8Array, grid: Grid, sources: number[], targetCells: number[][]): Solved {
  const { nx, ny } = grid;
  const n = nx * ny;
  const dist2 = squaredEdt(kind, nx, ny);
  const widthQ = new Int32Array(n);
  let maxQ = 0;
  for (let c = 0; c < n; c++) {
    widthQ[c] = kind[c] === 1 ? Math.floor(2 * Math.sqrt(dist2[c]) * CELL * 4 + 1e-6) : 0;
    if (widthQ[c] > maxQ) maxQ = widthQ[c];
  }

  const best = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const top = maxQ + 1;
  const buckets: number[][] = Array.from({ length: top + 1 }, () => []);
  for (const c of sources) {
    best[c] = INF;
    buckets[top].push(c);
  }
  // First in, first out within a bucket: among equally wide routes, the shortest wins.
  for (let q = top; q >= 0; q--) {
    const bucket = buckets[q];
    for (let k = 0; k < bucket.length; k++) {
      const c = bucket[k];
      const v = best[c];
      if ((v === INF ? top : v) !== q) continue; // stale entry
      const i = c % nx;
      const neighbors = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx];
      for (const m of neighbors) {
        if (m < 0 || m >= n || kind[m] === 0) continue;
        const cand = Math.min(v, widthQ[m]);
        if (cand > best[m]) {
          best[m] = cand;
          parent[m] = c;
          buckets[Math.min(cand, top)].push(m);
        }
      }
    }
  }

  const targets = targetCells.map((cells) => {
    let value = -1;
    let cell = -1;
    for (const c of cells) {
      if (best[c] > value) {
        value = best[c];
        cell = c;
      }
    }
    return { value, cell };
  });
  return { targets, widthQ, parent, best };
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
