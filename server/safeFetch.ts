// Fetching pages from links users paste. The server must never be pointed at its own
// network (SSRF), so every connection, including each redirect, is checked at the
// moment of connecting: public addresses only, ports 80/443, size and time limits.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** True for loopback, private, link-local, reserved and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, "ipv4");
  if (v === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return blocked.check(mapped, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true;
}

export class FetchRefused extends Error {}

/** DNS lookup that refuses to hand back a private address, used for every connection. */
function guardedLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(new FetchRefused(`Refusing to connect to ${hostname}`) as NodeJS.ErrnoException, "");
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export interface FetchedPage {
  status: number;
  finalUrl: string;
  html: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export async function safeFetch(
  url: string,
  { maxBytes = 5 * 1024 * 1024, timeoutMs = 20_000, maxRedirects = 5 } = {},
): Promise<FetchedPage> {
  let current = new URL(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") throw new FetchRefused("Only web links can be read");
    if (current.port && current.port !== "80" && current.port !== "443") throw new FetchRefused("Unusual port");
    if (current.username || current.password) throw new FetchRefused("Links with passwords can't be read");
    if (isIP(current.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(current.hostname.replace(/^\[|\]$/g, ""))) {
      throw new FetchRefused("Refusing to connect to a private address");
    }
    const res = await request(current, maxBytes, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, current);
      continue;
    }
    return { status: res.status, finalUrl: current.toString(), html: res.body };
  }
  throw new FetchRefused("Too many redirects");
}

function request(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; location?: string; body: string }> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as never,
        timeout: timeoutMs,
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: "" });
        }
        const enc = String(res.headers["content-encoding"] ?? "");
        const stream =
          enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new FetchRefused("Page too large"));
          } else chunks.push(c);
        });
        stream.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end();
  });
}
