// Share links. The whole plan travels in the link's fragment (#share=…), compressed,
// so it never reaches a server: no upload, no account, and it opens offline.
// Anything read from a link is untrusted, so it's validated before use.

import { z } from "zod";
import type { InventoryItem, Placement, Room, Space } from "../model/types.ts";

const PREFIX = "#share=";
/** Refuse links that would unpack to more than this (a small link can unpack huge). */
const MAX_JSON = 512 * 1024;

const Num = z.number().finite().min(-100_000).max(100_000);
const Len = z.number().finite().positive().max(10_000);
const Text = z.string().max(200);
const Id = z.string().min(1).max(100);

const Point = z.object({ x: Num, y: Num });

const Opening = z.object({
  id: Id,
  type: z.enum(["door", "closet_door", "window", "passage"]),
  label: Text.optional(),
  wall: z.number().int().min(0),
  offset: z.number().finite().min(0).max(10_000),
  width: Len,
  operation: z.enum(["swing", "sliding", "bifold"]),
  swing: z.enum(["in", "out"]),
  hinge: z.enum(["left", "right"]),
  entry: z.boolean().optional(),
  confirmed: z.boolean(),
});

const RoomSchema = z
  .object({
    id: Id,
    name: Text,
    outline: z.array(Point).min(3).max(64),
    wallSources: z.array(z.enum(["labeled", "inferred", "user-edited"])),
    openings: z.array(Opening).max(50),
    builtIns: z
      .array(z.object({ id: Id, label: Text, x: Num, y: Num, width: Len, length: Len, confirmed: z.boolean() }))
      .max(50)
      .optional(),
    approximate: z.boolean().optional(),
  })
  .refine((r) => r.wallSources.length === r.outline.length && r.openings.every((o) => o.wall < r.outline.length));

const WebLink = z.string().max(2000).refine((u) => {
  try {
    return ["http:", "https:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
});

const Item = z.object({
  id: Id,
  nickname: Text,
  kind: z.string().max(50),
  source: z.union([
    z.object({ type: z.literal("generic"), libraryId: z.string().max(100) }),
    z.object({ type: z.literal("manual") }),
    z.object({ type: z.literal("product"), url: WebLink }),
  ]),
  width: Len,
  depth: Len,
  height: Len,
  footprint: z.union([
    z.object({ shape: z.literal("rect") }),
    z.object({ shape: z.literal("l"), side: z.enum(["left", "right"]), returnWidth: Len, returnDepth: Len }),
  ]),
  overrides: z.object({ width: Len.optional(), depth: Len.optional(), height: Len.optional() }).optional(),
  addOns: z
    .array(
      z.object({
        id: Id,
        label: Text,
        width: z.number().finite().min(0).max(1000),
        depth: z.number().finite().min(0).max(1000),
        height: z.number().finite().min(0).max(1000),
        on: z.boolean(),
      }),
    )
    .max(20),
});

const PlacementSchema = z.object({ id: Id, itemId: Id, roomId: Id, x: Num, y: Num, rotation: z.number().finite() });

const SharedPlanSchema = z.object({
  v: z.literal(1),
  name: Text,
  rooms: z.array(RoomSchema).min(1).max(50),
  placements: z.array(PlacementSchema).max(500),
  items: z.array(Item).max(200),
  /** The sender's clearance settings, so the answers match what they saw. */
  clearances: z.record(z.string().max(50), z.number().finite().min(0).max(1000)),
});

export interface SharedPlan {
  name: string;
  rooms: Room[];
  placements: Placement[];
  items: InventoryItem[];
  clearances: Record<string, number>;
}

/** The plan to send: its rooms, what's placed in them, and only the furniture used. */
export function planToShare(space: Space, inventory: InventoryItem[], clearances: Record<string, number>): SharedPlan {
  const used = new Set(space.placements.map((p) => p.itemId));
  return {
    name: space.name,
    rooms: space.rooms,
    placements: space.placements,
    items: inventory.filter((i) => used.has(i.id)),
    clearances,
  };
}

export async function shareLink(plan: SharedPlan, base: string): Promise<string> {
  const json = JSON.stringify({ v: 1, ...plan });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return `${base}${PREFIX}${toBase64Url(packed)}`;
}

export function isShareHash(hash: string) {
  return hash.startsWith(PREFIX);
}

/** The plan in a share link's fragment, or null if it's broken, cut off or not a plan. */
export async function readShareHash(hash: string): Promise<SharedPlan | null> {
  if (!isShareHash(hash)) return null;
  try {
    const bytes = fromBase64Url(hash.slice(PREFIX.length));
    const json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_JSON));
    const parsed = SharedPlanSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const { v: _, ...plan } = parsed.data;
    // Drop placements that point at a room or piece that isn't in the link.
    const rooms = new Set(plan.rooms.map((r) => r.id));
    const items = new Set(plan.items.map((i) => i.id));
    return { ...plan, placements: plan.placements.filter((p) => rooms.has(p.roomId) && items.has(p.itemId)) } as SharedPlan;
  } catch {
    return null;
  }
}

/**
 * A shared plan as the recipient's own listing. Furniture they already have (same piece,
 * same sizes, e.g. shared to themselves) is reused; anything else is added under a new id.
 */
export function adoptSharedPlan(plan: SharedPlan, inventory: InventoryItem[], newId: () => string): { space: Space; items: InventoryItem[] } {
  const mine = new Map(inventory.map((i) => [i.id, i]));
  const ids = new Map<string, string>();
  const items: InventoryItem[] = [];
  for (const item of plan.items) {
    const existing = mine.get(item.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(item)) {
      ids.set(item.id, item.id);
    } else {
      const id = newId();
      ids.set(item.id, id);
      items.push({ ...item, id });
    }
  }
  const space: Space = {
    id: newId(),
    name: plan.name,
    createdAt: new Date().toISOString(),
    rooms: plan.rooms,
    placements: plan.placements.map((p) => ({ ...p, itemId: ids.get(p.itemId)! })),
  };
  return { space, items };
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Shared plan too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
