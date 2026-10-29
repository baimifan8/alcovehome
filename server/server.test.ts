import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectBlock, MAX_PAGE_CHARS, pageText } from "./pageText.ts";
import { personKey, RateLimit } from "./limits.ts";
import { ProductCache } from "./productCache.ts";
import { FetchRefused, isPrivateAddress, safeFetch } from "./safeFetch.ts";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not an ip"])(
    "refuses %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["93.184.216.34", "151.101.1.69", "2606:4700::6810:84e5"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("safeFetch", () => {
  it("refuses local and private targets, by address, by port and by scheme", async () => {
    for (const url of ["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://example.com:8080/", "file:///etc/passwd"]) {
      await expect(safeFetch(url), url).rejects.toBeInstanceOf(FetchRefused);
    }
  });

  it("refuses a name that resolves to a private address, at the moment of connecting", async () => {
    // "localhost" passes the up-front checks; the connect-time lookup refuses it. Every
    // redirect hop goes through the same lookup, so a redirect to a private address
    // is refused the same way.
    await expect(safeFetch("http://localhost/")).rejects.toBeInstanceOf(FetchRefused);
  });
});

describe("pageText", () => {
  it("keeps JSON-LD and visible text, drops scripts and styles", () => {
    const { text, trimmed } = pageText(
      `<script type="application/ld+json">{"width":"55 in"}</script><style>.a{}</style><script>var x=1</script><p>Width: 47&nbsp;1/4&quot;</p>`,
    );
    expect(trimmed).toBe(false);
    expect(text).toContain('{"width":"55 in"}');
    expect(text).toContain('Width: 47 1/4"');
    expect(text).not.toContain("var x");
  });

  it("cuts very long pages to the passages around size words", () => {
    const filler = "lorem ipsum ".repeat(30_000);
    const { text, trimmed } = pageText(`<p>${filler} Overall dimensions: 55 W x 24 D x 30 H in ${filler}</p>`);
    expect(trimmed).toBe(true);
    expect(text.length).toBeLessThan(MAX_PAGE_CHARS);
    expect(text).toContain("Overall dimensions: 55 W x 24 D x 30 H in");
  });

  it("spots bot walls", () => {
    expect(detectBlock(403, "<html>Access Denied</html>").blocked).toBe(true);
    expect(detectBlock(200, "<html>Pardon Our Interruption</html>").blocked).toBe(true);
    expect(detectBlock(200, "<html>Desk 48 in</html>").blocked).toBe(false);
  });
});

describe("ProductCache", () => {
  const good = {
    url: "https://ikea.com/p/desk",
    retailer: "IKEA",
    name: "Desk",
    kind: "desk",
    width: 55.1,
    depth: 25.6,
    height: 28.7,
    footprint: { shape: "rect" as const },
    subDimensions: [],
  };
  const bad = { ...good, width: 30 };
  const fresh = async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "alcove-")), "products.json");
    return { file, cache: new ProductCache(file) };
  };

  it("doesn't share a size one person confirmed with nothing to back it", async () => {
    const { cache } = await fresh();
    expect((await cache.confirm(good, "alice")).served).toBeNull();
    expect(await cache.get(good.url)).toBeNull();
  });

  it("shares a size once two different people agree", async () => {
    const { cache } = await fresh();
    await cache.confirm(good, "alice");
    expect((await cache.confirm(good, "alice")).counted).toBe(false); // same person twice
    expect(await cache.get(good.url)).toBeNull();
    await cache.confirm(good, "bob");
    expect(await cache.get(good.url)).toMatchObject({ confirmations: 2, pageVerified: false, product: { width: 55.1 } });
  });

  it("shares a size right away when it matches what the store's page says", async () => {
    const { cache } = await fresh();
    await cache.recordPageReading(good.url, { width: 55.1, depth: 25.6, height: 28.7, shape: "rect" });
    await cache.confirm(good, "alice");
    expect(await cache.get(good.url)).toMatchObject({ confirmations: 1, pageVerified: true });
  });

  it("doesn't let one person replace a shared size", async () => {
    const { cache } = await fresh();
    await cache.recordPageReading(good.url, { width: 55.1, depth: 25.6, height: 28.7, shape: "rect" });
    await cache.confirm(good, "alice");
    for (let i = 0; i < 5; i++) await cache.confirm(bad, "mallory");
    expect((await cache.get(good.url))?.product.width).toBe(55.1);
  });

  it("serves the best-backed size when people disagree", async () => {
    const { cache } = await fresh();
    await cache.confirm(bad, "m1");
    await cache.confirm(bad, "m2");
    expect((await cache.get(good.url))?.product.width).toBe(30); // two agree on the bad size
    for (const p of ["a", "b", "c"]) await cache.confirm(good, p);
    expect(await cache.get(good.url)).toMatchObject({ confirmations: 3, product: { width: 55.1 } });
  });

  it("moves a person's vote when they confirm a different size", async () => {
    const { cache } = await fresh();
    await cache.confirm(bad, "alice");
    await cache.confirm(bad, "bob");
    await cache.confirm(good, "bob"); // bob changes his mind
    expect(await cache.get(good.url)).toBeNull(); // bad has 1, good has 1
  });

  it("survives a restart, starts old unvoted entries untrusted, and can forget a link", async () => {
    const { file, cache } = await fresh();
    await cache.confirm(good, "alice");
    await cache.confirm(good, "bob");
    expect((await new ProductCache(file).get(good.url))?.confirmations).toBe(2);

    await writeFile(file, JSON.stringify({ [good.url]: { product: good, confirmations: 9 } }));
    expect(await new ProductCache(file).get(good.url)).toBeNull();

    const again = new ProductCache(file);
    expect(await again.remove(good.url)).toBe(true);
    expect(JSON.parse(await readFile(file, "utf8"))[good.url]).toBeUndefined();
  });
});

describe("limits", () => {
  it("counts per key within a window and resets after it", () => {
    const l = new RateLimit(2, 1000);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2), l.take("b", 2)]).toEqual([true, true, false, true]);
    expect(l.take("a", 1001)).toBe(true);
  });

  it("hashes addresses with the salt and groups an IPv6 /64 as one person", () => {
    expect(personKey("203.0.113.9", "s1")).not.toBe(personKey("203.0.113.9", "s2"));
    expect(personKey("203.0.113.9", "s1")).not.toContain("203");
    expect(personKey("2001:db8:1:2:aaaa::1", "s")).toBe(personKey("2001:db8:1:2:bbbb::9", "s"));
    expect(personKey("::ffff:203.0.113.9", "s")).toBe(personKey("203.0.113.9", "s"));
  });
});
