// Room shapes people can type: a rectangle, or an L (a rectangle with one corner cut
// out). The outline is what the fit engine uses; the shape is how it's edited. Each
// wall has a role ("top", "notch-across"…) so doors, windows and wall sources stay on
// the right wall when the shape or size changes.

import type { Opening, Point, Room, WallSource } from "./types.ts";

export type Corner = "top-left" | "top-right" | "bottom-right" | "bottom-left";

/** The missing corner of an L-shaped room: `width` along x, `length` along y. */
export interface Notch {
  corner: Corner;
  width: number;
  length: number;
}

export interface RoomShape {
  /** Overall size: the bounding box, left to right and top to bottom. */
  width: number;
  length: number;
  notch: Notch | null;
}

/** Outer walls by side; the cut-out's two walls run across (left-right) and down (top-bottom). */
export type WallRole = "top" | "right" | "bottom" | "left" | "notch-across" | "notch-down";

export const CORNERS: Corner[] = ["top-left", "top-right", "bottom-right", "bottom-left"];

/** Smallest a room arm or a cut-out can be, so the shape stays a usable L. */
export const MIN_ARM = 12;

/** Keep a cut-out inside the room with at least MIN_ARM of room left on both sides. */
export function clampShape(s: RoomShape): RoomShape {
  if (!s.notch) return s;
  if (s.width < MIN_ARM * 2 || s.length < MIN_ARM * 2) return { ...s, notch: null };
  const width = Math.max(MIN_ARM, Math.min(s.notch.width, s.width - MIN_ARM));
  const length = Math.max(MIN_ARM, Math.min(s.notch.length, s.length - MIN_ARM));
  return { ...s, notch: { ...s.notch, width, length } };
}

/**
 * Outline (clockwise on screen, first wall = top) and the role of each wall. The
 * notch replaces one corner of the rectangle with an inner corner.
 */
export function shapeOutline(shape: RoomShape): { outline: Point[]; roles: WallRole[] } {
  const { width: W, length: L, notch } = clampShape(shape);
  // Corners in walking order, each with the role of the wall that starts there.
  const corners: { p: Point; role: WallRole; corner: Corner }[] = [
    { p: { x: 0, y: 0 }, role: "top", corner: "top-left" },
    { p: { x: W, y: 0 }, role: "right", corner: "top-right" },
    { p: { x: W, y: L }, role: "bottom", corner: "bottom-right" },
    { p: { x: 0, y: L }, role: "left", corner: "bottom-left" },
  ];
  const verts: { p: Point; role: WallRole }[] = [];
  for (const c of corners) {
    if (!notch || notch.corner !== c.corner) {
      verts.push({ p: c.p, role: c.role });
      continue;
    }
    const { width: nw, length: nl } = notch;
    // p1 ends the incoming wall, inner is the room's inside corner, p2 starts the outgoing wall.
    const [p1, inner, p2] = {
      "top-left": [{ x: 0, y: nl }, { x: nw, y: nl }, { x: nw, y: 0 }],
      "top-right": [{ x: W - nw, y: 0 }, { x: W - nw, y: nl }, { x: W, y: nl }],
      "bottom-right": [{ x: W, y: L - nl }, { x: W - nw, y: L - nl }, { x: W - nw, y: L }],
      "bottom-left": [{ x: nw, y: L }, { x: nw, y: L - nl }, { x: 0, y: L - nl }],
    }[c.corner];
    const across = c.corner === "top-left" || c.corner === "bottom-right";
    verts.push({ p: p1, role: across ? "notch-across" : "notch-down" });
    verts.push({ p: inner, role: across ? "notch-down" : "notch-across" });
    verts.push({ p: p2, role: c.role });
  }
  // Start with the top wall so a rectangle keeps walls 0-3 = top, right, bottom, left.
  const start = verts.findIndex((v) => v.role === "top");
  const ordered = [...verts.slice(start), ...verts.slice(0, start)];
  return { outline: ordered.map((v) => v.p), roles: ordered.map((v) => v.role) };
}

const same = (a: Point[], b: Point[]) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);

