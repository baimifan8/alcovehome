import { describe, expect, it } from "vitest";
import { parseDimensionLabel, parseListingText } from "./labels.ts";

describe("parseDimensionLabel", () => {
  it.each([
    [`11'2" x 12'0"`, [134, 144]],
    [`11' 2" x 12'`, [134, 144]],
    [`11'-2" x 12'-0"`, [134, 144]],
    [`11'2" × 12'`, [134, 144]],
    [`11'2"x12'`, [134, 144]],
    [`12'10 x 10'`, [154, 120]],
    ["11 x 12", [132, 144]],
    ["11 X 12", [132, 144]],
    ["11.5' x 12'", [138, 144]],
    ["11 ft 2 in x 12 ft", [134, 144]],
    ["11 x 12 ft", [132, 144]],
    ["3.4 x 3.6 m", [3.4 * 100 / 2.54, 3.6 * 100 / 2.54]],
    ["3.4m x 3.6m", [3.4 * 100 / 2.54, 3.6 * 100 / 2.54]],
    ["340 x 360 cm", [340 / 2.54, 360 / 2.54]],
    ["340cm × 360cm", [340 / 2.54, 360 / 2.54]],
    ["3.4m x 3.6", [3.4 * 100 / 2.54, 3.6 * 100 / 2.54]],
  ])("%s", (label, want) => {
    const got = parseDimensionLabel(label);
    expect(got).not.toBeNull();
    expect(got![0]).toBeCloseTo(want[0], 4);
    expect(got![1]).toBeCloseTo(want[1], 4);
  });

  it.each(["", "Bedroom", "1,200 sq ft", "11 x", "x 12", "0 x 12"])("rejects %j", (label) => {
    expect(parseDimensionLabel(label)).toBeNull();
  });
});

describe("parseListingText", () => {
  it("reads one room per line in common formats", () => {
    const rooms = parseListingText(`
      Living room: 15'6" x 12'
      Bedroom 2 - 11' x 12'
      Primary Bedroom 13 x 14
      Kitchen (10'2" x 9')
      • Dining: 3.2 x 2.9 m
    `);
    expect(rooms.map((r) => r.name)).toEqual(["Living room", "Bedroom 2", "Primary Bedroom", "Kitchen", "Dining"]);
    expect(rooms[0].dims).toEqual([186, 144]);
    expect(rooms[1].dims).toEqual([132, 144]);
    expect(rooms[3].dims).toEqual([122, 108]);
    expect(rooms[4].dims[0]).toBeCloseTo(320 / 2.54, 4);
  });

  it("reads several rooms on one line", () => {
    const rooms = parseListingText("Bedroom 1: 12x13, Bedroom 2: 11x12; Office 9 x 10");
    expect(rooms.map((r) => [r.name, r.dims])).toEqual([
      ["Bedroom 1", [144, 156]],
      ["Bedroom 2", [132, 144]],
      ["Office", [108, 120]],
    ]);
  });

  it("does not mistake a room number for a size", () => {
    expect(parseListingText("Bedroom 2 11 x 12")[0]).toMatchObject({ name: "Bedroom 2", dims: [132, 144] });
  });

  it("ignores text without sizes", () => {
    expect(parseListingText("Sunny 2 bed, 1 bath. 1,050 sq ft. Laundry in unit.")).toEqual([]);
  });
});
