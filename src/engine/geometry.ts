import type { Point } from "../model/types.ts";

/** A polygon as a list of vertices. Shapes passed to SAT functions must be convex. */
export type Poly = Point[];

/** Overlaps or gaps smaller than this (inches) are treated as touching. */
export const EPS = 0.01;

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const length = (a: Point) => Math.hypot(a.x, a.y);
export const unit = (a: Point): Point => {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** Rotate by `deg` degrees, clockwise on screen (y axis pointing down). */
export function rotate(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function edges(poly: Poly): [Point, Point][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}

function project(poly: Poly, axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = dot(p, axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/**
 * Separating-axis test for two convex polygons. Returns the penetration depth
 * (smallest overlap over all axes), or 0 when they are separated or only touch.
 */
export function overlapDepth(a: Poly, b: Poly): number {
  let best = Infinity;
  for (const poly of [a, b]) {
    for (const [p, q] of edges(poly)) {
      const e = sub(q, p);
      if (e.x === 0 && e.y === 0) continue;
      const axis = unit({ x: -e.y, y: e.x });
      const [amin, amax] = project(a, axis);
      const [bmin, bmax] = project(b, axis);
      const o = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (o <= EPS) return 0;
      if (o < best) best = o;
    }
  }
  return best === Infinity ? 0 : best;
}

export function distPointSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return length(sub(p, add(a, scale(ab, t))));
}

/** Ray-casting point-in-polygon; works for concave polygons. Boundary points are unreliable. */
export function pointInPolygon(p: Point, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distPointPolygonBoundary(p: Point, poly: Poly): number {
  let d = Infinity;
  for (const [a, b] of edges(poly)) d = Math.min(d, distPointSegment(p, a, b));
  return d;
}

/** Point is inside or within EPS of the boundary. */
export function pointInOrOn(p: Point, poly: Poly): boolean {
  return pointInPolygon(p, poly) || distPointPolygonBoundary(p, poly) <= EPS;
}

/** Distance from a point to a filled polygon (0 inside). */
export function distPointPolygon(p: Point, poly: Poly): number {
  return pointInPolygon(p, poly) ? 0 : distPointPolygonBoundary(p, poly);
}

/** Segments cross at a single interior point of both (touching and collinear overlap don't count). */
export function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(sub(a2, a1), sub(b1, a1));
  const d2 = cross(sub(a2, a1), sub(b2, a1));
  const d3 = cross(sub(b2, b1), sub(a1, b1));
  const d4 = cross(sub(b2, b1), sub(a2, b1));
  const tol = 1e-9 * (1 + length(sub(a2, a1)) * length(sub(b2, b1)));
  return ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol));
}

/** Smallest distance between two convex polygons (0 if they overlap or touch). */
export function distPolyPoly(a: Poly, b: Poly): number {
  if (overlapDepth(a, b) > 0) return 0;
  let d = Infinity;
  for (const p of a) for (const [q, r] of edges(b)) d = Math.min(d, distPointSegment(p, q, r));
  for (const p of b) for (const [q, r] of edges(a)) d = Math.min(d, distPointSegment(p, q, r));
  return d;
}

export function distPolySegment(poly: Poly, a: Point, b: Point): number {
  return distPolyPoly(poly, [a, b]);
}

export type Containment = "inside" | "crosses" | "outside";

/** How a convex shape sits relative to a (possibly concave) room outline. */
export function containment(shape: Poly, room: Poly): Containment {
  let inside = 0;
  for (const p of shape) if (pointInOrOn(p, room)) inside++;
  const crossing = edges(shape).some(([a, b]) => edges(room).some(([c, d]) => segmentsCross(a, b, c, d)));
  if (inside === shape.length && !crossing) return "inside";
  if (inside === 0 && !crossing && !room.some((p) => pointInPolygon(p, shape))) return "outside";
  return "crosses";
}

export function bounds(points: Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned rectangle as a polygon, clockwise on screen. */
export function rectPoly(x: number, y: number, w: number, h: number): Poly {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}
