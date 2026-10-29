// Browser side of furniture import: ask the server about a store link or a
// screenshot, and share confirmed sizes back.

import type { PlanImage } from "./client.ts";
import { draftFromProduct, draftFromSaved, ProductReading, SavedProduct, type ProductDraft } from "./product.ts";

export type LinkResult = { ok: true; draft: ProductDraft } | { ok: false; error: string; needScreenshot: boolean; url: string | null };

async function post(path: string, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, status: 0, body: { error: "Couldn't reach the server. Check your connection, or type the sizes." } };
  }
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

export async function readProductLink(url: string, signal?: AbortSignal): Promise<LinkResult> {
  const r = await post("/api/product", { url }, signal);
  if (!r.ok) {
    return { ok: false, error: r.body.error ?? "Couldn't read that link.", needScreenshot: Boolean(r.body.needScreenshot), url: r.body.url ?? null };
  }
  if (r.body.saved) {
    const saved = SavedProduct.safeParse(r.body.saved);
    if (saved.success) return { ok: true, draft: draftFromSaved(saved.data, r.body.confirmations ?? 1) };
  }
  const reading = ProductReading.safeParse(r.body.reading);
  if (!reading.success) return { ok: false, error: "The reader sent back something unexpected. Try again.", needScreenshot: true, url: r.body.url ?? null };
  return { ok: true, draft: draftFromProduct(reading.data, r.body.url ?? url, "page") };
}

export async function readProductScreenshot(image: PlanImage, url: string | null, signal?: AbortSignal): Promise<ProductDraft> {
  const [head, base64] = image.dataUrl.split(",");
  const mediaType = head.match(/data:(.*?);/)?.[1] ?? "image/png";
  const r = await post("/api/product/screenshot", { imageBase64: base64, mediaType }, signal);
  if (!r.ok) throw new Error(r.body.error ?? "Couldn't read that screenshot.");
  const reading = ProductReading.safeParse(r.body.reading);
  if (!reading.success) throw new Error("The reader sent back something unexpected. Try again.");
  return draftFromProduct(reading.data, url, "screenshot");
}

/** Share a confirmed size so the next person with this link gets it instantly. Best effort. */
export async function shareConfirmedProduct(product: SavedProduct): Promise<void> {
  await post("/api/product/confirm", product).catch(() => {});
}
