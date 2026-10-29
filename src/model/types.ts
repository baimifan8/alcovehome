// Alcove Home data model (SPEC.md, "Data model").
// All lengths are inches. Plan coordinates have their origin at the top-left of the
// room's bounding box, x to the right and y downward, as drawn on screen.

export interface Point {
  x: number;
  y: number;
}

export type WallSource = "labeled" | "inferred" | "user-edited";

export interface Room {
  id: string;
  name: string;
  /**
   * Wall outline, clockwise on screen. Wall i runs from outline[i] to outline[i+1]
   * (wrapping), so the room's interior is on the wall's right-hand side as you walk it.
   */
  outline: Point[];
  /** One entry per wall, same order as outline. */
  wallSources: WallSource[];
  openings: Opening[];
}

export type OpeningType = "door" | "closet_door" | "window" | "passage";
export type DoorOperation = "swing" | "sliding" | "bifold";

export interface Opening {
  id: string;
  type: OpeningType;
  label?: string;
  /** Index of the wall (see Room.outline). */
  wall: number;
  /** Distance from the wall's start vertex to the opening's near edge. */
  offset: number;
  width: number;
  /** Doors only. Windows and passages ignore it. */
  operation: DoorOperation;
  /** Swing doors only: into the room or out of it. */
  swing: "in" | "out";
  /** Swing doors only: hinge side, as seen from inside the room facing the wall. */
  hinge: "left" | "right";
  /** The opening people enter the room through. Defaults to the first door or passage. */
  entry?: boolean;
  /** False until the user has checked it (imported openings start unconfirmed). */
  confirmed: boolean;
}

export interface Space {
  id: string;
  name: string;
  createdAt: string;
  sourceImage?: string;
  rooms: Room[];
  placements: Placement[];
}

/**
 * Footprint as seen from above, in the item's own frame: x runs across the item's
 * width from its left to its right (facing its front), y from its back (0) to its front.
 */
export type Footprint =
  | { shape: "rect" }
  | {
      /** L-shaped sectional or corner desk: main body plus a return on one side. */
      shape: "l";
      side: "left" | "right";
      /** Width of the return (e.g. the chaise). */
      returnWidth: number;
      /** Overall depth on the return side; greater than the item's depth. */
      returnDepth: number;
    };

export interface AddOn {
  id: string;
  label: string;
  width: number;
  depth: number;
  height: number;
  on: boolean;
}

export interface InventoryItem {
  id: string;
  nickname: string;
  /** Item kind, which selects its use zones in rules.json. */
  kind: string;
  source: { type: "generic"; libraryId: string } | { type: "manual" } | { type: "product"; url: string };
  width: number;
  depth: number;
  height: number;
  footprint: Footprint;
  addOns: AddOn[];
}

export interface Placement {
  id: string;
  itemId: string;
  roomId: string;
  /** Center of the item's bounding box, in room coordinates. */
  x: number;
  y: number;
  /** Degrees, clockwise on screen. At 0 the item's back faces the top of the plan. */
  rotation: number;
}

export type Result = "fits" | "tight" | "doesnt-fit";

export type ReasonCode =
  | "outside-room"
  | "wall"
  | "item-overlap"
  | "door"
  | "closet-door"
  | "use-zone"
  | "walkway";

export interface Reason {
  tier: 0 | 1 | 2;
  code: ReasonCode;
  message: string;
  /** Other placements or openings involved. */
  related: string[];
}

export interface Verdict {
  placementId: string;
  result: Result;
  reasons: Reason[];
  approximate: boolean;
  approximateReasons: string[];
}
