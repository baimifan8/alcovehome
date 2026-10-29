// Turn a floor plan reading (or listing text) into draft rooms for the confirm screen.
// Scale comes from labeled rooms and is applied to unlabeled ones (SPEC.md, "Floor
// plan import"). Every number here is checked by a person before it's used.

import type { Opening, Room, WallSource } from "../model/types.ts";
import { parseDimensionLabel, type ListedRoom } from "./labels.ts";
import type { PlanReading } from "./reading.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DraftRoom {
  key: string;
  include: boolean;
  name: string;
  /** Inches, left to right as drawn. Null when nothing could be worked out. */
  width: number | null;
  /** Inches, top to bottom as drawn. */
  length: number | null;
  /** Source of the top and bottom walls (the width) and of the left and right walls (the length). */
  widthSource: WallSource;
  lengthSource: WallSource;
  labelText: string | null;
  /** Where the room is in the image, if it came from one. */
  bboxPx: Box | null;
  /** Openings in room terms (inches from each wall's start). All start unconfirmed. */
  openings: Opening[];
  /** Things a person should look at, shown highlighted. */
  issues: string[];
  /** Openings the reader wasn't sure about, by opening id. */
  doubtfulOpenings: string[];
  /** From listing text: real shape and door positions unknown. */
  approximate: boolean;
}

export interface DraftPlan {
  rooms: DraftRoom[];
  /** Image pixels per inch, worked out from labeled rooms; null if none were readable. */
  pxPerInch: number | null;
  /** Plan-wide notes (shown above the rooms). */
  notes: string[];
}

/** A label is suspicious when it disagrees with the drawing's scale by more than this. */
const MISMATCH = 0.12;

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

let counter = 0;
const key = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function draftFromReading(reading: PlanReading): DraftPlan {
  const notes = [...reading.warnings];
  const labeled = reading.rooms.map((r) => {
    const dims = r.label_text ? parseDimensionLabel(r.label_text) : null;
    if (!dims || r.bbox_px.w <= 0 || r.bbox_px.h <= 0) return null;
    // Labels don't say which number is which side: match the longer number to the
    // longer side as drawn.
    const [shortIn, longIn] = [...dims].sort((a, b) => a - b);
    const horizontalIsLong = r.bbox_px.w >= r.bbox_px.h;
    const width = horizontalIsLong ? longIn : shortIn;
    const length = horizontalIsLong ? shortIn : longIn;
    return { width, length, sx: r.bbox_px.w / width, sy: r.bbox_px.h / length };
  });
  const ratios = labeled.flatMap((l) => (l ? [l.sx, l.sy] : []));
  const pxPerInch = ratios.length ? median(ratios) : null;
  if (pxPerInch === null) notes.push("No room sizes could be read from the plan, so every size needs to be typed in.");

  const rooms: DraftRoom[] = reading.rooms.map((r, i) => {
    const issues: string[] = [];
    const lab = labeled[i];
    let width: number | null = null;
    let length: number | null = null;
    let source: WallSource = "inferred";
    if (lab) {
      width = lab.width;
      length = lab.length;
      source = "labeled";
      if (pxPerInch && (Math.abs(lab.sx / pxPerInch - 1) > MISMATCH || Math.abs(lab.sy / pxPerInch - 1) > MISMATCH)) {
        issues.push(`The label "${r.label_text}" doesn't match how big the room is drawn. Check it against the plan.`);
      }
    } else {
      if (r.label_text) issues.push(`Couldn't read the label "${r.label_text}". Type the size from the plan.`);
      if (pxPerInch) {
        width = Math.round(r.bbox_px.w / pxPerInch);
        length = Math.round(r.bbox_px.h / pxPerInch);
        issues.push("No size printed for this room, so it was measured from the drawing. Check it if you can.");
      }
    }
    if (r.confidence !== "high") issues.push("The reader wasn't sure about this room.");

    // Pixel → inch for this room: its own labeled scale if it has one.
    const sx = lab?.sx ?? pxPerInch;
    const sy = lab?.sy ?? pxPerInch;
    const openings: Opening[] = [];
    const doubtful: string[] = [];
    const mine = reading.openings.filter((o) => o.room.trim().toLowerCase() === r.name.trim().toLowerCase());
    for (const o of mine) {
      if (!sx || !sy || width === null || length === null) break;
      const op = toOpening(o, r.bbox_px, sx, sy, width, length);
      if (!op) continue;
      openings.push(op);
      if (o.confidence !== "high" || o.swing === "unknown" || (o.type === "door" && o.hinge_at === "unknown")) doubtful.push(op.id);
    }
    // Doors first, so the first door (the default entry) is a real door.
    openings.sort((a, b) => rank(a) - rank(b));

    return {
      key: key("room"),
      include: true,
      name: r.name,
      width,
      length,
      widthSource: source,
      lengthSource: source,
      labelText: r.label_text,
      bboxPx: r.bbox_px,
      openings,
      issues,
      doubtfulOpenings: doubtful,
      approximate: false,
    };
  });

  const orphans = reading.openings.filter((o) => !reading.rooms.some((r) => r.name.trim().toLowerCase() === o.room.trim().toLowerCase()));
  if (orphans.length) notes.push(`${orphans.length} door(s) or window(s) couldn't be matched to a room; add them by hand if they matter.`);
  return { rooms, pxPerInch, notes };
}

