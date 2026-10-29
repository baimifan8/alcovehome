// Alcove Home server:
//   POST /api/floorplan           read a floor plan image with Claude (the API key stays here)
//   POST /api/product             read a store link: saved product, else the page with Claude
//   POST /api/product/screenshot  read a screenshot of a product's size details
//   POST /api/product/confirm     save a confirmed product for everyone (the shared cache)
//   everything else               serve the built app from dist/ (production only)
//
//   npm run server        # needs ANTHROPIC_API_KEY to read plans and products

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeProductUrl, PRODUCT_SYSTEM, ProductReading, SavedProduct } from "../src/import/product.ts";
import { PlanReading, READING_SYSTEM, readingInstruction } from "../src/import/reading.ts";
import { extract, hasApiKey, type ImageMediaType } from "./claude.ts";
import { imageSize } from "./imageSize.ts";
import { detectBlock, pageText } from "./pageText.ts";
import { ProductCache } from "./productCache.ts";
import { safeFetch } from "./safeFetch.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 12 * 1024 * 1024;
const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../dist");
const MEDIA: ImageMediaType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const DATA = process.env.ALCOVE_DATA_DIR ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "data");
const cache = new ProductCache(path.join(DATA, "products.json"));
const NOT_SET_UP = "Reading isn't set up on this server yet. You can still type the sizes.";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Image too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function floorplan(req: IncomingMessage, res: ServerResponse) {
  if (!hasApiKey()) {
    return send(res, 503, { error: NOT_SET_UP });
  }
  let body: { imageBase64?: string; mediaType?: string };
  try {
    body = (await readJson(req)) as typeof body;
  } catch (err) {
    return send(res, (err as { status?: number }).status ?? 400, { error: "That upload didn't work. Try a smaller image." });
  }
  const mediaType = body.mediaType as ImageMediaType;
  if (!body.imageBase64 || !MEDIA.includes(mediaType)) {
    return send(res, 400, { error: "Send a PNG, JPEG, GIF or WebP image." });
  }
  const bytes = Buffer.from(body.imageBase64, "base64");
  const size = imageSize(bytes);
  if (!size) return send(res, 400, { error: "That file doesn't look like an image." });

  try {
    const run = await extract(
      PlanReading,
      READING_SYSTEM,
      [{ kind: "image", mediaType, base64: body.imageBase64 }],
      readingInstruction(size.width, size.height),
    );
    if (!run.output) {
      return send(res, 422, { error: "Couldn't read that floor plan. Try a clearer screenshot, or type the sizes." });
    }
    console.log(`floorplan ${size.width}x${size.height}: ${run.output.rooms.length} rooms, $${run.costUsd?.toFixed(4)}, ${run.latencyMs} ms`);
    send(res, 200, { reading: run.output, image: size });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: "Too many floor plans at once. Try again in a minute." });
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return send(res, 502, { error: "The floor plan reader is having trouble. Try again, or type the sizes." });
    }
    console.error(err);
    send(res, 500, { error: "Something went wrong reading that plan." });
  }
}

function apiError(res: ServerResponse, err: unknown, what: string) {
  if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: "Too many requests at once. Try again in a minute." });
  if (err instanceof Anthropic.APIError) {
    console.error("Claude API error", err.status, err.message);
    return send(res, 502, { error: `The ${what} reader is having trouble. Try again, or type the sizes.` });
  }
  console.error(err);
  send(res, 500, { error: `Something went wrong reading that ${what}.` });
}

const SCREENSHOT_HINT = "Take a screenshot of the size details on the product page and add it here instead.";

