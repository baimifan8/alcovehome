// Phase 0 · product-link reading on the top retailers.
// Uses the app server's own fetcher, page cleanup, prompt and conversion, so the
// results describe what ships. For every URL in retailers.json:
//   1. fetch the page the way the server does and note whether it is blocked;
//   2. (with --browser) load it again in headless Chromium, like a heavier server would;
//   3. have Claude extract assembled dimensions from whatever text came back;
//   4. if a specs screenshot is listed, extract from that too (the fallback path);
//   5. compare against the hand-entered truth.
// Writes out/<retailer>-<n>.json per product and report.md.
//
//   npm run p0:furniture
//   npm run p0:furniture -- --browser      # needs `npm i -D playwright` + a Chromium

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extract, mediaTypeFor, type ExtractionRun } from "../../server/claude.ts";
import { detectBlock, pageText } from "../../server/pageText.ts";
import { safeFetch } from "../../server/safeFetch.ts";
import { draftFromProduct, PRODUCT_SYSTEM, ProductReading } from "../../src/import/product.ts";

type Product = ProductReading;

const DIR = path.dirname(new URL(import.meta.url).pathname);
const USE_BROWSER = process.argv.includes("--browser");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

interface Truth {
  width_in: number;
  depth_in: number;
  height_in: number;
  shape?: string;
}
interface ProductEntry {
  url: string;
  truth: Truth | null;
  screenshot: string | null;
}
interface Config {
  retailers: { retailer: string; products: ProductEntry[] }[];
}

interface FetchResult {
  status: number | null;
  finalUrl: string | null;
  bytes: number;
  blocked: boolean;
  blockMarker: string | null;
  error: string | null;
  text: string | null;
}

interface Accuracy {
  dimsCorrect: boolean;
  shapeCorrect: boolean | null;
}

