// Browser side of floor plan import: shrink the picture, send it to the server,
// keep a copy on the device.

import { PlanReading } from "./reading.ts";

/**
 * Longest side sent for reading. Claude reads images up to about this size without
 * shrinking them itself, so the pixel positions it reports match ours.
 */
const MAX_SIDE = 1568;

export interface PlanImage {
  dataUrl: string;
  width: number;
  height: number;
}

export async function prepareImage(file: Blob): Promise<PlanImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a picture this browser can open."));
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * k);
    const height = Math.round(img.naturalHeight * k);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNGs read better on white
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readFloorPlan(image: PlanImage, signal?: AbortSignal): Promise<PlanReading> {
  const [head, base64] = image.dataUrl.split(",");
  const mediaType = head.match(/data:(.*?);/)?.[1] ?? "image/png";
  let res: Response;
  try {
    res = await fetch("/api/floorplan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mediaType }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error("Couldn't reach the floor plan reader. Check your connection, or type the sizes.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't read that floor plan.");
  const parsed = PlanReading.safeParse(body.reading);
  if (!parsed.success) throw new Error("The floor plan reader sent back something unexpected. Try again.");
  return parsed.data;
}

// Floor plan pictures can be large, so they live in IndexedDB rather than with the
// rest of the plan in localStorage. Failures are silent: the plan works without them.

const DB = "alcove-home";
const STORE = "images";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImage(key: string, image: PlanImage): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(image, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadImage(key: string): Promise<PlanImage | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as PlanImage) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
