import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.ALCOVE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.ALCOVE_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max";

// USD per million tokens. Used only to answer "what does each extraction cost?";
// update if ALCOVE_MODEL is changed.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// Created on first use, so a server without an API key can still start and say so.
let client: Anthropic | null = null;
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export function mediaTypeFor(file: string): ImageMediaType | null {
  const ext = file.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

export type Input =
  | { kind: "image"; mediaType: ImageMediaType; base64: string }
  | { kind: "text"; text: string };

export interface ExtractionRun<T> {
  output: T | null;
  stopReason: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
}

/**
 * One structured-output call: inputs + instructions in, schema-validated object out.
 * Refusals and truncation come back as `output: null` with the stop reason, so a
 * Phase 0 run records them as failures instead of crashing the batch.
 */
export async function extract<S extends z.ZodType>(
  schema: S,
  system: string,
  inputs: Input[],
  instruction: string,
): Promise<ExtractionRun<z.infer<S>>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = inputs.map((input) =>
    input.kind === "image"
      ? { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } }
      : { type: "text", text: input.text },
  );
  content.push({ type: "text", text: instruction });

  const started = Date.now();
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: EFFORT, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });
  const latencyMs = Date.now() - started;

  const usage = response.usage;
  const inputTokens =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const price = PRICE_PER_MTOK[response.model];
  const costUsd = price
    ? (inputTokens * price.input + usage.output_tokens * price.output) / 1_000_000
    : null;

  const ok = response.stop_reason === "end_turn";
  return {
    output: ok ? (response.parsed_output ?? null) : null,
    stopReason: response.stop_reason,
    model: response.model,
    inputTokens,
    outputTokens: usage.output_tokens,
    costUsd,
    latencyMs,
  };
}
