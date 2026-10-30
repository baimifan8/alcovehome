import { beforeEach, describe, expect, it } from "vitest";
import { clearRuns, countClick, formatDuration, mark, report, startRun, stopRun, summarize, timing } from "./timing.ts";

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const s = (seconds: number) => T0 + seconds * 1000;

beforeEach(() => {
  stopRun();
  clearRuns();
});

describe("timed runs", () => {
  it("does nothing unless a run was started", () => {
    mark("plan-added", s(1));
    countClick();
    expect(timing.get()).toEqual({ active: null, runs: [] });
  });

  it("notes each step once and ends at the first fit answer", () => {
    startRun(T0);
    mark("plan-added", s(20));
    mark("plan-added", s(40)); // a second picture doesn't move the first time
    mark("plan-read", s(55));
    countClick();
    countClick();
    mark("rooms-confirmed", s(120));
    mark("furniture-added", s(150));
    mark("first-answer", s(171));
    mark("first-answer", s(300)); // after the run: ignored
    const { active, runs } = timing.get();
    expect(active).toBeNull();
    expect(runs).toHaveLength(1);
    const sum = summarize(runs[0]);
    expect(sum).toMatchObject({ totalMs: 171_000, underGoal: true, clicks: 2 });
    expect(sum.steps.map((st) => st.atMs)).toEqual([20_000, 55_000, 120_000, 150_000, 171_000]);
  });

  it("marks a run over 5 minutes, and keeps a stopped run without an answer time", () => {
    startRun(T0);
    mark("first-answer", s(301));
    startRun(s(400));
    mark("plan-added", s(410));
    stopRun(s(600));
    const [slow, stopped] = timing.get().runs.map(summarize);
    expect(slow).toMatchObject({ totalMs: 301_000, underGoal: false });
    expect(stopped).toMatchObject({ totalMs: null, underGoal: false });
    expect(stopped.steps[0].atMs).toBe(10_000);
  });

  it("writes a plain-text report", () => {
    startRun(T0);
    mark("plan-added", s(20));
    mark("first-answer", s(95));
    const text = report(timing.get().runs);
    expect(text).toMatch(/^1 of 1 runs reached a fit answer in under 5 minutes\./);
    expect(text).toContain("1m 35s to the first fit answer, under 5 minutes, 0 clicks");
    expect(text).toContain("    20s  Floor plan added");
    expect(text).toContain("      —  Plan read, ready to check");
    expect(report([])).toBe("No timed runs yet.");
  });

  it("formats durations", () => {
    expect(formatDuration(9_400)).toBe("9s");
    expect(formatDuration(61_000)).toBe("1m 01s");
    expect(formatDuration(299_600)).toBe("5m 00s");
  });
});
