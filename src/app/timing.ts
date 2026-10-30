// Timed test runs (SPEC.md, Phase 3 gate: a new user goes from screenshot to verdict
// in under 5 minutes). Off unless someone starts a run in Settings. While a run is on,
// the app notes when each step first happens and counts clicks; the run ends at the
// first fit answer. Everything stays in this browser: nothing is sent anywhere.

export const GOAL_MS = 5 * 60 * 1000;

/** Steps in the order a first-time user meets them. */
export const STEPS = [
  { key: "plan-added", label: "Floor plan added (picture, PDF, listing text or typed sizes)" },
  { key: "plan-read", label: "Plan read, ready to check" },
  { key: "rooms-confirmed", label: "Rooms checked and saved" },
  { key: "furniture-added", label: "First piece of furniture added" },
  { key: "first-answer", label: "First fit answer shown" },
] as const;

export type Step = (typeof STEPS)[number]["key"];

export interface Run {
  id: string;
  startedAt: number;
  /** When each step first happened (ms since epoch). */
  marks: Partial<Record<Step, number>>;
  clicks: number;
  /** Set at the first fit answer, or when the run is stopped by hand. */
  endedAt?: number;
}

export interface Summary {
  /** Time from start to the first fit answer, or null if it never came. */
  totalMs: number | null;
  underGoal: boolean;
  steps: { key: Step; label: string; atMs: number | null }[];
  clicks: number;
}

const KEY = "alcove-home:timing";

interface Stored {
  active: Run | null;
  runs: Run[];
}

let state: Stored = read();
const listeners = new Set<() => void>();

function read(): Stored {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : { active: null, runs: [] };
  } catch {
    return { active: null, runs: [] };
  }
}

function write(next: Stored) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the run still works until the page is closed.
  }
  for (const l of listeners) l();
}

/** For useSyncExternalStore. */
export const timing = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

export function startRun(now = Date.now()) {
  write({ ...state, active: { id: `run-${now.toString(36)}`, startedAt: now, marks: {}, clicks: 0 } });
}

/** Note a step the first time it happens in the active run; the first answer ends it. */
export function mark(step: Step, now = Date.now()) {
  const run = state.active;
  if (!run || run.marks[step] !== undefined) return;
  const next: Run = { ...run, marks: { ...run.marks, [step]: now } };
  if (step === "first-answer") finish({ ...next, endedAt: now });
  else write({ ...state, active: next });
}

export function countClick() {
  if (state.active) write({ ...state, active: { ...state.active, clicks: state.active.clicks + 1 } });
}

/** Stop the active run by hand (e.g. the person gave up). It's kept, without an answer time. */
export function stopRun(now = Date.now()) {
  if (state.active) finish({ ...state.active, endedAt: now });
}

function finish(run: Run) {
  write({ active: null, runs: [...state.runs, run] });
}

export function clearRuns() {
  write({ ...state, runs: [] });
}

export function summarize(run: Run): Summary {
  const at = (step: Step) => (run.marks[step] === undefined ? null : run.marks[step]! - run.startedAt);
  const totalMs = at("first-answer");
  return {
    totalMs,
    underGoal: totalMs !== null && totalMs <= GOAL_MS,
    steps: STEPS.map((s) => ({ key: s.key, label: s.label, atMs: at(s.key) })),
    clicks: run.clicks,
  };
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Plain-text results for every finished run, to paste into notes or a spreadsheet. */
export function report(runs: Run[]): string {
  if (!runs.length) return "No timed runs yet.";
  const lines = runs.map((run, i) => {
    const s = summarize(run);
    const head = `Run ${i + 1} (${new Date(run.startedAt).toLocaleString()}): ${
      s.totalMs === null ? "stopped before a fit answer" : `${formatDuration(s.totalMs)} to the first fit answer, ${s.underGoal ? "under" : "over"} 5 minutes`
    }, ${s.clicks} clicks`;
    const steps = s.steps.map((st) => `  ${(st.atMs === null ? "—" : formatDuration(st.atMs)).padStart(7)}  ${st.label}`);
    return [head, ...steps].join("\n");
  });
  const done = runs.map(summarize).filter((s) => s.totalMs !== null);
  const under = done.filter((s) => s.underGoal).length;
  return [`${under} of ${runs.length} runs reached a fit answer in under 5 minutes.`, "", ...lines].join("\n");
}
