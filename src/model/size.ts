import type { InventoryItem } from "./types.ts";

/**
 * The size that counts for fit: the user's own size where they set one, else the
 * base (store) size, plus every add-on that is switched on.
 */
export function effectiveSize(item: InventoryItem): { width: number; depth: number; height: number } {
  const o = item.overrides ?? {};
  const on = item.addOns.filter((a) => a.on);
  const sum = (k: "width" | "depth" | "height") => on.reduce((t, a) => t + (a[k] || 0), 0);
  return {
    width: (o.width ?? item.width) + sum("width"),
    depth: (o.depth ?? item.depth) + sum("depth"),
    height: (o.height ?? item.height) + sum("height"),
  };
}

/**
 * The item as the fit engine sees it: overrides and add-ons folded into its size.
 * Extra depth also deepens an L-shaped piece's return, so the L keeps its shape.
 */
export function effectiveItem(item: InventoryItem): InventoryItem {
  if (!item.overrides && !item.addOns.some((a) => a.on)) return item;
  const size = effectiveSize(item);
  const fp = item.footprint;
  const extraDepth = size.depth - item.depth;
  return {
    ...item,
    ...size,
    footprint: fp.shape === "l" ? { ...fp, returnDepth: fp.returnDepth + extraDepth } : fp,
    overrides: undefined,
    addOns: [],
  };
}
