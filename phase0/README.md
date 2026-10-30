# Phase 0 · Proof tests

Two cheap tests that decide whether Alcove Home's two AI-reading features are realistic before any app is built (see [SPEC.md](../SPEC.md), "Phased build plan").

| Test | Question it answers | Script | Output |
| --- | --- | --- | --- |
| Floor plan extraction | Can AI read a listing's floor plan well enough that a user can fix it in a confirm screen? | `floorplan/extract.ts`, `floorplan/score.ts` | `floorplan/report-<model>.md` |
| Product-link reading | Which of the top 10 retailers can a server read dimensions from, and which need the screenshot fallback? | `furniture/probe.ts` | `furniture/report-<model>.md` |

Both use the app's own models and structured outputs, so every result is schema-valid JSON: `claude-sonnet-5-5` for floor plans and `claude-haiku-5-5` for store pages by default. They also record token cost and latency, which answers the spec's open question about cost per extraction. On models that support it, requests set `fallbacks: "default"`, so a rare safety decline is retried on a fallback model, not just dropped. `ALCOVE_EFFORT` (default `high`) sets reasoning effort.

### Comparing models

Each run saves its results under `out/<model>/` and its report as `report-<model>.md`, so runs with different models sit side by side. Override the model per run:

```bash
ALCOVE_PLAN_MODEL=claude-opus-5-5 npm run p0:floorplan:extract
```

```bash
ALCOVE_PLAN_MODEL=claude-opus-5-5 npm run p0:floorplan:score
```

```bash
ALCOVE_PRODUCT_MODEL=claude-sonnet-5-5 npm run p0:furniture
```

Pick, for each reading, the cheapest model that passes the gate, and set it as the default in `server/claude.ts` (`DEFAULT_MODEL`).

## Setup

```bash
npm install
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Test 1 · Floor plan extraction (20 screenshots)

### 1. Collect 20 screenshots

Save them as `floorplan/images/plan-01.png` … `plan-20.png`. Git ignores them because they are third-party images. Choose them to match what real users will paste, not to make the test pass:

| Count | Kind |
| --- | --- |
| 8 | Rental listing plans (apartment sites, Zillow/Apartments.com style) |
| 4 | Property-manager unit plans (clean, CAD-like) |
| 4 | For-sale listing plans, including at least one hand-drawn or scanned plan |
| 2 | Metric or mixed units |
| 2 | Hard cases: phone photo of a printed plan, low-res crop, or a plan with only some rooms labeled |

At least 5 plans should have rooms with no printed dimensions, so the scale-inference path gets tested.

### 2. Label the truth (about 5 min per plan)

For each image, copy `floorplan/truth/TEMPLATE.json` to `floorplan/truth/plan-NN.json` and enter, for every room:

- the name as printed, plus `aliases` for other names a reader might reasonably use;
- the printed dimensions in inches, or `null` if the room isn't labeled;
- the number of doors, windows and (optionally) closet doors and built-ins (kitchen islands, counter runs, fireplaces, radiators, tubs…).

Label before you look at any extraction output.

### 3. Run and score

```bash
npm run p0:floorplan:extract
```

```bash
npm run p0:floorplan:score
```

The scorer matches rooms by name, compares dimensions as an unordered pair (within 2 in or 2%, whichever is larger), and counts **fixes**: the edits a user would make in the confirm screen (missed room, extra room, wrong or missing dimension, each door/window/closet or built-in miscounted).

### Gate (proposed: agree on these before running)

| Check | Threshold |
| --- | --- |
| Labeled dimensions read correctly | ≥ 85% |
| Real rooms found | ≥ 90% |
| Median fixes per plan | ≤ 5 |
| Plans needing ≤ 10 fixes (failed extractions count as unfixable) | ≥ 90% |

The thresholds live in `GATE` in `floorplan/score.ts`. The report also shows **how many wrong values the model marked medium/low confidence**. If most wrong values are flagged, the confirm screen can highlight them and stay light. If they come back marked high confidence, the confirm screen has to make users check every number.

**If the gate fails:** Phase 1 still goes ahead, since it needs no AI. Floor plan import changes to "typed dimensions first, image as a tracing background" until extraction improves.

## Test 2 · Product-link reading (top 10 retailers)

### 1. Fill in `furniture/retailers.json`

For each retailer, paste 2–3 real product URLs: a desk, a bed or dresser, and an L-shaped sectional or corner desk where the retailer sells one. For accuracy scoring, read the assembled W × D × H off the page yourself and enter it as `truth`. Optionally screenshot the specs section into `furniture/screenshots/` and name it in `screenshot` to test the fallback path.

### 2. Run

```bash
npm run p0:furniture
```

To also test a headless browser (a heavier server-side option), install Playwright and run with `--browser`:

```bash
npm i -D playwright && npx playwright install chromium
```

```bash
npm run p0:furniture -- --browser
```

**Run it from two networks:** a home connection and the cloud host you'd deploy to. Retailers block datacenter IPs much more often than home IPs, and the server version will run from a datacenter.

### What it records

For each product it records:

- whether a plain server fetch was blocked (HTTP status and bot-wall markers);
- whether the headless browser got through;
- whether Claude found **assembled** dimensions (not package dimensions);
- whether it detected non-rectangular footprints;
- how the result compares to your hand-entered truth (within 0.5 in or 1%).

Network failures and API errors are reported as `error`, not as blocks.

### Gate input

The report gives each retailer a v1 path:

- **server fetch**
- **headless browser**
- **screenshot fallback**
- **manual / extension** (the browser extension planned after v1)

That decides how prominent the screenshot fallback needs to be in Phase 3. Phase 0 doesn't need every retailer to work. It needs every retailer to have a known path.

## Rough cost

These are estimates. The reports show actual costs.

- **Floor plans:** about $0.03–0.10 per plan on Sonnet 5.5 ($2 / $10 per M tokens), so about $0.50–2 for 20 plans. Opus 5.5 ($4 / $20) is about double; Haiku 5.5 ($0.10 / $0.50) is about 1/20 of Sonnet.
- **Product pages:** page text is larger. Under $0.01 per page on Haiku 5.5, so well under $1 for 30 products. Sonnet 5.5 would be about $0.05–0.20 per page and Opus 5.5 about $0.10–0.40.

Trying all three models on both tests costs up to about $25 in total.

## Status

- [x] Harness written and checked offline (scoring logic and blocked/error handling tested against fixtures).
- [ ] 20 floor plan screenshots collected and labeled.
- [ ] Floor plan run scored against the gate.
- [ ] Retailer URLs filled in, probe run from a home network.
- [ ] Probe run from the planned server host.
- [ ] Results summarized in SPEC.md open questions.