/** The shape a room was built from, or null if its outline is some other polygon. */
export function shapeOf(room: Room): RoomShape | null {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const width = Math.max(...xs);
  const length = Math.max(...ys);
  if (Math.min(...xs) !== 0 || Math.min(...ys) !== 0) return null;
  const rect: RoomShape = { width, length, notch: null };
  if (same(shapeOutline(rect).outline, room.outline)) return rect;
  if (room.outline.length !== 6) return null;
  // The inner corner is the one vertex not on the bounding box.
  const inner = room.outline.find((p) => p.x > 0 && p.x < width && p.y > 0 && p.y < length);
  if (!inner) return null;
  for (const corner of CORNERS) {
    const left = corner.endsWith("left");
    const top = corner.startsWith("top");
    const s: RoomShape = { width, length, notch: { corner, width: left ? inner.x : width - inner.x, length: top ? inner.y : length - inner.y } };
    if (same(shapeOutline(s).outline, room.outline)) return s;
  }
  return null;
}

export function wallRoles(room: Room): WallRole[] | null {
  const s = shapeOf(room);
  return s ? shapeOutline(s).roles : null;
}

/** Where a role's wall is: the axis it runs along, its fixed coordinate, and its span. */
function span(outline: Point[], i: number) {
  const a = outline[i];
  const b = outline[(i + 1) % outline.length];
  const horizontal = Math.abs(a.y - b.y) < 1e-9;
  const [lo, hi] = horizontal ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  // Walls that run right or down start at their left/top end.
  const forward = horizontal ? b.x > a.x : b.y > a.y;
  return { horizontal, lo, hi, forward, len: hi - lo };
}

/** True if wall `i` runs right or down, so it starts at its left/top end. */
export function wallRunsForward(outline: Point[], i: number): boolean {
  return span(outline, i).forward;
}

/** An opening's position along its wall, as distance from the plan's left (or top) edge. */
export function openingFromEdge(room: Room, o: Opening): number {
  const s = span(room.outline, o.wall);
  return s.lo + (s.forward ? o.offset : s.len - o.offset - o.width);
}

/** Put an opening on wall `wall` at `fromEdge` (see openingFromEdge), clamped to fit. */
export function placeOnWall(outline: Point[], wall: number, fromEdge: number, width: number): { wall: number; offset: number; width: number } {
  const s = span(outline, wall);
  const w = Math.min(width, s.len);
  const d = Math.max(0, Math.min(fromEdge - s.lo, s.len - w));
  return { wall, width: w, offset: s.forward ? d : s.len - d - w };
}

/** When a cut-out goes away, its walls' openings move to the outer wall on the same side. */
function fallbackRole(role: WallRole, notch: Notch | null): WallRole {
  if (role !== "notch-across" && role !== "notch-down") return role;
  const corner = notch?.corner ?? "top-left";
  if (role === "notch-across") return corner.startsWith("top") ? "top" : "bottom";
  return corner.endsWith("left") ? "left" : "right";
}

/**
 * Rebuild a room in a new shape or size. Openings keep their wall (by role) and their
 * distance from the plan's left/top edge; built-ins stay inside. A wall whose length
 * changed is now user-edited, since the person just typed it.
 */
export function reshapeRoom(room: Room, next: RoomShape): Room {
  const oldShape = shapeOf(room);
  if (!oldShape) return room;
  const shape = clampShape(next);
  const oldRoles = shapeOutline(oldShape).roles;
  const { outline, roles } = shapeOutline(shape);
  const indexOf = (role: WallRole) => (roles.includes(role) ? roles.indexOf(role) : roles.indexOf(fallbackRole(role, oldShape.notch)));
  const wallSources: WallSource[] = roles.map((role) => {
    const was = oldRoles.indexOf(role);
    if (was < 0) return "user-edited";
    const before = span(room.outline, was).len;
    const after = span(outline, roles.indexOf(role)).len;
    return Math.abs(before - after) > 1e-9 ? "user-edited" : (room.wallSources[was] ?? "user-edited");
  });
  const openings = room.openings.map((o) => {
    const wall = indexOf(oldRoles[o.wall]);
    return { ...o, ...placeOnWall(outline, wall, openingFromEdge(room, o), o.width) };
  });
  const builtIns = room.builtIns?.map((b) => {
    const w = Math.min(b.width, shape.width);
    const l = Math.min(b.length, shape.length);
    return { ...b, width: w, length: l, x: Math.max(0, Math.min(b.x, shape.width - w)), y: Math.max(0, Math.min(b.y, shape.length - l)) };
  });
  return { ...room, outline, wallSources, openings, ...(builtIns ? { builtIns } : {}) };
}

/** How each wall is named in the editor. */
export const ROLE_LABEL: Record<WallRole, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
  "notch-across": "Inner corner (left to right)",
  "notch-down": "Inner corner (top to bottom)",
};

export const CORNER_LABEL: Record<Corner, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
};
