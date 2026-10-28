# Alcove Home — developer notes

Will the furniture you already own fit in this home? Type a room's size from a listing, add your furniture, and get a fits / tight / doesn't-fit verdict for every piece, with the reason.

See SPEC.md for the product spec and phased plan.

## Status

| Phase | State |
| --- | --- |
| 0 · Proof tests | Harness built, not yet run (needs screenshots, retailer links and an API key). See [`phase0/README.md`](phase0/README.md). |
| 1 · 2D planner and fit engine | Built. **Gate passed:** all 27 golden cases pass. |
| 2 · Floor plan import | Not started. |
| 3 · Furniture import | Not started. |

## Run it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` typechecks and builds the installable web app (PWA) into `dist/`.

## What Phase 1 does

- **Rooms:** typed width × length (`11' 2"`, `134 in`, `340 cm`, or a bare number read as feet), plus doors, closet doors, windows and open doorways with wall, position, width, swing direction and hinge side. Several rooms per listing, several listings.
- **Furniture:** a saved inventory reused across listings. Add common items with typical sizes (`src/data/library.json`) or enter your own, including L-shaped sectionals and corner desks.
- **Arrange:** drag to move, drag the handle to rotate (15° steps), snapping flush to walls and other pieces (hold Alt for free movement). Keyboard: arrows nudge 1 in (Shift: 6 in), R rotates 90°, Delete removes.
- **Verdicts:** every piece shows fits / tight / doesn't fit with reasons ("chair pull-out needs 36 in, has 30 in (box)", "narrows the walkway to 28 in (needs 30 in) between the entry door and the closet door"). The narrowest point of a failing walkway is marked on the plan. "Suggest a fix" proposes a rotation or small move.
- **Settings:** feet/inches or centimeters; every clearance is editable.
- **Local-first:** everything is saved in the browser (`localStorage`); no account. Works offline once loaded, and can be added to the home screen.

## Fit engine

`src/engine/` holds pure functions: `evaluateRoom({ room, items, placements }, rules)` returns verdicts and doesn't touch its input. Clearances and each item type's use zones live in `src/engine/rules.json`, not in code.

| Tier | Rule | Result |
| --- | --- | --- |
| 0 | Crosses a wall or is outside the room; overlaps another piece; inside a door's swing arc or the strip kept clear in front of a doorway or closet | Doesn't fit |
| 1 | A use zone (desk chair pull-out, dresser drawers, bed side access on at least one side, sofa legroom, dining chairs, wardrobe doors) is cut by a wall or another piece | Tight |
| 2 | The walkway from the entry to another door or to a clear use zone is under the minimum (30 in) | Tight |
| 3 | Suggestions | Never change a verdict |

Verdicts that depend on an inferred wall or an unconfirmed door are marked **approximate**.

The golden cases in `src/engine/golden/cases/` were written before the engine (see the commit history) and are the Phase 1 gate. Their conventions are in [`src/engine/golden/README.md`](src/engine/golden/README.md).

### Interpretations worth reviewing

The spec left these open, so the engine makes a call on each. They're easy to change:

- **Main walkway** means: from the entry door (the one marked Entry, else the first door) to every other door and to every use zone that is clear. A 30 in wide path has to get within 15 in of the target. Zones that are already blocked (tier 1) aren't checked again.
- **Blame for a narrow walkway** goes to the pieces whose removal would widen it, not to everything along the route.
- **Doorway strip:** 12 in in front of every door, closet door and open doorway is kept clear (tier 0), on top of a swinging door's arc. Bifold doors keep clear a quarter of their width if that's larger.
- **Clearances the spec didn't give:** sofa legroom 14 in, dining chair pull-out 36 in, wardrobe doors 30 in.
- **Approximate** covers a piece within the walkway width (or its deepest use zone) of an inferred wall, or within door width plus walkway width of an unconfirmed opening.
- Walkway widths are measured on a 0.5 in grid and are accurate to about ±0.5 in.

### Not in Phase 1

Share links, add-ons and overrides (data model only), floor plan and product-link import (Phases 2–3), round tables.
