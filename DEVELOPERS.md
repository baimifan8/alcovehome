# Alcove Home — developer notes

Will the furniture you already own fit in this home? Type a room's size from a listing, add your furniture, and get a fits / tight / doesn't-fit verdict for every piece, with the reason.

See [SPEC.md](SPEC.md) for the product spec and phased plan.

## Status

| Phase | State |
| --- | --- |
| 0 · Proof tests | Harness built, not yet run (needs screenshots, retailer links and an API key). See [`phase0/README.md`](phase0/README.md). |
| 1 · 2D planner and fit engine | Built. **Gate passed:** all 27 golden cases pass. |
| 2 · Floor plan import | Built. Gate ("a real listing screenshot becomes a confirmed layout") **not yet met**: verified end to end with a sample plan and a recorded reading, not with a real screenshot and live Claude call. |
| 3 · Furniture import | Built. Gate ("a new user goes from screenshot to verdict in under 5 minutes") **not yet met**: the full path runs end to end in a browser with recorded readings (about 1 s of app time and 8 actions), but hasn't been timed with real people or live reading. |

## API key

The server needs an **Anthropic API key**. Create one in the Claude Console (platform.claude.com) under API keys, add credits under Billing, and consider a monthly spend limit there too. Put the key in the server's environment as `ANTHROPIC_API_KEY`, never in the app or the repository. Each kind of reading has its own model:

| Reading | Default | Setting | Why |
| --- | --- | --- | --- |
| Floor plan pictures | `claude-sonnet-5-5` ($2 / $10 per M tokens) | `ALCOVE_PLAN_MODEL` | A hard visual reading: labels, door swings, pixel positions |
| Store pages and size screenshots | `claude-haiku-5-5` ($0.10 / $0.50) | `ALCOVE_PRODUCT_MODEL` | Mostly copying one line of sizes with its units; code does the conversion |

`ALCOVE_MODEL` sets both at once (the per-reading settings win over it). `ALCOVE_EFFORT` (default `high`) sets reasoning effort. Requests ask for a server-side fallback (`fallbacks: "default"`, retrying a rare safety decline on another model) only on models that accept it (Fable 5.1, Opus 5.5, Opus 5, Sonnet 5.5); Haiku rejects the parameter, so it's left out there. The server prints both models when it starts.

Expect roughly $0.03–0.10 per floor plan and under $0.01 per store page with the defaults (Opus 5.5 would be about $0.05–0.20 and $0.10–0.40); the server logs the actual cost of each reading. These defaults are an informed guess: Phase 0 compares models on real samples (see [`phase0/README.md`](phase0/README.md)), so settle them there.

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
| 0 | Crosses a wall or is outside the room; overlaps another piece or a built-in; inside a door's swing arc or the strip kept clear in front of a doorway or closet | Doesn't fit |
| 1 | A use zone (desk chair pull-out, dresser drawers, bed side access on at least one side, sofa legroom, dining chairs, wardrobe doors) is cut by a wall, a built-in or another piece | Tight |
| 2 | The walkway from the entry to another door or to a clear use zone is under the minimum (30 in) | Tight |
| 3 | Suggestions | Never change a verdict |

Verdicts that depend on an inferred wall, an unconfirmed door or an unconfirmed built-in are marked **approximate**.

**Built-ins** (`Room.builtIns`: kitchen islands, counters, radiators, fireplaces, tubs…) are axis-aligned rectangles in room coordinates. They block items (tier 0, `built-in`) and use zones (tier 1), are obstacles for the walkway, and snap like walls. They are never blamed for a narrow walkway: if only built-ins and walls narrow it, the room gets a note ("The counter leaves only 29 in between the entry door and the closet door").

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