const rank = (o: Opening) => (o.type === "door" ? 0 : o.type === "passage" ? 1 : o.type === "closet_door" ? 2 : 3);

function toOpening(
  o: PlanReading["openings"][number],
  box: Box,
  sx: number,
  sy: number,
  width: number,
  length: number,
): Opening | null {
  const horizontal = o.wall === "top" || o.wall === "bottom";
  const scale = horizontal ? sx : sy;
  const [lo, hi] = [Math.min(o.start_px, o.end_px), Math.max(o.start_px, o.end_px)];
  const origin = horizontal ? box.x : box.y;
  const wallLen = horizontal ? width : length;
  // Inches from the plan's left (or top) corner of this wall.
  let fromCorner = Math.round((lo - origin) / scale);
  let w = Math.round((hi - lo) / scale);
  if (w <= 0) return null;
  w = Math.min(w, wallLen);
  fromCorner = Math.max(0, Math.min(fromCorner, wallLen - w));
  const wall = { top: 0, right: 1, bottom: 2, left: 3 }[o.wall];
  // Walls 0 and 1 start at the plan's left/top corner; 2 and 3 at the opposite one.
  const startsAtCorner = wall === 0 || wall === 1;
  const offset = startsAtCorner ? fromCorner : wallLen - fromCorner - w;
  // hinge_at "start" is the smaller pixel coordinate, i.e. the plan's left/top end.
  const hingeNearCorner = o.hinge_at !== "end";
  const hinge: Opening["hinge"] = hingeNearCorner === startsAtCorner ? "left" : "right";

  const type: Opening["type"] =
    o.type === "window" ? "window" : o.type === "open_passage" ? "passage" : o.type === "closet_door" ? "closet_door" : "door";
  const operation: Opening["operation"] =
    o.type === "sliding_door" || o.swing === "sliding" ? "sliding" : o.type === "closet_door" && o.swing === "none" ? "bifold" : "swing";
  return {
    id: key("opening"),
    type,
    wall,
    offset,
    width: w,
    operation,
    swing: o.swing === "out_of_room" ? "out" : "in",
    hinge,
    confirmed: false,
  };
}

/** Rooms from listing text: sizes as written, no shape or door positions. */
export function draftFromText(listed: ListedRoom[]): DraftPlan {
  return {
    pxPerInch: null,
    notes: listed.length
      ? ["Listing text gives room sizes only. Rooms are drawn as plain rectangles with no doors, so every answer will be marked approximate. Add the doors you know about."]
      : ["No room sizes were found in that text."],
    rooms: listed.map((l) => ({
      key: key("room"),
      include: true,
      name: l.name,
      width: l.dims[0],
      length: l.dims[1],
      widthSource: "labeled",
      lengthSource: "labeled",
      labelText: l.text,
      bboxPx: null,
      openings: [],
      issues: [],
      doubtfulOpenings: [],
      approximate: true,
    })),
  };
}

/** A confirmed draft room as a real room. Openings the person kept are now confirmed. */
export function draftToRoom(d: DraftRoom, id: string): Room {
  const w = d.width!;
  const l = d.length!;
  return {
    id,
    name: d.name.trim() || "Room",
    outline: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: l },
      { x: 0, y: l },
    ],
    wallSources: [d.widthSource, d.lengthSource, d.widthSource, d.lengthSource],
    openings: d.openings.map((o) => ({ ...o, confirmed: true })),
    ...(d.approximate ? { approximate: true } : {}),
  };
}