async function plainFetch(url: string): Promise<FetchResult> {
  try {
    const page = await safeFetch(url);
    const b = detectBlock(page.status, page.html);
    return {
      status: page.status,
      finalUrl: page.finalUrl,
      bytes: page.html.length,
      blocked: b.blocked,
      blockMarker: b.marker,
      error: null,
      text: b.blocked ? null : pageText(page.html).text,
    };
  } catch (err) {
    return { status: null, finalUrl: null, bytes: 0, blocked: false, blockMarker: null, error: (err as Error).message, text: null };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null;
async function browserFetch(url: string): Promise<FetchResult> {
  try {
    if (!browser) {
      const pw = await import("playwright" as string);
      browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    }
    const page = await browser.newPage({ userAgent: UA });
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(4000); // let client-rendered spec tables load
      const html: string = await page.content();
      const status: number | null = res ? res.status() : null;
      const b = detectBlock(status, html);
      return { status, finalUrl: page.url(), bytes: html.length, blocked: b.blocked, blockMarker: b.marker, error: null, text: b.blocked ? null : pageText(html).text };
    } finally {
      await page.close();
    }
  } catch (err) {
    return { status: null, finalUrl: null, bytes: 0, blocked: false, blockMarker: null, error: (err as Error).message, text: null };
  }
}

function score(truth: Truth | null, p: Product | null): Accuracy | null {
  if (!truth || !p) return null;
  const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= Math.max(0.5, b * 0.01);
  const d = draftFromProduct(p, null, "page");
  return {
    dimsCorrect: p.found && close(d.width, truth.width_in) && close(d.depth, truth.depth_in) && close(d.height, truth.height_in),
    shapeCorrect: truth.shape ? p.footprint.shape === truth.shape : null,
  };
}

/** One failed API call should not end a 30-product run; log it and move on. */
async function safely(label: string, run: () => Promise<ExtractionRun<Product>>): Promise<ExtractionRun<Product> | null> {
  try {
    return await run();
  } catch (err) {
    console.log(`  ${label}: API error ${(err as Error).message}`);
    return null;
  }
}

const readText = (label: string, text: string) =>
  safely(label, () => extract(ProductReading, PRODUCT_SYSTEM, [{ kind: "text", text }], "Find this product's overall assembled size."));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mark = (a: Accuracy | null) => (!a ? "read" : a.dimsCorrect ? "✅" : "❌");
const fetchCell = (f: FetchResult | null) =>
  !f ? "–" : f.error ? `⚠️ error: ${f.error.slice(0, 40)}` : f.blocked ? `🚫 ${f.status}${f.blockMarker ? ` (${f.blockMarker})` : ""}` : `${f.status}`;

interface Row {
  retailer: string;
  url: string;
  plain: FetchResult;
  plainRead: ExtractionRun<Product> | null;
  plainAcc: Accuracy | null;
  browser: FetchResult | null;
  browserRead: ExtractionRun<Product> | null;
  browserAcc: Accuracy | null;
  shotRead: ExtractionRun<Product> | null;
  shotAcc: Accuracy | null;
}

async function main() {
  const config: Config = JSON.parse(await readFile(path.join(DIR, "retailers.json"), "utf8"));
  const rows: Row[] = [];

  for (const { retailer, products } of config.retailers) {
    for (const [i, entry] of products.entries()) {
      if (!entry.url) continue;
      console.log(`${retailer} #${i + 1}: ${entry.url}`);

      const plain = await plainFetch(entry.url);
      console.log(`  fetch: ${fetchCell(plain)} ${plain.bytes} bytes`);
      const plainRead = plain.text ? await readText("page", plain.text) : null;

      const browserRes = USE_BROWSER ? await browserFetch(entry.url) : null;
      if (browserRes) console.log(`  browser: ${fetchCell(browserRes)} ${browserRes.bytes} bytes`);
      const browserRead = browserRes?.text ? await readText("browser", browserRes.text) : null;

      let shotRead: ExtractionRun<Product> | null = null;
      const shotType = entry.screenshot ? mediaTypeFor(entry.screenshot) : null;
      if (entry.screenshot && shotType) {
        const base64 = (await readFile(path.join(DIR, "screenshots", entry.screenshot))).toString("base64");
        shotRead = await safely("screenshot", () =>
          extract(
            ProductReading,
            PRODUCT_SYSTEM,
            [{ kind: "image", mediaType: shotType, base64 }],
            "Find this product's overall assembled size in this screenshot.",
          ),
        );
      }

      const row: Row = {
        retailer,
        url: entry.url,
        plain,
        plainRead,
        plainAcc: score(entry.truth, plainRead?.output ?? null),
        browser: browserRes,
        browserRead,
        browserAcc: score(entry.truth, browserRead?.output ?? null),
        shotRead,
        shotAcc: score(entry.truth, shotRead?.output ?? null),
      };
      rows.push(row);
      for (const [label, read] of [["page", plainRead], ["browser", browserRead], ["screenshot", shotRead]] as const) {
        const o = read?.output;
        if (o) {
          const d = draftFromProduct(o, null, "page");
          console.log(`  ${label}: ${d.width} x ${d.depth} x ${d.height} in, ${o.footprint.shape}, ${o.dims_kind}`);
        }
      }

      // Drop page text from the saved JSON; it is large and reproducible.
      const save = { ...row, plain: { ...plain, text: undefined }, browser: browserRes && { ...browserRes, text: undefined } };
      await writeFile(path.join(DIR, "out", `${slug(retailer)}-${i + 1}.json`), JSON.stringify(save, null, 2));
    }
  }
  if (browser) await browser.close();

  if (!rows.length) {
    console.error("No product URLs in retailers.json yet. Fill in `url` for each retailer and re-run.");
    process.exit(1);
  }

  const byRetailer = new Map<string, Row[]>();
  for (const r of rows) byRetailer.set(r.retailer, [...(byRetailer.get(r.retailer) ?? []), r]);
  // "error" when every attempt failed for reasons that say nothing about the retailer
  // (DNS, proxy, timeout, missing Playwright, or the page loaded but the API call failed).
  const works = (rs: Row[], pick: (r: Row) => boolean, errored: (r: Row) => boolean): boolean | "error" =>
    rs.some(pick) ? true : rs.every(errored) ? "error" : false;
  const read = (r: ExtractionRun<Product> | null) => r?.output?.found === true;

  const summary = [...byRetailer].map(([retailer, rs]) => {
    const plainOk = works(
      rs,
      (r) => !r.plain.blocked && read(r.plainRead),
      (r) => !!r.plain.error || (r.plain.text !== null && r.plainRead === null),
    );
    const browserOk = USE_BROWSER
      ? works(
          rs,
          (r) => !!r.browser && !r.browser.blocked && read(r.browserRead),
          (r) => !!r.browser?.error || (r.browser?.text != null && r.browserRead === null),
        )
      : null;
    const shotOk = rs.some((r) => r.shotRead) ? rs.some((r) => read(r.shotRead)) : null;
    const path =
      plainOk === true
        ? "server fetch"
        : browserOk === true
          ? "headless browser"
          : plainOk === "error" || browserOk === "error"
            ? "unknown (network error, re-run)"
            : shotOk
              ? "screenshot fallback"
              : "manual / extension";
    return { retailer, plainOk, browserOk, shotOk, path };
  });

  const yn = (b: boolean | "error" | null) => (b === null ? "–" : b === "error" ? "error" : b ? "yes" : "no");
  const costs = rows
    .flatMap((r) => [r.plainRead, r.browserRead, r.shotRead])
    .map((r) => r?.costUsd)
    .filter((c): c is number => typeof c === "number");
  const accRows = rows.flatMap((r) => [r.plainAcc, r.browserAcc, r.shotAcc]).filter((a): a is Accuracy => a !== null);

  const lines = [
    "# Phase 0 · Product-link reading results",
    "",
    `Generated ${new Date().toISOString()}. ${rows.length} products across ${byRetailer.size} retailers. Headless browser: ${USE_BROWSER ? "on" : "off"}.`,
    "",
    "## By retailer",
    "",
    "| Retailer | Server fetch reads dims | Headless browser reads dims | Screenshot reads dims | v1 path |",
    "| --- | --- | --- | --- | --- |",
    ...summary.map((s) => `| ${s.retailer} | ${yn(s.plainOk)} | ${yn(s.browserOk)} | ${yn(s.shotOk)} | ${s.path} |`),
    "",
    "## Accuracy against hand-entered dimensions",
    "",
    accRows.length
      ? `- ${accRows.filter((a) => a.dimsCorrect).length}/${accRows.length} extractions within 0.5 in (or 1%) on all of W, D, H.`
      : "- No `truth` entered, so accuracy was not scored.",
    `- Package dimensions mistaken for assembled: ${rows.flatMap((r) => [r.plainRead, r.browserRead, r.shotRead]).filter((r) => r?.output?.dims_kind === "package").length}`,
    costs.length
      ? `- Cost per extraction: avg $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}, max $${Math.max(...costs).toFixed(4)}`
      : "- Cost per extraction: n/a",
    "",
    "## Per product",
    "",
    "| Retailer | URL | Fetch | Page dims | Browser | Browser dims | Screenshot dims |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.retailer} | ${r.url.slice(0, 60)} | ${fetchCell(r.plain)} | ${read(r.plainRead) ? mark(r.plainAcc) : "–"} | ${fetchCell(r.browser)} | ${read(r.browserRead) ? mark(r.browserAcc) : "–"} | ${read(r.shotRead) ? mark(r.shotAcc) : "–"} |`,
    ),
    "",
    "✅ / ❌ = matched / didn't match hand-entered truth; read = dimensions found, no truth to compare; – = nothing read.",
    "",
    "Note: results depend on the network the probe runs from. Retailers block datacenter IPs more aggressively than home connections, so run it from wherever the v1 server will live as well as from a laptop.",
  ];

  await writeFile(path.join(DIR, "report.md"), lines.join("\n"));
  console.log(`\nReport: ${path.join(DIR, "report.md")}`);
}

await main();