- `src/import/reading.ts`: what Claude is asked for (`PlanReading`, structured output). It copies dimension labels verbatim and gives positions in image pixels, including a pixel box for each built-in. **It does no arithmetic.** The same prompt and schema are used by the Phase 0 test, so Phase 0 measures what ships.
- `src/import/labels.ts`: parses labels (`11'2" x 12'0"`, `12'10 x 10'`, `3.4 x 3.6 m`…) and listing text. Pure, tested.
- `src/import/draft.ts`: scale = median px-per-inch over labeled rooms. A label's longer number goes to the longer drawn side. Unlabeled rooms are measured with the scale and tagged `inferred`. Labels more than 12% off the drawing's scale are flagged. Openings are converted from pixels to wall offsets, and built-ins from pixel boxes to room inches (clipped to the room); all start unconfirmed.
- `src/app/ConfirmPlan.tsx`: the reading drawn over the picture at the typed sizes, so a wrong number shows as an outline missing the walls. Every size is a typed field, with highlighted issues, doubtful openings and doubtful built-ins (drawn on the picture too). Per-wall source tags (`labeled` / `inferred` / `user-edited`) and "Looks right" turn an inferred size into `user-edited`. Confirming makes openings and built-ins `confirmed`.
- `server/`: `index.ts` (API plus static files), `claude.ts` (shared structured-output call, model chosen per reading by `modelFor`; also used by Phase 0), `imageSize.ts`.
- Pictures are kept in IndexedDB (`Space.sourceImage`), not localStorage.
- Rooms from listing text set `Room.approximate`, which marks every verdict in them approximate.
- PDFs are drawn in the browser with pdf.js (`openPdf` in `src/import/client.ts`, loaded only when a PDF is chosen; the worker ships as a `.mjs` asset, which the server serves as JavaScript). The chosen page is rendered at 1568 px on the long side and from then on is just a picture: same reading, overlay and saved copy. Several pages: the person picks the page. Password-protected or broken PDFs get a plain message. The PDF itself never leaves the device.
- Images are shrunk to 1568 px on the long side before sending, so the pixel positions Claude reports match the image the overlay draws on.
- **Room shapes** (`src/model/shape.ts`): a room is a rectangle or an L (the rectangle with one corner cut out: `notch = { corner, width, length }`). `shapeOutline` builds the outline clockwise, wall 0 = top, so rectangles keep walls 0–3 = top, right, bottom, left; `shapeOf` recovers the shape from an outline. Each wall has a role (`top`…`left`, `notch-across`, `notch-down`), and `reshapeRoom` keeps openings on their role's wall at the same distance from the plan's left/top edge (a cut-out wall's openings fall back to the outer wall on that side), marks walls whose length changed `user-edited`, and keeps built-ins inside. `resizeRoom` is `reshapeRoom` with a new size.
- L rooms from images: the reading gives the overall `bbox_px` plus `notch_px` (the missing corner), and doors can be on `inner_across` / `inner_down`. The draft takes the label as the overall size, measures the cut-out from the drawing (`notchSource: inferred`) and always flags the room for a check. The plan's scale comes from rectangular rooms when there are any, since an L's label may give only one arm.
- Not yet: other non-rectangular rooms (T, U, angled walls; a shared plan's other polygons still work in the engine but can't be reshaped), angled or curved built-ins (planned as their bounding rectangle), dragging doors or built-ins on the overlay (positions are typed fields, as the spec asks).

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
- `server/productCache.ts`: the shared cache, a JSON file (`server/data/products.json`, or `$ALCOVE_DATA_DIR`). With no accounts, trust comes from evidence:
  - Each link keeps candidate sizes, each with the set of people who confirmed it. A person is a salted hash of their address (see `limits.ts`) and has one vote per link; confirming a different size moves the vote.
  - A size is served only when it's **page-verified** (it matches what the server itself read from the store page, via `recordPageReading`, and has at least one confirmation) or **at least 2 different people** confirmed it. Among trusted candidates, the most-backed wins.
  - So one person can't replace a good entry, or create one from a doctored screenshot.
  - Entries from before voting are loaded as untrusted.
  - Cached results still go through the confirm step.
- `server/limits.ts`: per-person and server-wide limits. These are in memory, so they reset on restart and aren't shared between servers.

  | Env var | Default | Limits |
  | --- | --- | --- |
  | `ALCOVE_READS_PER_HOUR` | 30 | Paid readings (plans, pages, screenshots) per person |
  | `ALCOVE_READS_PER_DAY` | 1000 | Paid readings for the whole server: caps the daily API bill |
  | `ALCOVE_CONFIRMS_PER_DAY` | 100 | Cache confirmations per person |
  | `ALCOVE_LOOKUPS_PER_HOUR` | 300 | Link lookups per person |

  Behind a proxy or load balancer, set `ALCOVE_TRUST_PROXY=1` so `X-Forwarded-For` is used. Never set it when clients connect directly. The hashing salt is generated into `$ALCOVE_DATA_DIR/salt` (mode 600), or set `ALCOVE_SALT`.
- Admin: remove a bad product with `curl -X DELETE -H "Authorization: Bearer $ALCOVE_ADMIN_TOKEN" "https://<host>/api/product?url=<link>"`. The endpoint is off unless `ALCOVE_ADMIN_TOKEN` is set (16+ characters).
- Remaining risk: someone with two network addresses (say, home and phone) can make two votes, so they can still get a size shared for a link nobody else has confirmed, but not override a better-backed or page-verified size. Accounts or per-device attestation would close that; both are out of scope for v1.
- `src/model/size.ts`: `effectiveSize` / `effectiveItem` = override ?? base, plus add-ons that are on. Extra depth also deepens an L's return. The engine, snapping and placement all use the effective item (`placeItem`, `localRects`, `bboxSize`).
- Store sizes are locked in the item editor. "Use my own size" sets `InventoryItem.overrides`, which is shown as "your size".
- The Phase 0 store test now uses the same fetcher, page cleanup, prompt and conversion.

## Share links

```
Space ──planToShare──▶ JSON ──deflate-raw──▶ base64url ──▶ <app>#share=…
#share=… ──base64url──▶ inflate (≤512 KB) ──zod──▶ SharedPlan ──▶ SharedPlanView ──"Save a copy"──▶ adoptSharedPlan ──▶ importSpace
```

- `src/share/share.ts`: the whole plan is in the URL **fragment**, so browsers never send it to the server. No storage, no accounts, works offline. A one-room plan with one piece is about 500 characters; the dialog warns above 8,000.
- A link carries the space's rooms, placements, only the inventory items placed in it, and the sender's clearance overrides (the viewer uses them so the verdicts match; a saved copy uses the recipient's settings). `sourceImage` is left out (the picture lives in the sender's IndexedDB and is too big for a link).
- Links are untrusted input: decompression stops at 512 KB, everything is validated by a strict zod schema with size and count limits, product links must be `http(s)`, opening walls must exist, and placements pointing at missing rooms or items are dropped. Anything else gives a "this link doesn't work" screen.
- The viewer is read-only (`readOnly` on `PlanView` and `VerdictPanel`: select, but no drag, rotate, remove or suggestions).
- Saving a copy gives the space a new id. A shared item identical to one already in the recipient's inventory (same id and content, e.g. sharing to yourself) is reused; others get new ids so they can't clash with or overwrite the recipient's own furniture.
- Links are snapshots; there's no live sync.

## Not built yet

The browser extension, round tables (planned as their bounding rectangle), accounts, and limits shared across several servers.
