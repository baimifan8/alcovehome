import { describe, expect, it } from "vitest";
import { formatLength, formatSize, parseLength } from "./units.ts";

describe("parseLength", () => {
  it.each([
    [`11'2"`, "ft", 134],
    [`11' 2"`, "ft", 134],
    [`11′ 2″`, "ft", 134],
    ["11 ft 2 in", "ft", 134],
    ["11 2", "ft", 134],
    ["11", "ft", 132],
    ["11.5'", "ft", 138],
    [`134"`, "ft", 134],
    ["134 in", "ft", 134],
    ["30", "in", 30],
    ["29.5", "in", 29.5],
    [`2½"`, "in", 2.5],
    ["254 cm", "in", 100],
    ["2.54 m", "in", 100],
    ["254", "cm", 100],
  ] as const)("%s (bare %s) -> %d in", (text, bare, inches) => {
    expect(parseLength(text, bare)).toBeCloseTo(inches, 6);
  });

  it.each(["", "abc", "11 x 12", "-3", "12 cm 4"])("rejects %j", (text) => {
    expect(parseLength(text, "ft")).toBeNull();
  });
});

describe("formatLength", () => {
  it("formats feet and inches", () => {
    expect(formatLength(134, "ftin")).toBe("11′ 2″");
    expect(formatLength(144, "ftin")).toBe("12′ 0″");
    expect(formatLength(30.5, "ftin")).toBe("2′ 6½″");
    expect(formatLength(8, "ftin")).toBe("8″");
  });
  it("formats centimeters", () => {
    expect(formatLength(100, "cm")).toBe("254 cm");
    expect(formatSize(60, "cm")).toBe("152 cm");
  });
  it("round-trips through parse", () => {
    for (const v of [0, 7.5, 30, 134, 157.5]) expect(parseLength(formatLength(v, "ftin"), "ft")).toBe(v);
  });
});
