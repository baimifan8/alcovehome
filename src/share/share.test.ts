import { describe, expect, it } from "vitest";
import type { InventoryItem, Space } from "../model/types.ts";
import { adoptSharedPlan, planToShare, readShareHash, shareLink } from "./share.ts";

const desk: InventoryItem = {
  id: "desk",
  nickname: "Desk",
  kind: "desk",
  source: { type: "product", url: "https://www.example.com/desk" },
  width: 48,
  depth: 24,
  height: 30,
  footprint: { shape: "rect" },
  addOns: [{ id: "arm", label: "Monitor arm", width: 0, depth: 6, height: 0, on: true }],
};
const sofa: InventoryItem = { ...desk, id: "sofa", nickname: "Sofa", kind: "sofa", source: { type: "manual" }, addOns: [] };

const space: Space = {
  id: "s",
  name: "12 Elm St",
  createdAt: "2026-10-30T00:00:00.000Z",
  sourceImage: "s",
  rooms: [
    {
      id: "r",
      name: "Bedroom",
      outline: [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 120 },
        { x: 0, y: 120 },
      ],
      wallSources: ["labeled", "labeled", "inferred", "user-edited"],
      openings: [{ id: "d", type: "door", wall: 2, offset: 100, width: 32, operation: "swing", swing: "in", hinge: "right", confirmed: true }],
    },
  ],
  placements: [{ id: "p", itemId: "desk", roomId: "r", x: 30.123456789, y: 12.5, rotation: 90 }],
};

const BASE = "https://alcove.example/";
const hashOf = (link: string) => link.slice(BASE.length);

describe("share links", () => {
  it("round-trips the plan and only the furniture placed in it", async () => {
    const plan = planToShare(space, [desk, sofa], { walkway: 32 });
    const link = await shareLink(plan, BASE);
    expect(link.startsWith(`${BASE}#share=`)).toBe(true);
    const read = await readShareHash(hashOf(link));
    expect(read).toEqual({ name: space.name, rooms: space.rooms, placements: space.placements, items: [desk], clearances: { walkway: 32 } });
  });

  it("leaves the floor plan picture out", async () => {
    const read = await readShareHash(hashOf(await shareLink(planToShare(space, [desk], {}), BASE)));
    expect(JSON.stringify(read)).not.toContain("sourceImage");
  });

  it("keeps a typical plan short enough to send", async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ ...desk, id: crypto.randomUUID(), nickname: `Piece ${i}` }));
    const big: Space = {
      ...space,
      rooms: Array.from({ length: 5 }, () => ({ ...space.rooms[0], id: crypto.randomUUID() })),
      placements: items.map((it, i) => ({ id: crypto.randomUUID(), itemId: it.id, roomId: space.rooms[0].id, x: i * 7.3141592, y: i * 3.21, rotation: 0 })),
    };
    const link = await shareLink(planToShare(big, items, {}), BASE);
    expect(link.length).toBeLessThan(8000);
  });

  it("rejects broken, cut-off or tampered links", async () => {
    const link = await shareLink(planToShare(space, [desk], {}), BASE);
    expect(await readShareHash("#share=")).toBeNull();
    expect(await readShareHash("#share=not-a-plan")).toBeNull();
    expect(await readShareHash(hashOf(link).slice(0, -20))).toBeNull();
    expect(await readShareHash("#other")).toBeNull();

    const evil = await shareLink(
      planToShare(space, [{ ...desk, source: { type: "product", url: "javascript:alert(1)" } }], {}),
      BASE,
    );
    expect(await readShareHash(hashOf(evil))).toBeNull();

    const badWall = { ...space, rooms: [{ ...space.rooms[0], openings: [{ ...space.rooms[0].openings[0], wall: 9 }] }] };
    expect(await readShareHash(hashOf(await shareLink(planToShare(badWall, [desk], {}), BASE)))).toBeNull();
  });

  it("refuses a link that unpacks to something huge", async () => {
    const huge = { ...planToShare(space, [desk], {}), name: "x".repeat(600_000) };
    expect(await readShareHash(hashOf(await shareLink(huge, BASE)))).toBeNull();
  });

  it("drops placements that point at missing rooms or furniture", async () => {
    const orphan = { ...space, placements: [...space.placements, { id: "q", itemId: "ghost", roomId: "r", x: 0, y: 0, rotation: 0 }] };
    const read = await readShareHash(hashOf(await shareLink({ ...planToShare(orphan, [desk], {}), items: [desk] }, BASE)));
    expect(read?.placements.map((p) => p.id)).toEqual(["p"]);
  });

  it("saving a copy reuses identical furniture and adds the rest under new ids", () => {
    const plan = planToShare({ ...space, placements: [...space.placements, { id: "p2", itemId: "sofa", roomId: "r", x: 80, y: 80, rotation: 0 }] }, [desk, sofa], {});
    let n = 0;
    const newId = () => `new${++n}`;
    const changedSofa = { ...sofa, width: 90 };
    const { space: copy, items } = adoptSharedPlan(plan, [desk, changedSofa], newId);
    expect(items).toEqual([{ ...sofa, id: "new1" }]);
    expect(copy.id).toBe("new2");
    expect(copy.placements.map((p) => p.itemId)).toEqual(["desk", "new1"]);
    expect(copy.sourceImage).toBeUndefined();
  });
});
