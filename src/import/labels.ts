// Reading room sizes out of text: a floor plan's dimension label ("11'2\" x 12'0\"")
// or a listing's room list ("Bedroom 2: 11' x 12'"). Pure functions, no AI.

import { parseLength } from "../model/units.ts";

/** One number with an optional unit: 11, 11', 11'2", 11'-2", 11 ft 2 in, 134", 3.4 m, 340 cm. */
const PART =
  String.raw`\d+(?:\.\d+)?\s*(?:(?:'|′|ft\.?|feet)(?:\s*-?\s*\d+(?:\.\d+)?\s*(?:"|″|''|in\.?|inches)?)?|"|″|in\.?|inches|cm|m)?`;
const SEP = String.raw`\s*[x×X*]\s*`;
const TAIL = String.raw`(?:\s*(?:cm|m|ft\.?|feet)(?![a-z]))?`;
const DIMS = `(${PART})${SEP}(${PART})${TAIL}`;

/**
 * Parse a two-number dimension label into inches, in the order written. Bare numbers
 * are feet unless the label names a metric unit. Returns null if it isn't a size.
 */
export function parseDimensionLabel(label: string): [number, number] | null {
  const text = label.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const m = text.match(new RegExp(`^${DIMS}$`));
  if (!m) return null;
  const tail = text.slice(m[1].length).match(/(cm|m|ft\.?|feet)\s*$/)?.[1];
  // A metric unit anywhere applies to bare numbers ("3.4m x 3.6" means meters too).
  const metricUnit = text.match(/\d\s*(cm|m)(?![a-z])/)?.[1];
  const read = (part: string): number | null => {
    let p = part.trim().replace(/'-/g, "' ").replace(/ft\./g, "ft").replace(/in\./g, "in");
    // 12'10 (inch mark missing) means 12' 10"
    if (/^\d+(\.\d+)?\s*(?:'|′|ft|feet)\s*\d+(\.\d+)?$/.test(p)) p += '"';
    if (/^\d+(\.\d+)?$/.test(p)) {
      if (metricUnit) p += ` ${metricUnit}`;
      else if (tail === "ft" || tail === "feet") p += "'";
    }
    return parseLength(p, "ft");
  };
  const a = read(m[1]);
  const b = read(m[2]);
  if (a === null || b === null || a <= 0 || b <= 0) return null;
  return [a, b];
}

export interface ListedRoom {
  name: string;
  /** Inches, in the order written. */
  dims: [number, number];
  /** The size exactly as it appeared. */
  text: string;
}

/**
 * Find "room name + size" pairs in listing text. Handles one room per line or
 * several per line separated by commas, semicolons or bullets.
 */
export function parseListingText(text: string): ListedRoom[] {
  const out: ListedRoom[] = [];
  const chunks = text.split(/[\n\r;•|]+|,(?!\d)/);
  const re = new RegExp(`([a-z][a-z0-9 /&'.()-]*?)\\s*[:\\-–(=]?\\s*${DIMS}`, "gi");
  for (const chunk of chunks) {
    for (const m of chunk.matchAll(re)) {
      const sizeText = m[0].slice(m[1].length).replace(/^\s*[:\-–(=]?\s*/, "").trim();
      const dims = parseDimensionLabel(sizeText);
      if (!dims) continue;
      const name = m[1].trim().replace(/[\s:\-–(=]+$/, "").replace(/^[^a-z]+/i, "");
      out.push({ name: name ? name[0].toUpperCase() + name.slice(1) : `Room ${out.length + 1}`, dims, text: sizeText });
    }
  }
  return out;
}
