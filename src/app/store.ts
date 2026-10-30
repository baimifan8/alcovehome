// App state, kept on the user's device (SPEC.md: v1 is local-first, no accounts).

import { bboxSize, defaultRules, evaluateRoom, withClearances, type Rules } from "../engine/index.ts";
import type { BuiltIn, InventoryItem, Opening, Placement, Room, Space } from "../model/types.ts";
import type { Units } from "../model/units.ts";

export interface Settings {
  units: Units;
  /** User edits to clearances in rules.json, by key. */
  clearances: Record<string, number>;
}

export interface AppState {
  version: 1;
  spaces: Space[];
  inventory: InventoryItem[];
  settings: Settings;
  current: { spaceId: string | null; roomId: string | null };
}

const KEY = "alcove-home:v1";

export const emptyState: AppState = {
  version: 1,
  spaces: [],
  inventory: [],
  settings: { units: "ftin", clearances: {} },
  current: { spaceId: null, roomId: null },
};

export function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState;
    const s = JSON.parse(raw) as AppState;
    return s.version === 1 ? { ...emptyState, ...s, settings: { ...emptyState.settings, ...s.settings } } : emptyState;
  } catch {
    return emptyState;
  }
}

export function save(state: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode): the plan still works for this session.
  }
}

export function rulesFor(settings: Settings): Rules {
  return withClearances(defaultRules, settings.clearances);
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function rectRoom(name: string, width: number, length: number, id = newId()): Room {
  return {
    id,
    name,
    outline: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: length },
      { x: 0, y: length },
    ],
    // Typed by the user, so every wall is user-entered.
    wallSources: ["user-edited", "user-edited", "user-edited", "user-edited"],
    openings: [],
  };
}

export function roomSize(room: Room) {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), length: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Resize a rectangular room, keeping openings on their walls. A changed width marks
 * the top and bottom walls as user-edited; a changed length, the left and right.
 */
export function resizeRoom(room: Room, width: number, length: number): Room {
  const old = roomSize(room);
  const widthChanged = Math.abs(width - old.width) > 1e-9;
  const lengthChanged = Math.abs(length - old.length) > 1e-9;
  const src = room.wallSources;
  const wallSources = [0, 1, 2, 3].map((i) =>
    (i % 2 === 0 ? widthChanged : lengthChanged) ? "user-edited" : (src[i] ?? "user-edited"),
  ) as Room["wallSources"];
  const next = { ...rectRoom(room.name, width, length, room.id), wallSources, ...(room.approximate ? { approximate: true } : {}) };
  const wallLen = (w: number, s: { width: number; length: number }) => (w % 2 === 0 ? s.width : s.length);
  const openings = room.openings.map((o) => {
    // Keep the distance from the plan's left/top corner the same.
    const fromCorner = o.wall === 0 || o.wall === 1 ? o.offset : wallLen(o.wall, old) - o.offset - o.width;
    const len = wallLen(o.wall, { width, length });
    const width_ = Math.min(o.width, len);
    const d = Math.max(0, Math.min(fromCorner, len - width_));
    return { ...o, width: width_, offset: o.wall === 0 || o.wall === 1 ? d : len - d - width_ };
  });
  // Built-ins keep their spot, pulled back inside if the room got smaller.
  const builtIns = room.builtIns?.map((b) => {
    const w = Math.min(b.width, width);
    const l = Math.min(b.length, length);
    return { ...b, width: w, length: l, x: Math.max(0, Math.min(b.x, width - w)), y: Math.max(0, Math.min(b.y, length - l)) };
  });
  return { ...next, openings, ...(builtIns ? { builtIns } : {}) };
}

export function newBuiltIn(room: Room): BuiltIn {
  const { width, length } = roomSize(room);
  const w = Math.min(36, width);
  const l = Math.min(24, length);
  return { id: newId(), label: "built-in", x: (width - w) / 2, y: (length - l) / 2, width: w, length: l, confirmed: true };
}

export function newOpening(type: Opening["type"], room: Room): Opening {
  const width = type === "closet_door" ? 48 : type === "window" ? 36 : type === "passage" ? 36 : 32;
  const { width: w } = roomSize(room);
  return {
    id: newId(),
    type,
    wall: type === "window" ? 0 : type === "closet_door" ? 1 : 2,
    offset: Math.max(0, Math.min(6, w - width)),
    width,
    operation: type === "closet_door" ? "sliding" : "swing",
    swing: "in",
    hinge: "left",
    confirmed: true,
  };
}

/**
 * A spot for a newly placed item: the first spot (scanning from the top-left, both
 * orientations) where it fits outright without making anything else worse, else the
 * first free of hard conflicts, else the room's center.
 */