async function product(req: IncomingMessage, res: ServerResponse) {
  let body: { url?: string };
  try {
    body = (await readJson(req)) as typeof body;
  } catch {
    return send(res, 400, { error: "That didn't work. Try pasting the link again." });
  }
  const url = body.url ? normalizeProductUrl(body.url) : null;
  if (!url) return send(res, 400, { error: "That doesn't look like a link to a product page." });

  const saved = await cache.get(url);
  if (saved) return send(res, 200, { saved: saved.product, confirmations: saved.confirmations, url });
  if (!hasApiKey()) return send(res, 503, { error: NOT_SET_UP });

  let html: string;
  try {
    const page = await safeFetch(url);
    if (detectBlock(page.status, page.html).blocked) {
      return send(res, 422, { error: `This store doesn't let us read its pages. ${SCREENSHOT_HINT}`, needScreenshot: true, url });
    }
    html = page.html;
  } catch {
    return send(res, 422, { error: `Couldn't open that page. ${SCREENSHOT_HINT}`, needScreenshot: true, url });
  }

  try {
    const { text, trimmed } = pageText(html);
    if (trimmed) console.log(`product page ${url}: long page cut to the passages mentioning sizes`);
    const run = await extract(ProductReading, PRODUCT_SYSTEM, [{ kind: "text", text }], "Find this product's overall assembled size.");
    if (!run.output?.found) {
      return send(res, 422, { error: `Couldn't find the size on that page. ${SCREENSHOT_HINT}`, needScreenshot: true, url });
    }
    console.log(`product ${url}: $${run.costUsd?.toFixed(4)}, ${run.latencyMs} ms`);
    send(res, 200, { reading: run.output, url });
  } catch (err) {
    apiError(res, err, "product");
  }
}

async function productScreenshot(req: IncomingMessage, res: ServerResponse) {
  if (!hasApiKey()) return send(res, 503, { error: NOT_SET_UP });
  let body: { imageBase64?: string; mediaType?: string };
  try {
    body = (await readJson(req)) as typeof body;
  } catch (err) {
    return send(res, (err as { status?: number }).status ?? 400, { error: "That upload didn't work. Try a smaller image." });
  }
  const mediaType = body.mediaType as ImageMediaType;
  if (!body.imageBase64 || !MEDIA.includes(mediaType) || !imageSize(Buffer.from(body.imageBase64, "base64"))) {
    return send(res, 400, { error: "Send a PNG, JPEG, GIF or WebP image." });
  }
  try {
    const run = await extract(
      ProductReading,
      PRODUCT_SYSTEM,
      [{ kind: "image", mediaType, base64: body.imageBase64 }],
      "Find this product's overall assembled size in this screenshot.",
    );
    if (!run.output?.found) return send(res, 422, { error: "Couldn't find a size in that screenshot. Make sure the size details are in view, or type them." });
    send(res, 200, { reading: run.output });
  } catch (err) {
    apiError(res, err, "screenshot");
  }
}

async function productConfirm(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "Bad request" });
  }
  const parsed = SavedProduct.safeParse(body);
  const url = parsed.success ? normalizeProductUrl(parsed.data.url) : null;
  if (!parsed.success || !url) return send(res, 400, { error: "That product can't be saved." });
  const entry = await cache.confirm({ ...parsed.data, url });
  send(res, 200, { confirmations: entry.confirmations });
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 404, { error: "Not found" });
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(DIST, "index.html"); // single-page app
  }
  try {
    await stat(file);
  } catch {
    return send(res, 404, { error: "Build the app first: npm run build" });
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/floorplan") return void floorplan(req, res);
  if (req.method === "POST" && req.url === "/api/product") return void product(req, res);
  if (req.method === "POST" && req.url === "/api/product/screenshot") return void productScreenshot(req, res);
  if (req.method === "POST" && req.url === "/api/product/confirm") return void productConfirm(req, res);
  if (req.method === "GET") return void serveStatic(req, res);
  send(res, 405, { error: "Method not allowed" });
}).listen(PORT, () => {
  console.log(`Alcove Home server on http://localhost:${PORT}${hasApiKey() ? "" : " (no ANTHROPIC_API_KEY: reading plans and store pages is off; saved products still work)"}`);
});
