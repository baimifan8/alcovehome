import { useEffect, useId, useState } from "react";
import { lengthFieldValue, parseLength, type Units } from "../model/units.ts";

interface Props {
  label: string;
  /** Inches; null shows an empty field that must be filled in. */
  value: number | null;
  units: Units;
  /** How a bare number is read: room sizes in feet, furniture in inches. */
  bare: "ft" | "in";
  onChange: (inches: number) => void;
  min?: number;
}

/** Typed length field (no sliders): accepts 11'2", 134 in, 340 cm… and commits on blur or Enter. */
export function LengthInput({ label, value, units, bare, onChange, min = 0 }: Props) {
  const id = useId();
  const bareUnit = units === "cm" ? "cm" : bare;
  const shown = value === null ? "" : lengthFieldValue(value, units, bareUnit);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState(false);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    if (value === null && !draft.trim()) return; // still blank: nothing to commit yet
    const v = parseLength(draft, bareUnit);
    if (v === null || v < min) {
      setError(true);
      return;
    }
    setError(false);
    if (value === null || Math.abs(v - value) > 1e-9) onChange(v);
    else setDraft(shown);
  };

  const hint = bareUnit === "cm" ? "cm" : bareUnit === "ft" ? `e.g. 11' 2"` : "in";
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        aria-invalid={error}
        placeholder={hint}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Commit only; submitting a form here would read the value before it updates.
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(shown);
            setError(false);
          }
        }}
      />
      {error && <small className="error">Not a length. Try {bareUnit === "cm" ? "340 cm" : `11' 2" or 134 in`}.</small>}
    </label>
  );
}
