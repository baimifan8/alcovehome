// Turning a product page into text worth reading, and spotting bot walls.
// Shared by the server and the Phase 0 store test.

/** Markers of bot walls. Matching is on lowercased HTML. */
const BLOCK_MARKERS = [
  "captcha",
  "access denied",
  "robot or human",
  "are you a robot",
  "px-captcha",
  "perimeterx",
  "_incapsula_resource",
  "datadome",
  "cf-chl",
  "challenge-platform",
  "request unsuccessful",
  "pardon our interruption",
];

export function detectBlock(status: number | null, html: string): { blocked: boolean; marker: string | null } {
  const lower = html.toLowerCase();
  const marker = BLOCK_MARKERS.find((m) => lower.includes(m)) ?? null;
  // Product pages often mention "captcha" in a script tag even when served fine,
  // so a marker only counts as a block on an error status or a small page.
  const blocked = (status !== null && status >= 400) || (marker !== null && html.length < 200_000);
  return { blocked, marker };
}

/** Pages longer than this keep only the passages around size words (see pageText). */
export const MAX_PAGE_CHARS = 150_000;
const SIZE_WORDS = /dimension|measurement|assembled|overall|width|depth|height|product size|\bW\s*x|\d\s*(?:"|''|in\b|cm\b|inch)/gi;
const WINDOW = 1500;

/**
 * JSON-LD blocks (they often carry sizes verbatim) followed by the visible text.
 * Very long pages are cut down, deliberately and visibly: JSON-LD is kept whole
 * and the visible text is reduced to the passages around size words.
 */
export function pageText(html: string): { text: string; trimmed: boolean } {
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim());
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const head = jsonLd.map((j) => `JSON-LD:\n${j}`).join("\n\n");
  if (head.length + visible.length <= MAX_PAGE_CHARS) {
    return { text: [head, `PAGE TEXT:\n${visible}`].filter(Boolean).join("\n\n"), trimmed: false };
  }
  // Merge windows around every size word.
  const spans: [number, number][] = [];
  for (const m of visible.matchAll(SIZE_WORDS)) {
    const a = Math.max(0, m.index! - WINDOW);
    const b = Math.min(visible.length, m.index! + WINDOW);
    const last = spans[spans.length - 1];
    if (last && a <= last[1]) last[1] = b;
    else spans.push([a, b]);
  }
  let excerpt = spans.map(([a, b]) => visible.slice(a, b)).join(" … ");
  excerpt = excerpt.slice(0, Math.max(10_000, MAX_PAGE_CHARS - head.length));
  return { text: [head.slice(0, MAX_PAGE_CHARS), `PAGE TEXT (passages mentioning sizes):\n${excerpt}`].filter(Boolean).join("\n\n"), trimmed: true };
}
