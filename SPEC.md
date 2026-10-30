# Alcove Home — Product Spec

Last updated: Oct 28, 2026 · Kevin

## Purpose

Alcove Home answers one question before you ever visit a place: will the furniture I already own fit in this home? A user pastes a labeled floor plan and links to their furniture, and gets a to-scale model with a clear fit verdict for every piece.

- **Problem:** Many rental and sale listings show room dimensions or a floor plan image, but no interactive plan and no way to test real furniture against it.
- **Who it's for (v1):** Renters and buyers comparing listings who own furniture and don't want to measure it.
- **Who it's for (later):** Apartment communities and property managers, who reuse a few unit layouts across hundreds of units.
- **What makes it different:** No measuring. Floor plans come from a screenshot, furniture comes from a product link, and the output is a verdict (fits / tight / doesn't fit), not a decorating tool.

## Platform

v1 is a website that installs like an app (PWA); a browser extension for one-click saving from retailer pages comes after v1.

**Website / PWA (v1)**

- No install: users open a link and start.
- Works on phone and desktop, with add-to-home-screen.
- Plans can be shared as a link.
- The same site can later be embedded on property-manager websites.

**Browser extension (after v1)**

- One click on a retailer product page saves the item to the user's inventory on the website.
- Reads the page in the user's own browser, so retailers that block the server usually still work.
- Desktop Chrome-type browsers only; it feeds the website and never replaces it.

**Not planned:** a Mac/Windows download. A native phone app is only considered later, for camera room scanning.

## Core loop (v1)

v1 succeeds if a first-time user can go from screenshot to fit verdict in under 5 minutes without measuring anything.

1. **Import the space.** Paste or upload a floor plan screenshot, or type room dimensions from listing text.
2. **Confirm the layout.** The app shows its reading laid over the original image. The user fixes any wrong number, wall or door before continuing.
3. **Add furniture.** Paste product links, or pick generic items ("queen bed"). Each item lands in a saved inventory reused across every listing.
4. **Arrange.** Drag, rotate and snap items in a top-down 2D view.
5. **Get the verdict.** Every item shows fits / tight / doesn't fit, with the reason ("blocks closet door", "under 30 in walkway").
6. **Save or share.** Save the plan per listing and share a read-only link.

## Floor plan import

AI reads the floor plan, but the user confirms it before anything is built, because one misread number makes every verdict wrong.

**Inputs, in order of reliability**

1. Typed room dimensions (most reliable, least effort for one room).
2. Floor plan image with labeled dimensions (screenshot, PDF page or photo).
3. Listing text with room sizes only ("Bedroom 2: 11' x 12'"). Rooms become rectangles with no door or window positions, marked as approximate.

**What the AI extracts**

- Room outlines and names.
- Every labeled dimension, tied to the wall it belongs to.
- Doors (with swing direction), windows, closets, built-ins.
- Scale: worked out from labeled walls, then applied to unlabeled walls.

**Confirm screen (required)**

- Extracted layout drawn over the original image, semi-transparent.
- Each dimension is a tappable, typed field (no sliders).
- Low-confidence items are highlighted for review.
- Users can add, move or delete doors and windows.
- Every wall carries a source tag: labeled, inferred from scale, or user-edited. Verdicts that depend on inferred walls say so.

## Furniture import

Users add furniture by pasting a product link; exact retailer dimensions are the base, and add-ons layer on top without overwriting them.

**Inputs, in order of reliability**

1. **Product URL.** The server reads the page and AI extracts dimensions. Many big retailers block automated reading, so this can fail.
2. **Screenshot of the specs section.** The fallback when a link fails. AI reads the image.
3. **Generic library.** Common items with typical sizes ("queen bed", "60 in desk") for users with no link.
4. **Manual entry.** Typed width, depth, height.

**Extraction rules**

- Use assembled dimensions. Ignore box/package dimensions.
- Capture overall width × depth × height; keep sub-dimensions (seat height, arm height) as extra info only.
- Detect non-rectangular shapes: L-shaped sectionals, corner desks, chaise sides. Store a footprint shape, not just a box.
- Show what was extracted with a link back to the source page, for the user to confirm.

**Shared product cache**

- Every confirmed product is saved by URL. The next user who pastes the same link gets an instant result.
- Over time this becomes a furniture-dimension database, which is the product's long-term advantage.

**Add-ons (adjustable dimensions)**

- Base item = retailer dimensions, locked unless the user overrides.
- Add-ons stack on top and toggle on/off: "monitor arm, +6 in depth", "hutch, +30 in height", "leaf extension, +18 in width".
- Overrides are labeled as user-edited.

## Fit engine rules

The fit engine uses tiered rules, not a simple overlap check: hard conflicts decide "doesn't fit", softer rules can only downgrade to "tight", and suggestions never change the verdict.

| Tier | Rule | Result if broken |
| --- | --- | --- |
| 0 | Item overlaps a wall, another item, or extends outside the room | Doesn't fit |
| 0 | Item blocks a door's swing or a closet door | Doesn't fit |
| 1 | Item's use zone overlaps another item or wall (chair pull-out, drawer opening, bed side access) | Tight |
| 2 | Main walkway narrower than the default minimum | Tight |
| 3 | Layout suggestions ("rotate desk to clear walkway") | Never changes verdict |

**Default clearances (editable, approximate norms)**

- Main walkway: 30 in minimum.
- Desk chair pull-out: 36 in behind the desk.
- Bed side access: 24 in on at least one side.
- Dresser drawers: 36 in in front.
- Door swing: the full arc of the door's width.

**Confidence**

- Any verdict that relies on an inferred wall or an unconfirmed door is labeled "approximate".

**Implementation rules**

- Clearance defaults and item-type use zones live in a data file (JSON), separate from the engine code.
- The engine is pure functions: layout + items in, verdicts out.
- Golden test cases (known layouts with known correct verdicts) are written before the engine.

## Data model

All measurements are stored in inches internally and displayed in the user's chosen units (ft/in or cm).

| Object | Key fields | Where it lives |
| --- | --- | --- |
| Space | name, source image, scale, rooms, created date | User device (v1) |
| Room | name, wall outline points, per-wall source tag (labeled / inferred / user-edited) | Inside Space |
| Opening | type (door, window, closet), wall, position, width, swing direction | Inside Room |
| Product | URL, retailer, name, width, depth, height, footprint shape, confirmed flag | Shared cache (server) |
| Inventory item | product link or generic type, nickname, add-ons, user overrides | User device (v1) |
| Add-on | label, +width, +depth, +height, on/off | Inside Inventory item |
| Placement | inventory item, room, x, y, rotation | Inside Space |
| Verdict | placement, result (fits / tight / doesn't fit), reasons, approximate flag | Computed, not stored |

v1 is local-first: spaces and inventory live on the user's device, so no accounts are needed. Only the product cache lives on a server.

## Phased build plan

Phase 0 is a set of cheap tests that decide whether the two AI-reading features are realistic before any app is built. Each phase is blocked until the gate before it passes. Phase 1 works with no AI at all, so a usable planner exists even if extraction disappoints.

1. **Phase 0 · Proof tests**
    - Run floor plan extraction on 20 real listing screenshots.
    - Test product-link reading on the top 10 retailers.
    - **Gate:** extraction is good enough to fix in a confirm screen.
2. **Phase 1 · 2D planner and fit engine**
    - Typed room dimensions, generic and manual furniture.
    - Drag, rotate, snap; tiered fit verdicts from the rules file.
    - **Gate:** all golden test cases pass.
3. **Phase 2 · Floor plan import**
    - Screenshot to extracted layout to confirm screen.
    - Doors, windows and per-wall source tags.
    - **Gate:** a real listing screenshot becomes a confirmed layout.
4. **Phase 3 · Furniture import**
    - Product links, screenshot fallback, shared product cache.
    - Add-ons and labeled overrides.
    - **Gate:** a new user goes from screenshot to verdict in under 5 minutes.
5. **Later · Beyond v1**
    - Browser extension for one-click saving, 3D view, accounts and sync.
    - Property-manager version with reusable unit layouts.

## Out of scope for v1

These are deliberately excluded so v1 stays finishable; each needs a conscious decision to add.

- 3D view and walkthroughs.
- Scraping or reading listings directly from Zillow or other listing sites (users paste their own screenshots and text).
- AR or phone-camera room scanning.
- Accounts, sync across devices, and team sharing.
- Decor features: colors, materials, wall art, rugs, styling.
- Delivery path check (doorways, hallways, stairs).
- Multi-floor homes.
- Browser extension for one-click saving (planned right after v1).
- Business dashboard for property managers.
- Affiliate links or furniture recommendations.

## Open questions

- [ ] Start renter-first (free consumer tool) or property-manager-first (one pilot community)?
- [ ] Which AI model reads floor plans and product pages, and what does each extraction cost?
- [ ] Which retailers block link reading? Test the top 10 (IKEA, Wayfair, Amazon, Target, West Elm, etc.) before building the fallback flow.
- [ ] How accurate is floor plan extraction on 20 real listing screenshots? This decides how heavy the confirm screen needs to be.
- [ ] Product name: working name Alcove Home. Alcove Rooms (a renter-focused real estate company) and Vitra's Alcove sofa share the name, so check trademarks, app store names and domains before launch.
