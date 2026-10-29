# Alcove Home — developer notes

Will the furniture you already own fit in this home? Type a room's size from a listing, add your furniture, and get a fits / tight / doesn't-fit verdict for every piece, with the reason.

See SPEC.md for the product spec and phased plan.

## Status

| Phase | State |
| --- | --- |
| 0 · Proof tests | Harness built, not yet run (needs screenshots, retailer links and an API key). See [`phase0/README.md`](phase0/README.md). |
| 1 · 2D planner and fit engine | Built. **Gate passed:** all 27 golden cases pass. |
| 2 · Floor plan import | Built. Gate ("a real listing screenshot becomes a confirmed layout") **not yet met**: verified end to end with a sample plan and a recorded reading, not with a real screenshot and live Claude call. |
| 3 · Furniture import | Built. Gate ("a new user goes from screenshot to verdict in under 5 minutes") **not yet met**: the full path runs end to end in a browser with recorded readings (about 1 s of app time and 8 actions), but hasn't been timed with real people or live reading. |

## Run it

```bash
npm install
```

The app in development (planner, listing text and typed sizes all work without a server):

```bash
npm run dev
```

The floor plan reader, in a second terminal. Vite proxies `/api` to it on port 8787:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run server
```

Tests, and a production build (typecheck plus the installable web app in `dist/`):

```bash
npm test
```

```bash
npm run build
```

Production is one Node process that serves `dist/` and the API:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Without a key the server still starts; floor plan reading answers 503 with a plain message and the rest of the app works.

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

## Floor plan import (Phase 2)

```
picture ──resize to ≤1568 px──▶ POST /api/floorplan ──Claude──▶ PlanReading ──draftFromReading──▶ confirm screen ──▶ Rooms
listing text ──parseListingText──▶ draftFromText ───────────────────────────────────────────────▲
```

- `src/import/reading.ts`: what Claude is asked for (`PlanReading`, structured output). It copies dimension labels verbatim and gives positions in image pixels. **It does no arithmetic.** The same prompt and schema are used by the Phase 0 test, so Phase 0 measures what ships.
- `src/import/labels.ts`: parses labels (`11'2" x 12'0"`, `12'10 x 10'`, `3.4 x 3.6 m`…) and listing text. Pure, tested.
- `src/import/draft.ts`: scale = median px-per-inch over labeled rooms. A label's longer number goes to the longer drawn side. Unlabeled rooms are measured with the scale and tagged `inferred`. Labels more than 12% off the drawing's scale are flagged. Openings are converted from pixels to wall offsets, and all start unconfirmed.
- `src/app/ConfirmPlan.tsx`: the reading drawn over the picture at the typed sizes, so a wrong number shows as an outline missing the walls. Every size is a typed field, with highlighted issues and doubtful openings. Per-wall source tags (`labeled` / `inferred` / `user-edited`) and "Looks right" turn an inferred size into `user-edited`. Confirming makes openings `confirmed`.
- `server/`: `index.ts` (API plus static files), `claude.ts` (shared structured-output call with `fallbacks: "default"`; also used by Phase 0), `imageSize.ts`.
- Pictures are kept in IndexedDB (`Space.sourceImage`), not localStorage.
- Rooms from listing text set `Room.approximate`, which marks every verdict in them approximate.
- Images are shrunk to 1568 px on the long side before sending, so the pixel positions Claude reports match the image the overlay draws on.
- Not yet: PDF pages, non-rectangular rooms from images (the reading gives each room's bounding box), dragging doors on the overlay (positions are typed fields, as the spec asks).

## Furniture import (Phase 3)

```
link ──normalize──▶ shared cache hit? ──yes──▶ confirm (saved, N agree)
                         │no
                         ▼
               safeFetch ─blocked?──▶ screenshot ──Claude──▶ ProductReading ─┐
                         │ok                                                  ├─draftFromProduct──▶ confirm ──▶ inventory + POST /confirm (cache)
               pageText ──Claude──▶ ProductReading ───────────────────────────┘
```

- `src/import/product.ts`: `ProductReading` (Claude copies numbers **with their units**; code converts), `PRODUCT_SYSTEM`, `draftFromProduct` (issues: box sizes, missing numbers, an L with no return size, round/other shapes planned as their rectangle), `SavedProduct` (cache schema, validated on write), `normalizeProductUrl` (lowercase host, no `www`/fragment/tracking params, sorted query, Amazon → `/dp/ASIN`).
- `server/safeFetch.ts`: the only way the server fetches user-supplied links. http(s) only, ports 80/443, no credentials in links, at most 5 redirects, 5 MB and 20 s limits, and a **connect-time DNS check that refuses private, loopback, link-local and reserved addresses** on every hop (no DNS-rebinding gap).
- `server/pageText.ts`: bot-wall detection and page text (JSON-LD plus visible text). Pages over 150k characters keep JSON-LD whole and only the passages around size words; the server logs when that happens.
- `server/productCache.ts`: a JSON file (`server/data/products.json`, or `$ALCOVE_DATA_DIR`). Confirming the same size again increments `confirmations`; a different size replaces the entry and resets the count. Cached results still go through the confirm step. There's no auth or rate limit yet, so anyone can overwrite an entry. Move it to a database with per-user limits before a public launch.
- `src/model/size.ts`: `effectiveSize` / `effectiveItem` = override ?? base, plus add-ons that are on. Extra depth also deepens an L's return. The engine, snapping and placement all use the effective item (`placeItem`, `localRects`, `bboxSize`).
- Store sizes are locked in the item editor. "Use my own size" sets `InventoryItem.overrides`, which is shown as "your size".
- The Phase 0 store test now uses the same fetcher, page cleanup, prompt and conversion.

## Not built yet

Share links, the browser extension, round tables (planned as their bounding rectangle), auth and rate limits for the shared product cache.
