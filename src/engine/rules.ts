import rulesJson from "./rules.json";

export type Side = "front" | "back" | "left" | "right";

export interface ZoneRule {
  label: string;
  sides: Side[];
  /** "all": every listed side needs the clearance. "any": at least one side does. */
  mode: "all" | "any";
  /** Key into Rules.clearances. */
  clearance: string;
}

export interface Rules {
  clearances: Record<string, { label: string; inches: number }>;
  doors: { bifoldProjection: number };
  itemKinds: Record<string, { label: string; zones: ZoneRule[] }>;
}

export const defaultRules: Rules = {
  clearances: rulesJson.clearances,
  doors: rulesJson.doors,
  itemKinds: rulesJson.itemKinds as Rules["itemKinds"],
};

/** Rules with some clearances replaced (user edits in settings). Unknown keys are ignored. */
export function withClearances(rules: Rules, overrides: Record<string, number>): Rules {
  const clearances = { ...rules.clearances };
  for (const [key, inches] of Object.entries(overrides)) {
    if (clearances[key] && Number.isFinite(inches) && inches >= 0) clearances[key] = { ...clearances[key], inches };
  }
  return { ...rules, clearances };
}

export function clearance(rules: Rules, key: string): number {
  return rules.clearances[key]?.inches ?? 0;
}

export function kindRule(rules: Rules, kind: string) {
  return rules.itemKinds[kind] ?? rules.itemKinds.generic ?? { label: kind, zones: [] };
}
