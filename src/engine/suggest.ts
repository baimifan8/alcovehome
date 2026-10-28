// Tier 3: layout suggestions. They are advice only and never change a verdict;
// they come from re-running the engine on small variations of one placement.

import type { Placement } from "../model/types.ts";
import { evaluateRoom, type RoomInput } from "./evaluate.ts";
import type { Rules } from "./rules.ts";

export interface Suggestion {
  message: string;
  /** The placement as it would be after following the suggestion. */
  placement: Placement;
  result: "fits" | "tight";
}

const RANK = { fits: 0, tight: 1, "doesnt-fit": 2 } as const;
const NUDGES = [3, 6, 12, 18, 24];
const DIRS = [
  { dx: -1, dy: 0, word: "left" },
  { dx: 1, dy: 0, word: "right" },
  { dx: 0, dy: -1, word: "up" },
  { dx: 0, dy: 1, word: "down" },
];

/**
 * Up to `limit` single-step changes (rotate, or move along one axis) that improve
 * this placement's verdict without making any other placement's worse.
 */
export function suggest(input: RoomInput, rules: Rules, placementId: string, name: string, limit = 3): Suggestion[] {
  const base = evaluateRoom(input, rules);
  const before = new Map(base.verdicts.map((v) => [v.placementId, RANK[v.result]]));
  const current = before.get(placementId);
  const target = input.placements.find((p) => p.id === placementId);
  if (current === undefined || current === 0 || !target) return [];

  const candidates: { placement: Placement; message: string; cost: number }[] = [];
  for (const turn of [90, 270, 180]) {
    candidates.push({
      placement: { ...target, rotation: (((target.rotation + turn) % 360) + 360) % 360 },
      message: `Rotate ${name} ${turn === 270 ? "90° counterclockwise" : `${turn}°`}`,
      cost: turn === 180 ? 20 : 10,
    });
  }
  for (const n of NUDGES) {
    for (const d of DIRS) {
      candidates.push({
        placement: { ...target, x: target.x + d.dx * n, y: target.y + d.dy * n },
        message: `Move ${name} ${n} in ${d.word}`,
        cost: n,
      });
    }
  }

  const found: (Suggestion & { cost: number })[] = [];
  for (const c of candidates) {
    const placements = input.placements.map((p) => (p.id === placementId ? c.placement : p));
    const report = evaluateRoom({ ...input, placements }, rules);
    const after = new Map(report.verdicts.map((v) => [v.placementId, RANK[v.result]]));
    const mine = after.get(placementId)!;
    if (mine >= current) continue;
    if ([...after].some(([id, r]) => id !== placementId && r > (before.get(id) ?? 0))) continue;
    found.push({ message: c.message, placement: c.placement, result: mine === 0 ? "fits" : "tight", cost: c.cost + mine * 100 });
  }

  // Best outcome first, then the smallest change; one suggestion per kind of move.
  found.sort((a, b) => a.cost - b.cost);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const f of found) {
    const key = f.message.replace(/\d+ in /, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ message: f.message, placement: f.placement, result: f.result });
    if (out.length === limit) break;
  }
  return out;
}
