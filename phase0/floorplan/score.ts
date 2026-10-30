// Phase 0 · score floor plan extraction against hand-labeled truth.
// Compares phase0/floorplan/out/<model>/<name>.json with phase0/floorplan/truth/<name>.json
// and writes phase0/floorplan/report-<model>.md. The model is the one extract used
// (ALCOVE_PLAN_MODEL, else ALCOVE_MODEL, else the app's default).
//
// The gate question is "is extraction good enough to fix in a confirm screen?",
// so the headline number is "fixes": how many edits a user would make to get
// from the extraction to the truth. Scoring runs on the same draft rooms the app's
// confirm screen shows (src/import/draft.ts), not on raw model output.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { draftFromReading, type DraftPlan } from "../../src/import/draft.ts";
import { modelFor } from "../../server/claude.ts";
import { PlanReading } from "../../src/import/reading.ts";
import { Truth } from "./schema.ts";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODEL = modelFor("plan");
const REPORT = path.join(DIR, `report-${MODEL}.md`);

// Proposed gate thresholds. Tune before the run, not after.
export const GATE = {
  dimensionAccuracy: 0.85, // share of labeled dimensions read within tolerance
  roomRecall: 0.9, // share of real rooms found
  medianFixes: 5, // median edits per plan
  fixablePlanShare: 0.9, // share of plans needing <= FIXABLE_MAX edits
};
const FIXABLE_MAX = 10;
const tolerance = (truthIn: number) => Math.max(2, truthIn * 0.02);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface PlanScore {
  image: string;
  truthRooms: number;
  foundRooms: number;
  extraRooms: number;
  dimsTotal: number;
  dimsCorrect: number;
  dimsWrong: number;
  dimsMissing: number;
  dimsWrongButFlagged: number;
  openingCountError: number;
  fixes: number;
  costUsd: number | null;
  latencyMs: number;
  notes: string[];
}

function dimsMatch(truth: [number, number], got: [number, number]) {
  const t = [...truth].sort((a, b) => a - b);
  const g = [...got].sort((a, b) => a - b);
  return Math.abs(t[0] - g[0]) <= tolerance(t[0]) && Math.abs(t[1] - g[1]) <= tolerance(t[1]);
}

