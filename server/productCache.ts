// The shared product cache (SPEC.md, "Shared product cache"): every confirmed product,
// keyed by its normalized link, so the next person who pastes it gets an instant
// result. A JSON file for now; swap for a database when hosting needs it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SavedProduct } from "../src/import/product.ts";

export interface CacheEntry {
  product: SavedProduct;
  /** How many confirmations matched this exact size. */
  confirmations: number;
  updatedAt: string;
}

export class ProductCache {
  private entries = new Map<string, CacheEntry>();
  private loaded: Promise<void>;
  private writing: Promise<void> = Promise.resolve();

  constructor(private file: string) {
    this.loaded = readFile(file, "utf8")
      .then((raw) => {
        for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, CacheEntry>)) {
          const p = SavedProduct.safeParse(v.product);
          if (p.success) this.entries.set(k, { ...v, product: p.data });
        }
      })
      .catch(() => {});
  }

  async get(url: string): Promise<CacheEntry | null> {
    await this.loaded;
    return this.entries.get(url) ?? null;
  }

  /**
   * Save a confirmed product. Confirming the same size again counts as agreement;
   * a different size replaces it and starts the count over, so one bad entry can't
   * outlive the next person's correction.
   */
  async confirm(product: SavedProduct): Promise<CacheEntry> {
    await this.loaded;
    const prev = this.entries.get(product.url);
    const same =
      prev &&
      ["width", "depth", "height"].every((k) => Math.abs((prev.product as never)[k] - (product as never)[k]) < 0.25) &&
      JSON.stringify(prev.product.footprint) === JSON.stringify(product.footprint);
    const entry: CacheEntry = {
      product: same ? prev.product : product,
      confirmations: same ? prev.confirmations + 1 : 1,
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(product.url, entry);
    await this.persist();
    return entry;
  }

  private persist() {
    // One write at a time; each writes the whole map via a temp file.
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(Object.fromEntries(this.entries), null, 1));
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}
