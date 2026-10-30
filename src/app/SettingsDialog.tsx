import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultRules } from "../engine/index.ts";
import { LengthInput } from "./LengthInput.tsx";
import type { Settings } from "./store.ts";
import { clearRuns, formatDuration, report, stopRun, summarize, timing } from "./timing.ts";

interface Props {
  open: boolean;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  /** Start a timed test run: the app goes to a new listing and the clock starts. */
  onStartRun: () => void;
}

export function SettingsDialog({ open, settings, onChange, onClose, onStartRun }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} className="settings">
      <h2>Settings</h2>
      <fieldset>
        <legend>Units</legend>
        <label className="inline">
          <input type="radio" name="units" checked={settings.units === "ftin"} onChange={() => onChange({ ...settings, units: "ftin" })} /> Feet and inches
        </label>
        <label className="inline">
          <input type="radio" name="units" checked={settings.units === "cm"} onChange={() => onChange({ ...settings, units: "cm" })} /> Centimeters
        </label>
      </fieldset>
      <fieldset>
        <legend>Clearances</legend>
        <p className="hint">Approximate norms. Change them to match how you live.</p>
        {Object.entries(defaultRules.clearances).map(([key, c]) => (
          <LengthInput
            key={key}
            label={c.label}
            value={settings.clearances[key] ?? c.inches}
            units={settings.units}
            bare="in"
            onChange={(v) => onChange({ ...settings, clearances: { ...settings.clearances, [key]: v } })}
          />
        ))}
        <button className="secondary" onClick={() => onChange({ ...settings, clearances: {} })}>
          Reset to defaults
        </button>
      </fieldset>
      <TimedRuns onStart={onStartRun} />
      <button onClick={onClose}>Done</button>
    </dialog>
  );
}

/** For testing with first-time users: how long from a floor plan to the first fit answer. */
function TimedRuns({ onStart }: { onStart: () => void }) {
  const { active, runs } = useSyncExternalStore(timing.subscribe, timing.get);
  const [copied, setCopied] = useState(false);
  const text = report(runs);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <fieldset>
      <legend>Timed test runs</legend>
      <p className="hint">
        For watching someone use the app for the first time. Start a run, hand over the device, and the app notes how long each step takes until the first fit answer
        (the goal is under 5 minutes). Results stay on this device.
      </p>
      {active ? (
        <div className="row wrap">
          <span>A run is on.</span>
          <button className="secondary" onClick={() => stopRun()}>
            Stop it (no answer reached)
          </button>
        </div>
      ) : (
        <button className="secondary" onClick={onStart}>
          Start a timed run
        </button>
      )}
      {runs.length > 0 && (
        <>
          <ul className="timed-runs">
            {runs.map((run, i) => {
              const s = summarize(run);
              return (
                <li key={run.id}>
                  Run {i + 1}:{" "}
                  {s.totalMs === null ? (
                    <span className="badge doesnt-fit">stopped</span>
                  ) : (
                    <span className={`badge ${s.underGoal ? "fits" : "doesnt-fit"}`}>{formatDuration(s.totalMs)}</span>
                  )}{" "}
                  · {s.clicks} clicks
                </li>
              );
            })}
          </ul>
          <details>
            <summary>Step by step</summary>
            <pre className="timed-report">{text}</pre>
          </details>
          <div className="row wrap">
            <button className="secondary" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy results"}
            </button>
            <button className="link danger" onClick={() => confirm("Delete all timed runs on this device?") && clearRuns()}>
              Delete results
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