function scorePlan(truth: Truth, plan: DraftPlan, run: { costUsd: number | null; latencyMs: number }): PlanScore {
  const unused = new Set(plan.rooms.map((_, i) => i));
  const s: PlanScore = {
    image: truth.image,
    truthRooms: truth.rooms.length,
    foundRooms: 0,
    extraRooms: 0,
    dimsTotal: 0,
    dimsCorrect: 0,
    dimsWrong: 0,
    dimsMissing: 0,
    dimsWrongButFlagged: 0,
    openingCountError: 0,
    fixes: 0,
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    notes: [],
  };

  for (const tr of truth.rooms) {
    const names = [tr.name, ...(tr.aliases ?? [])].map(norm);
    const idx = [...unused].find((i) => names.includes(norm(plan.rooms[i].name)));
    if (idx === undefined) {
      s.notes.push(`missed room "${tr.name}"`);
      if (tr.width_in !== null && tr.length_in !== null) {
        s.dimsTotal++;
        s.dimsMissing++;
      }
      s.openingCountError += tr.doors + tr.windows + (tr.closets ?? 0);
      continue;
    }
    unused.delete(idx);
    s.foundRooms++;
    const got = plan.rooms[idx];

    if (tr.width_in !== null && tr.length_in !== null) {
      s.dimsTotal++;
      if (got.width === null || got.length === null) {
        s.dimsMissing++;
        s.notes.push(`"${tr.name}": no dimensions`);
      } else if (dimsMatch([tr.width_in, tr.length_in], [got.width, got.length])) {
        s.dimsCorrect++;
      } else {
        s.dimsWrong++;
        // Flagged = highlighted on the confirm screen.
        if (got.issues.length) s.dimsWrongButFlagged++;
        s.notes.push(
          `"${tr.name}": got ${got.width}x${got.length}, want ${tr.width_in}x${tr.length_in} (${got.widthSource}${got.issues.length ? ", flagged" : ""})`,
        );
      }
    }

    const openings = got.openings;
    const doors = openings.filter((o) => o.type === "door").length;
    const windows = openings.filter((o) => o.type === "window").length;
    const closets = openings.filter((o) => o.type === "closet_door").length;
    const err =
      Math.abs(doors - tr.doors) +
      Math.abs(windows - tr.windows) +
      (tr.closets === undefined ? 0 : Math.abs(closets - tr.closets));
    if (err) s.notes.push(`"${tr.name}": doors ${doors}/${tr.doors}, windows ${windows}/${tr.windows}`);
    s.openingCountError += err;
  }

  s.extraRooms = unused.size;
  for (const i of unused) s.notes.push(`extra room "${plan.rooms[i].name}"`);
  s.fixes = s.truthRooms - s.foundRooms + s.extraRooms + s.dimsWrong + s.dimsMissing + s.openingCountError;
  return s;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

async function main() {
  const truthFiles = (await readdir(path.join(DIR, "truth"))).filter((f) => f.endsWith(".json") && f !== "TEMPLATE.json");
  const scores: PlanScore[] = [];
  const failures: string[] = [];

  for (const f of truthFiles.sort()) {
    const truth = Truth.parse(JSON.parse(await readFile(path.join(DIR, "truth", f), "utf8")));
    let raw: { output: unknown; stopReason: string | null; costUsd: number | null; latencyMs: number };
    try {
      raw = JSON.parse(await readFile(path.join(DIR, "out", MODEL, f), "utf8"));
    } catch {
      failures.push(`${f}: no extraction output (run extract first)`);
      continue;
    }
    const reading = PlanReading.safeParse(raw.output);
    if (!reading.success) {
      failures.push(`${f}: extraction failed (stop_reason=${raw.stopReason})`);
      continue;
    }
    scores.push(scorePlan(truth, draftFromReading(reading.data), raw));
  }

  if (!scores.length) {
    console.error(`Nothing to score. Need matching files in truth/ and out/${MODEL}/.`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  const sum = (k: keyof PlanScore) => scores.reduce((a, s) => a + (s[k] as number), 0);
  const plans = scores.length + failures.length; // a failed extraction counts as an unfixable plan
  const dimAcc = sum("dimsCorrect") / sum("dimsTotal");
  const recall = sum("foundRooms") / sum("truthRooms");
  const medFixes = median([...scores.map((s) => s.fixes), ...failures.map(() => Infinity)]);
  const fixable = scores.filter((s) => s.fixes <= FIXABLE_MAX).length / plans;
  const wrongDims = sum("dimsWrong");
  const costs = scores.map((s) => s.costUsd).filter((c): c is number => c !== null);

  const checks = [
    ["Dimension accuracy", pct(dimAcc), `≥ ${pct(GATE.dimensionAccuracy)}`, dimAcc >= GATE.dimensionAccuracy],
    ["Room recall", pct(recall), `≥ ${pct(GATE.roomRecall)}`, recall >= GATE.roomRecall],
    ["Median fixes per plan", String(medFixes), `≤ ${GATE.medianFixes}`, medFixes <= GATE.medianFixes],
    [`Plans needing ≤ ${FIXABLE_MAX} fixes`, pct(fixable), `≥ ${pct(GATE.fixablePlanShare)}`, fixable >= GATE.fixablePlanShare],
  ] as const;
  const pass = checks.every((c) => c[3]);

  const lines = [
    "# Phase 0 · Floor plan extraction results",
    "",
    `Generated ${new Date().toISOString()} from ${plans} plans read by ${MODEL}.`,
    "",
    `## Gate: ${pass ? "PASS" : "FAIL"}`,
    "",
    "| Check | Result | Threshold | |",
    "| --- | --- | --- | --- |",
    ...checks.map(([name, got, want, ok]) => `| ${name} | ${got} | ${want} | ${ok ? "✅" : "❌"} |`),
    "",
    "## Supporting numbers",
    "",
    `- Wrong dimensions highlighted on the confirm screen: ${wrongDims ? pct(sum("dimsWrongButFlagged") / wrongDims) : "n/a"} (${sum("dimsWrongButFlagged")}/${wrongDims}). Higher is better: the confirm screen can highlight them.`,
    `- Missing dimensions: ${sum("dimsMissing")}/${sum("dimsTotal")}`,
    `- Extra (hallucinated or split) rooms: ${sum("extraRooms")}`,
    `- Door/window/closet count errors: ${sum("openingCountError")}`,
    costs.length
      ? `- Cost per plan: avg $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}, max $${Math.max(...costs).toFixed(4)}`
      : "- Cost per plan: n/a",
    `- Latency per plan: median ${(median(scores.map((s) => s.latencyMs)) / 1000).toFixed(1)}s`,
    "",
    "## Per plan",
    "",
    "| Plan | Rooms found | Dims correct | Openings off | Fixes | Cost |",
    "| --- | --- | --- | --- | --- | --- |",
    ...scores.map(
      (s) =>
        `| ${s.image} | ${s.foundRooms}/${s.truthRooms}${s.extraRooms ? ` (+${s.extraRooms})` : ""} | ${s.dimsCorrect}/${s.dimsTotal} | ${s.openingCountError} | ${s.fixes} | ${s.costUsd === null ? "?" : `$${s.costUsd.toFixed(4)}`} |`,
    ),
    ...failures.map((f) => `| ${f} | | | | ∞ | |`),
    "",
    "## Errors by plan",
    "",
    ...scores.filter((s) => s.notes.length).flatMap((s) => [`**${s.image}**`, "", ...s.notes.map((n) => `- ${n}`), ""]),
  ];

  const report = lines.join("\n");
  await writeFile(REPORT, report);
  console.log(report.split("## Supporting numbers")[0]);
  console.log(`Full report: ${REPORT}`);
}

await main();
