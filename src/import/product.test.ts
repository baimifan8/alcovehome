import { describe, expect, it } from "vitest";
import { draftFromProduct, normalizeProductUrl, retailerFromUrl, type ProductReading } from "./product.ts";

const reading = (patch: Partial<ProductReading> = {}): ProductReading => ({
  found: true,
  name: "MALM Desk",
  kind: "desk",
  width: { value: 140, unit: "cm" },
  depth: { value: 65, unit: "cm" },
  height: { value: 73, unit: "cm" },
  dims_kind: "assembled",
  footprint: { shape: "rectangle", l_side: null, return_width: null, return_depth: null, detail: null },
  sub_dimensions: [{ label: "Max load", value: 0, unit: "cm" }, { label: "Height under tabletop", value: 70, unit: "cm" }],
  variant_note: null,
  evidence: "Width: 140 cm Depth: 65 cm Height: 73 cm",
  confidence: "high",
  ...patch,
});

describe("draftFromProduct", () => {
  it("converts units in code, not by the reader", () => {
    const d = draftFromProduct(reading(), "https://www.ikea.com/us/en/p/malm-desk-white-60214159/", "page");
    expect(d).toMatchObject({ width: 55.1, depth: 25.6, height: 28.7, retailer: "IKEA", issues: [], footprint: { shape: "rect" } });
    expect(d.subDimensions).toEqual([{ label: "Height under tabletop", inches: 27.6 }]);
  });

  it("builds an L footprint for a sectional with a chaise", () => {
    const d = draftFromProduct(
      reading({
        kind: "sofa",
        width: { value: 110, unit: "in" },
        depth: { value: 36, unit: "in" },
        height: { value: 34, unit: "in" },
        footprint: { shape: "l_shape", l_side: "left", return_width: { value: 36, unit: "in" }, return_depth: { value: 66, unit: "in" }, detail: null },
      }),
      null,
      "screenshot",
    );
    expect(d.footprint).toEqual({ shape: "l", side: "left", returnWidth: 36, returnDepth: 66 });
  });

  it("flags box sizes, missing numbers and an L with no return size", () => {
    expect(draftFromProduct(reading({ dims_kind: "package" }), null, "page").issues.join(" ")).toMatch(/shipping box/);
    expect(draftFromProduct(reading({ depth: null }), null, "page")).toMatchObject({ depth: null });
    expect(draftFromProduct(reading({ depth: null }), null, "page").issues.join(" ")).toMatch(/missing numbers/);
    const l = draftFromProduct(reading({ footprint: { shape: "l_shape", l_side: null, return_width: null, return_depth: null, detail: null } }), null, "page");
    expect(l.footprint).toEqual({ shape: "rect" });
    expect(l.issues.join(" ")).toMatch(/treated as a rectangle/);
  });
});

describe("normalizeProductUrl", () => {
  it.each([
    ["https://www.IKEA.com/us/en/p/malm-desk-60214159/#reviews", "https://ikea.com/us/en/p/malm-desk-60214159"],
    ["https://www.wayfair.com/x/pdp/y-w123.html?piid=456&utm_source=g&gclid=1", "https://wayfair.com/x/pdp/y-w123.html?piid=456"],
    ["https://www.amazon.com/Some-Desk/dp/B0ABCDEF12/ref=sr_1_3?keywords=desk", "https://amazon.com/dp/B0ABCDEF12"],
    ["http://target.com/p/desk/-/A-123?b=2&a=1", "https://target.com/p/desk/-/A-123?a=1&b=2"],
  ])("%s", (input, want) => expect(normalizeProductUrl(input)).toBe(want));

  it.each(["not a url", "ftp://x.com/a", "javascript:alert(1)"])("rejects %j", (input) => expect(normalizeProductUrl(input)).toBeNull());

  it("names known retailers", () => {
    expect(retailerFromUrl("https://www.westelm.com/products/x")).toBe("West Elm");
    expect(retailerFromUrl("https://shop.example.co/x")).toBe("shop.example.co");
  });
});
