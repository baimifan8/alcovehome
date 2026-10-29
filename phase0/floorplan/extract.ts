// Phase 0 · floor plan extraction.
// Reads every image in phase0/floorplan/images/ and writes one JSON per image to
// phase0/floorplan/out/, including token usage, cost and latency.
//
//   npm run p0:floorplan:extract            # all images
//   npm run p0:floorplan:extract -- a.png   # just these

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extract, mediaTypeFor } from "../shared/claude.ts";
import { Layout } from "./schema.ts";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const IMAGES = path.join(DIR, "images");
const OUT = path.join(DIR, "out");

const SYSTEM = `You read real-estate floor plan images and return the layout as structured data.

Rules:
- Report every room you can see, with its printed dimension label copied verbatim.
- Convert dimensions to inches (11'2" = 134). Metric labels: 1 m = 39.37 in.
- If a room has no printed dimensions, estimate them from the plan's scale only when at least one labeled wall makes the scale clear; mark those dims_source "inferred_from_scale". Otherwise leave them null.
- Doors: report swing direction from the drawn arc. Closet doors are type closet_door. Bifold/sliding closet doors are closet_door with swing "sliding".
- Never invent a number. If a label is unreadable, say so in warnings and lower confidence.
- Use confidence "low" for anything a person should double-check.`;

const INSTRUCTION = "Extract the floor plan in this image.";

async function main() {
  const requested = process.argv.slice(2);
  const files = requested.length
    ? requested
    : (await readdir(IMAGES)).filter((f) => mediaTypeFor(f) !== null).sort();
  if (!files.length) {
    console.error(`No images in ${IMAGES}. Add listing screenshots (png/jpg/webp) and re-run.`);
    process.exit(1);
  }

  for (const file of files) {
    const mediaType = mediaTypeFor(file);
    if (!mediaType) {
      console.warn(`skip ${file}: unsupported image type`);
      continue;
    }
    const base64 = (await readFile(path.join(IMAGES, file))).toString("base64");
    process.stdout.write(`${file} ... `);
    try {
      const run = await extract(Layout, SYSTEM, [{ kind: "image", mediaType, base64 }], INSTRUCTION);
      await writeFile(path.join(OUT, `${path.parse(file).name}.json`), JSON.stringify({ image: file, ...run }, null, 2));
      console.log(
        run.output
          ? `${run.output.rooms.length} rooms, ${run.output.openings.length} openings, $${run.costUsd?.toFixed(4)}, ${(run.latencyMs / 1000).toFixed(1)}s`
          : `FAILED (stop_reason=${run.stopReason})`,
      );
    } catch (err) {
      console.log(`ERROR ${(err as Error).message}`);
    }
  }
}

await main();
