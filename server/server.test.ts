import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectBlock, MAX_PAGE_CHARS, pageText } from "./pageText.ts";
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
  const product = {
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

  it("saves, counts agreeing confirmations, and lets a correction replace a bad entry", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "alcove-")), "products.json");
    const cache = new ProductCache(file);
    expect(await cache.get(product.url)).toBeNull();
    expect((await cache.confirm(product)).confirmations).toBe(1);
    expect((await cache.confirm(product)).confirmations).toBe(2);
    const fixed = await cache.confirm({ ...product, width: 47.2 });
    expect(fixed).toMatchObject({ confirmations: 1, product: { width: 47.2 } });

    // Survives a restart.
    expect(JSON.parse(await readFile(file, "utf8"))[product.url].product.width).toBe(47.2);
    expect((await new ProductCache(file).get(product.url))?.product.width).toBe(47.2);
  });
});