export function findSpot(state: AppState, room: Room, item: InventoryItem): Placement {
  const space = state.spaces.find((s) => s.id === state.current.spaceId)!;
  const inRoom = space.placements.filter((p) => p.roomId === room.id);
  const { width, length } = roomSize(room);
  const { w, d } = bboxSize(item);
  const rules = rulesFor(state.settings);
  const base: Placement = { id: newId(), itemId: item.id, roomId: room.id, x: width / 2, y: length / 2, rotation: 0 };
  const rank = { fits: 0, tight: 1, "doesnt-fit": 2 } as const;
  const before = new Map(
    evaluateRoom({ room, items: state.inventory, placements: inRoom }, rules, { skipWalkway: true }).verdicts.map((v) => [v.placementId, rank[v.result]]),
  );
  let fallback: Placement | null = null;
  for (const rotation of [0, 90]) {
    const [hw, hd] = rotation ? [d / 2, w / 2] : [w / 2, d / 2];
    for (let y = hd; y <= length - hd; y += 6) {
      for (let x = hw; x <= width - hw; x += 6) {
        const p = { ...base, x, y, rotation };
        const report = evaluateRoom({ room, items: state.inventory, placements: [...inRoom, p] }, rules, { skipWalkway: true });
        const v = report.verdicts.find((r) => r.placementId === p.id);
        if (!v) continue;
        const harmsOthers = report.verdicts.some((o) => o.placementId !== p.id && rank[o.result] > (before.get(o.placementId) ?? 0));
        if (v.result === "fits" && !harmsOthers) return p;
        if (!fallback && !v.reasons.some((r) => r.tier === 0)) fallback = p;
      }
    }
  }
  return fallback ?? base;
}

export type Action =
  | { type: "createSpace"; name: string; rooms: Room[]; sourceImage?: string; id?: string }
  /** A shared plan saved as the user's own listing, with the furniture it brings. */
  | { type: "importSpace"; space: Space; items: InventoryItem[] }
  | { type: "updateSpace"; space: Space }
  | { type: "deleteSpace"; id: string }
  | { type: "select"; spaceId: string | null; roomId?: string | null }
  | { type: "addRoom"; room: Room }
  | { type: "updateRoom"; room: Room }
  | { type: "deleteRoom"; id: string }
  | { type: "addItem"; item: InventoryItem }
  | { type: "updateItem"; item: InventoryItem }
  | { type: "deleteItem"; id: string }
  | { type: "place"; placement: Placement }
  | { type: "movePlacement"; placement: Placement }
  | { type: "removePlacement"; id: string }
  | { type: "settings"; settings: Settings };

function updateCurrentSpace(state: AppState, fn: (s: Space) => Space): AppState {
  return { ...state, spaces: state.spaces.map((s) => (s.id === state.current.spaceId ? fn(s) : s)) };
}

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case "createSpace": {
      const space: Space = {
        id: a.id ?? newId(),
        name: a.name,
        createdAt: new Date().toISOString(),
        rooms: a.rooms,
        placements: [],
        ...(a.sourceImage ? { sourceImage: a.sourceImage } : {}),
      };
      return { ...state, spaces: [...state.spaces, space], current: { spaceId: space.id, roomId: a.rooms[0]?.id ?? null } };
    }
    case "importSpace":
      return {
        ...state,
        spaces: [...state.spaces, a.space],
        inventory: [...state.inventory, ...a.items],
        current: { spaceId: a.space.id, roomId: a.space.rooms[0]?.id ?? null },
      };
    case "updateSpace":
      return { ...state, spaces: state.spaces.map((s) => (s.id === a.space.id ? a.space : s)) };
    case "deleteSpace": {
      const spaces = state.spaces.filter((s) => s.id !== a.id);
      const next = spaces[0] ?? null;
      return { ...state, spaces, current: { spaceId: next?.id ?? null, roomId: next?.rooms[0]?.id ?? null } };
    }
    case "select": {
      const space = state.spaces.find((s) => s.id === a.spaceId);
      const roomId = a.roomId !== undefined ? a.roomId : (space?.rooms[0]?.id ?? null);
      return { ...state, current: { spaceId: a.spaceId, roomId } };
    }
    case "addRoom":
      return { ...updateCurrentSpace(state, (s) => ({ ...s, rooms: [...s.rooms, a.room] })), current: { ...state.current, roomId: a.room.id } };
    case "updateRoom":
      return updateCurrentSpace(state, (s) => ({ ...s, rooms: s.rooms.map((r) => (r.id === a.room.id ? a.room : r)) }));
    case "deleteRoom": {
      const next = updateCurrentSpace(state, (s) => ({
        ...s,
        rooms: s.rooms.filter((r) => r.id !== a.id),
        placements: s.placements.filter((p) => p.roomId !== a.id),
      }));
      const space = next.spaces.find((s) => s.id === state.current.spaceId);
      return { ...next, current: { ...state.current, roomId: space?.rooms[0]?.id ?? null } };
    }
    case "addItem":
      return { ...state, inventory: [...state.inventory, a.item] };
    case "updateItem":
      return { ...state, inventory: state.inventory.map((i) => (i.id === a.item.id ? a.item : i)) };
    case "deleteItem":
      return {
        ...state,
        inventory: state.inventory.filter((i) => i.id !== a.id),
        spaces: state.spaces.map((s) => ({ ...s, placements: s.placements.filter((p) => p.itemId !== a.id) })),
      };
    case "place":
      return updateCurrentSpace(state, (s) => ({ ...s, placements: [...s.placements, a.placement] }));
    case "movePlacement":
      return updateCurrentSpace(state, (s) => ({
        ...s,
        placements: s.placements.map((p) => (p.id === a.placement.id ? a.placement : p)),
      }));
    case "removePlacement":
      return updateCurrentSpace(state, (s) => ({ ...s, placements: s.placements.filter((p) => p.id !== a.id) }));
    case "settings":
      return { ...state, settings: a.settings };
  }
}
