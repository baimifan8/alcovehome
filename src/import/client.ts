// Browser side of floor plan import: shrink the picture (or draw a PDF page as one),
// send it to the server, keep a copy on the device.

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

export const isPdf = (file: Blob) => file.type === "application/pdf" || (file instanceof File && /\.pdf$/i.test(file.name));

/** An open PDF: how many pages it has, and any page drawn as a floor plan picture. */
export interface PdfPlan {
  pages: number;
  render: (page: number) => Promise<PlanImage>;
}

/**
 * Open a PDF in the browser (pdf.js, loaded only when needed). Pages are drawn at
 * the same size limit as pictures, so the rest of the import works unchanged.
 */
export async function openPdf(file: Blob): Promise<PdfPlan> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false }).promise;
  } catch (err) {
    const locked = (err as Error).name === "PasswordException";
    throw new Error(locked ? "That PDF is password-protected. Save the floor plan page as a picture instead." : "Couldn't open that PDF. Try a screenshot of the floor plan instead.");
  }
  return {
    pages: doc.numPages,
    render: async (n) => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    },
  };
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
