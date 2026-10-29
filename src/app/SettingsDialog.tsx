import { useEffect, useRef } from "react";
import { defaultRules } from "../engine/index.ts";
import { LengthInput } from "./LengthInput.tsx";
import type { Settings } from "./store.ts";

interface Props {
  open: boolean;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, settings, onChange, onClose }: Props) {
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
      <button onClick={onClose}>Done</button>
    </dialog>
  );
}
