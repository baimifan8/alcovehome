// Phase 0 · floor plan extraction.
// Reads every image in phase0/floorplan/images/ with exactly the prompt and format
// the app uses (src/import/reading.ts) and writes one JSON per image to
// phase0/floorplan/out/, including token usage, cost and latency.
//
//   npm run p0:floorplan:extract            # all images
//   npm run p0:floorplan:extract -- a.png   # just these

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extract, mediaTypeFor } from "../../server/claude.ts";
import { imageSize } from "../../server/imageSize.ts";
import { PlanReading, READING_SYSTEM, readingInstruction } from "../../src/import/reading.ts";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const IMAGES = path.join(DIR, "images");
const OUT = path.join(DIR, "out");

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
    const bytes = await readFile(path.join(IMAGES, file));
    const size = imageSize(bytes);
    if (!size) {
      console.warn(`skip ${file}: can't read image size`);
      continue;
    }
    process.stdout.write(`${file} ... `);
    try {
      const run = await extract(
        PlanReading,
        READING_SYSTEM,
        [{ kind: "image", mediaType, base64: bytes.toString("base64") }],
        readingInstruction(size.width, size.height),
      );
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
