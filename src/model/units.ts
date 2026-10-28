// Inches are stored; feet/inches or centimeters are shown (SPEC.md, "Data model").

export type Units = "ftin" | "cm";

const CM_PER_IN = 2.54;

/** 134 -> 11′ 2″ (ftin) or 340 cm. Inches round to the nearest half. */
export function formatLength(inches: number, units: Units): string {
  if (!Number.isFinite(inches)) return "–";
  if (units === "cm") return `${Math.round(inches * CM_PER_IN)} cm`;
  const halves = Math.round(inches * 2);
  const sign = halves < 0 ? "-" : "";
  const abs = Math.abs(halves);
  const ft = Math.floor(abs / 24);
  const rest = abs - ft * 24;
  const inch = `${Math.floor(rest / 2)}${rest % 2 ? "½" : ""}″`;
  return ft ? `${sign}${ft}′ ${inch}` : `${sign}${inch}`;
}

/** Same as formatLength but inches only: 134 -> 134″. For furniture sizes. */
export function formatSize(inches: number, units: Units): string {
  if (units === "cm") return `${Math.round(inches * CM_PER_IN)} cm`;
  const v = Math.round(inches * 2) / 2;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}″`;
}

/** Value to prefill a typed field with. */
export function lengthFieldValue(inches: number, units: Units, bare: "ft" | "in" | "cm"): string {
  if (units === "cm" || bare === "cm") return String(Math.round(inches * CM_PER_IN * 10) / 10);
  if (bare === "in") return String(Math.round(inches * 10) / 10);
  const ft = Math.floor(inches / 12);
  const inch = Math.round((inches - ft * 12) * 10) / 10;
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}

/**
 * Parse a typed length. Accepts 11'2", 11' 2", 11 ft 2 in, 11.5', 134", 134 in,
 * 340 cm, 3.4 m, "11 2" (feet and inches) and bare numbers, which are read in
 * `bare` units. Returns inches, or null if the text isn't a length.
 */
export function parseLength(text: string, bare: "ft" | "in" | "cm"): number | null {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[′’‘]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/,/g, ".")
    .replace(/½/g, ".5")
    .replace(/\s+/g, " ");
  if (!s) return null;
  const num = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
  const ok = (v: number) => (Number.isFinite(v) && v >= 0 ? v : null);

  let m = s.match(new RegExp(`^${num} ?(?:'|ft|feet|foot)(?: ?${num} ?(?:"|in|inch|inches|''))?$`));
  if (m) return ok(parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0));
  m = s.match(new RegExp(`^${num} ?(?:"|in|inch|inches|'')$`));
  if (m) return ok(parseFloat(m[1]));
  m = s.match(new RegExp(`^${num} ?cm$`));
  if (m) return ok(parseFloat(m[1]) / CM_PER_IN);
  m = s.match(new RegExp(`^${num} ?(?:mm)$`));
  if (m) return ok(parseFloat(m[1]) / 10 / CM_PER_IN);
  m = s.match(new RegExp(`^${num} ?(?:m|meters?|metres?)$`));
  if (m) return ok((parseFloat(m[1]) * 100) / CM_PER_IN);
  m = s.match(new RegExp(`^${num} ${num}$`));
  if (m && bare === "ft") return ok(parseFloat(m[1]) * 12 + parseFloat(m[2]));
  m = s.match(new RegExp(`^${num}$`));
  if (m) {
    const v = parseFloat(m[1]);
    return ok(bare === "ft" ? v * 12 : bare === "cm" ? v / CM_PER_IN : v);
  }
  return null;
}
