// The shared product cache (SPEC.md, "Shared product cache"): confirmed products,
// keyed by normalized link, so the next person who pastes it gets an instant result.
//
// There are no accounts, so trust comes from evidence rather than identity. A size
// is only handed out when either:
//   - it matches what the server itself read from the store's page ("page-verified"),
//     confirmed by at least one person, or
//   - at least MIN_AGREEING different people confirmed that same size.
// Each person (a salted hash of their address) has one vote per link; confirming a
// different size moves their vote. One person can't replace a good entry.
//
// Stored as a JSON file for now; swap for a database when hosting needs it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SavedProduct } from "../src/import/product.ts";

export const MIN_AGREEING = 2;
const MAX_CANDIDATES = 12;

export interface PageReading {
  width: number;
  depth: number;
  height: number;
  /** "l" when the page showed an L-shaped piece. */
  shape: "rect" | "l";
  at: string;
}

export interface Candidate {
  product: SavedProduct;
  /** Matches the server's own reading of the store page. */
  pageVerified: boolean;
  /** Salted hashes of the people who confirmed this exact size. */
  voters: string[];
  firstAt: string;
  lastAt: string;
}

interface Entry {
  pageReading: PageReading | null;
  candidates: Candidate[];
}

export interface Served {
  product: SavedProduct;
  confirmations: number;
  pageVerified: boolean;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, b * 0.01);
const sameSize = (a: SavedProduct, b: SavedProduct) =>
  close(a.width, b.width) && close(a.depth, b.depth) && close(a.height, b.height) && JSON.stringify(a.footprint) === JSON.stringify(b.footprint);

export function matchesPage(p: SavedProduct, r: PageReading | null): boolean {
  return !!r && close(p.width, r.width) && close(p.depth, r.depth) && close(p.height, r.height) && p.footprint.shape === r.shape;
}

export function trusted(c: Candidate): boolean {
  return (c.pageVerified && c.voters.length >= 1) || c.voters.length >= MIN_AGREEING;
}

export class ProductCache {
  private entries = new Map<string, Entry>();
  private loaded: Promise<void>;
  private writing: Promise<void> = Promise.resolve();

  constructor(private file: string) {
    this.loaded = readFile(file, "utf8")
      .then((raw) => {
        for (const [url, v] of Object.entries(JSON.parse(raw) as Record<string, Partial<Entry> & { product?: unknown }>)) {
          // Entries from before voting (one unchecked confirmation) start untrusted.
          const candidates = (v.candidates ?? (v.product ? [{ product: v.product, pageVerified: false, voters: [], firstAt: "", lastAt: "" }] : []))
            .map((c) => ({ ...c, product: SavedProduct.safeParse(c.product) }))
            .filter((c) => c.product.success)
            .map((c) => ({ ...c, product: (c.product as { data: SavedProduct }).data }) as Candidate);
          this.entries.set(url, { pageReading: v.pageReading ?? null, candidates });
        }
      })
      .catch(() => {});
  }

  /** The size to hand out for this link, if one is trusted. */
  async get(url: string): Promise<Served | null> {
    await this.loaded;
    const best = this.entries
      .get(url)
      ?.candidates.filter(trusted)
      .sort((a, b) => b.voters.length - a.voters.length || Number(b.pageVerified) - Number(a.pageVerified) || b.lastAt.localeCompare(a.lastAt))[0];
    return best ? { product: best.product, confirmations: best.voters.length, pageVerified: best.pageVerified } : null;
  }

  /** Remember what the server read from the store page, to check confirmations against. */
  async recordPageReading(url: string, reading: Omit<PageReading, "at">): Promise<void> {
    await this.loaded;
    const entry = this.entries.get(url) ?? { pageReading: null, candidates: [] };
    entry.pageReading = { ...reading, at: new Date().toISOString() };
    for (const c of entry.candidates) c.pageVerified = matchesPage(c.product, entry.pageReading);
    this.entries.set(url, entry);
    await this.persist();
  }

  /** One person's confirmation. Returns what's now served for the link (maybe nothing yet). */
  async confirm(product: SavedProduct, voter: string): Promise<{ counted: boolean; served: Served | null }> {
    await this.loaded;
    const now = new Date().toISOString();
    const entry = this.entries.get(product.url) ?? { pageReading: null, candidates: [] };
    let mine = entry.candidates.find((c) => sameSize(c.product, product));
    // One vote per person per link: confirming a different size moves it.
    for (const c of entry.candidates) if (c !== mine) c.voters = c.voters.filter((v) => v !== voter);
    if (!mine) {
      mine = { product, pageVerified: matchesPage(product, entry.pageReading), voters: [], firstAt: now, lastAt: now };
      entry.candidates.push(mine);
    }
    const counted = !mine.voters.includes(voter);
    if (counted) mine.voters.push(voter);
    mine.lastAt = now;
    // Keep the list short: drop candidates nobody backs, then the weakest.
    entry.candidates = entry.candidates
      .filter((c) => c.voters.length > 0)
      .sort((a, b) => b.voters.length - a.voters.length || b.lastAt.localeCompare(a.lastAt))
      .slice(0, MAX_CANDIDATES);
    this.entries.set(product.url, entry);
    await this.persist();
    return { counted, served: await this.get(product.url) };
  }

  /** Admin: forget a link entirely. */
  async remove(url: string): Promise<boolean> {
    await this.loaded;
    const had = this.entries.delete(url);
    if (had) await this.persist();
    return had;
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
