// Who's asking, and how often. There are no accounts, so a person is a salted hash of
// their network address: enough to count votes and requests, and the address itself
// is never stored. Limits live in memory, so they reset on restart and aren't shared
// between servers; move them to a shared store if you run more than one.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";

/** A salt kept with the data, so the same person hashes the same way after a restart. */
export async function loadSalt(dataDir: string): Promise<string> {
  if (process.env.ALCOVE_SALT) return process.env.ALCOVE_SALT;
  const file = path.join(dataDir, "salt");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const salt = randomBytes(32).toString("hex");
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, salt, { mode: 0o600 });
    return salt;
  }
}

/**
 * The client's address. Behind a proxy or load balancer, set ALCOVE_TRUST_PROXY=1 so
 * the X-Forwarded-For header is used; never set it when clients connect directly, or
 * anyone could pick their own address.
 */
export function clientAddress(req: IncomingMessage): string {
  if (process.env.ALCOVE_TRUST_PROXY === "1") {
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** IPv6 users often get a whole /64; count it as one person. */
export function personKey(address: string, salt: string): string {
  const a = address.replace(/^::ffff:/, "");
  const key = a.includes(":") ? a.split(":").slice(0, 4).join(":") : a;
  return createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 32);
}

/** Fixed-window counter: at most `max` per key per `windowMs`. */
export class RateLimit {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Counts one use. False when the key is over its limit (and then it isn't counted). */
  take(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now >= h.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(now);
      return true;
    }
    if (h.count >= this.max) return false;
    h.count++;
    return true;
  }

  private sweep(now: number) {
    for (const [k, h] of this.hits) if (now >= h.resetAt) this.hits.delete(k);
  }
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Defaults are generous for one person and small for an abuser; tune with env vars. */
export const limits = {
  /** Readings that cost money (floor plans, store pages, screenshots), per person. */
  readsPerPerson: new RateLimit(num("ALCOVE_READS_PER_HOUR", 30), HOUR),
  /** The same, for the whole server: a ceiling on the daily API bill. */
  readsTotal: new RateLimit(num("ALCOVE_READS_PER_DAY", 1000), DAY),
  /** Confirmations sent to the shared cache, per person. */
  confirmsPerPerson: new RateLimit(num("ALCOVE_CONFIRMS_PER_DAY", 100), DAY),
  /** Cache lookups (free, but cheap to hammer), per person. */
  lookupsPerPerson: new RateLimit(num("ALCOVE_LOOKUPS_PER_HOUR", 300), HOUR),
};
