// Furniture from a store page or a screenshot of its specs (SPEC.md, "Furniture
// import"). The AI copies numbers and their units; code converts them. Shared by the
// server, the app and the Phase 0 store test.

import { z } from "zod";
import rules from "../engine/rules.json";
import type { Footprint } from "../model/types.ts";

const KINDS = Object.keys(rules.itemKinds) as [string, ...string[]];
const Unit = z.enum(["in", "cm", "mm", "ft", "m"]);
const Measure = z.object({ value: z.number(), unit: Unit }).nullable();

export const ProductReading = z.object({
  found: z.boolean().describe("False if there are no product dimensions at all."),
  name: z.string().nullable(),
  kind: z.enum(KINDS).describe("Closest kind of furniture. Use generic if none fits."),
  width: Measure.describe("Overall assembled width, side to side, as printed."),
  depth: Measure.describe("Overall assembled depth, front to back, as printed."),
  height: Measure.describe("Overall assembled height, as printed."),
  dims_kind: z.enum(["assembled", "package", "unclear"]).describe("Whether the numbers are the assembled product or the shipping box."),
  footprint: z.object({
    shape: z.enum(["rectangle", "l_shape", "round", "oval", "other"]),
    l_side: z
      .enum(["left", "right"])
      .nullable()
      .describe("For L shapes: which side the chaise or return is on, as seen standing in front of the piece facing it."),
    return_width: Measure.describe("For L shapes: width of the chaise or return."),
    return_depth: Measure.describe("For L shapes: overall depth measured on the chaise or return side."),
    detail: z.string().nullable(),
  }),
  sub_dimensions: z
    .array(z.object({ label: z.string(), value: z.number(), unit: Unit }))
    .describe("Secondary measurements (seat height, arm height, clearance). Never the overall size."),
  variant_note: z.string().nullable().describe("If the page lists several sizes, which one these numbers belong to."),
  evidence: z.string().describe("The exact text the overall dimensions were read from."),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ProductReading = z.infer<typeof ProductReading>;

export const PRODUCT_SYSTEM = `You read furniture product pages, or screenshots of their specifications, and report the product's overall assembled size.

Rules:
- Copy each number with the unit it is printed in. Do not convert units. Write fractions as decimals (47 1/4 = 47.25).
- Use the assembled, overall product dimensions. Ignore package, box, carton or shipping dimensions.
- Width is side to side, depth is front to back, height is floor to top.
- Seat height, arm height, clearance and similar go in sub_dimensions only.
- Detect non-rectangular footprints: L-shaped sectionals, chaises, corner desks. Report which side the chaise or return is on as seen standing in front of the piece facing it, and its width and depth.
- If several sizes or configurations are listed, use the one that is selected or listed first, and say which in variant_note.
- Never guess. If the overall dimensions are not present, set found to false.`;

const TO_INCHES = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4, ft: 12, m: 100 / 2.54 } as const;
const inches = (m: { value: number; unit: keyof typeof TO_INCHES } | null) =>
  m && m.value > 0 ? Math.round(m.value * TO_INCHES[m.unit] * 10) / 10 : null;

export interface ProductDraft {
  url: string | null;
  retailer: string | null;
  name: string;
  kind: string;
  width: number | null;
  depth: number | null;
  height: number | null;
  footprint: Footprint;
  subDimensions: { label: string; inches: number }[];
  variantNote: string | null;
  evidence: string | null;
  /** Things to check before confirming, shown highlighted. */
  issues: string[];
  /** Where it came from, for the confirm screen. */
  source: "page" | "screenshot" | "saved";
  /** For saved products: how many people confirmed this size. */
  confirmations?: number;
  /** For saved products: the size matches what the store's own page says. */
  pageVerified?: boolean;
}

export function draftFromProduct(r: ProductReading, url: string | null, source: "page" | "screenshot"): ProductDraft {
  const issues: string[] = [];
  const width = inches(r.width);
  const depth = inches(r.depth);
  const height = inches(r.height);
  if (!r.found || width === null || depth === null) issues.push("Couldn't find the full size. Type the missing numbers from the product page.");
  if (r.dims_kind === "package") issues.push("These look like shipping box sizes, not the assembled piece. Check them on the product page.");
  if (r.dims_kind === "unclear") issues.push("Not sure whether these are assembled or box sizes. Check them on the product page.");
  if (r.confidence !== "high") issues.push("The reader wasn't sure about these numbers.");

  let footprint: Footprint = { shape: "rect" };
  const fp = r.footprint;
  if (fp.shape === "l_shape") {
    const rw = inches(fp.return_width);
    const rd = inches(fp.return_depth);
    if (rw && rd && depth && rd > depth && fp.l_side) {
      footprint = { shape: "l", side: fp.l_side, returnWidth: rw, returnDepth: rd };
    } else {
      issues.push("This looks L-shaped, but the chaise or return size wasn't found. Add it below, or it will be treated as a rectangle.");
    }
  } else if (fp.shape !== "rectangle") {
    issues.push(`This piece is ${fp.shape === "other" ? "an unusual shape" : fp.shape}; it's planned as the rectangle around it.`);
  }

  return {
    url,
    retailer: url ? retailerFromUrl(url) : null,
    name: r.name?.trim() || "Product",
    kind: r.kind,
    width,
    depth,
    height,
    footprint,
    subDimensions: r.sub_dimensions.flatMap((s) => {
      const v = inches(s);
      return v === null ? [] : [{ label: s.label, inches: v }];
    }),
    variantNote: r.variant_note,
    evidence: r.evidence || null,
    issues,
    source,
  };
}

/** A confirmed product as saved in the shared cache. */
export const SavedProduct = z.object({
  url: z.string(),
  retailer: z.string().nullable(),
  name: z.string().min(1).max(200),
  kind: z.enum(KINDS),
  width: z.number().positive().max(600),
  depth: z.number().positive().max(600),
  height: z.number().positive().max(600),
  footprint: z.union([
    z.object({ shape: z.literal("rect") }),
    z.object({
      shape: z.literal("l"),
      side: z.enum(["left", "right"]),
      returnWidth: z.number().positive().max(600),
      returnDepth: z.number().positive().max(600),
    }),
  ]),
  subDimensions: z.array(z.object({ label: z.string().max(100), inches: z.number() })).max(30),
});

export type SavedProduct = z.infer<typeof SavedProduct>;

export function draftFromSaved(p: SavedProduct, confirmations: number, pageVerified = false): ProductDraft {
  return { ...p, variantNote: null, evidence: null, issues: [], source: "saved", confirmations, pageVerified };
}

/** Query parameters that track visits rather than pick a product or variant. */
const TRACKING = /^(utm_.*|gclid|fbclid|msclkid|mc_[a-z]+|ref|ref_|tag|cid|campaign|source|clickid|irclickid|_ga|igshid|spm)$/i;

/**
 * One key per product: lowercase host, no fragment, no tracking parameters, sorted
 * query, no trailing slash. Amazon links collapse to /dp/<ASIN>. Null if not a web link.
 */
export function normalizeProductUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  u.username = "";
  u.password = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.protocol = "https:";
  if (/(^|\.)amazon\.[a-z.]+$/.test(u.hostname)) {
    const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
    if (asin) return `https://${u.hostname}/dp/${asin.toUpperCase()}`;
  }
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = params.length ? `?${new URLSearchParams(params)}` : "";
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `https://${u.hostname}${u.port ? `:${u.port}` : ""}${path}${u.search}`;
}

const RETAILERS: Record<string, string> = {
  ikea: "IKEA",
  wayfair: "Wayfair",
  amazon: "Amazon",
  target: "Target",
  westelm: "West Elm",
  walmart: "Walmart",
  homedepot: "Home Depot",
  potterybarn: "Pottery Barn",
  cb2: "CB2",
  crateandbarrel: "Crate & Barrel",
  article: "Article",
};

export function retailerFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const base = host.split(".").slice(-2)[0];
    return RETAILERS[base] ?? host;
  } catch {
    return null;
  }
}
