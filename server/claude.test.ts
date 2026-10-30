import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { extract, modelFor } from "./claude.ts";

const ENV = ["ALCOVE_MODEL", "ALCOVE_PLAN_MODEL", "ALCOVE_PRODUCT_MODEL"] as const;

/** A stand-in for the Claude API that records each request and answers {"ok": true}. */
let api: Server;
let requests: { headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  api = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: '{"ok":true}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 100 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

afterAll(() => {
  api.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

beforeEach(() => {
  requests = [];
  for (const k of ENV) delete process.env[k];
});

const read = (task: "plan" | "product") => extract(z.object({ ok: z.boolean() }), "system", [{ kind: "text", text: "page" }], "Read it.", task);

describe("model choice", () => {
  it("defaults to Sonnet for floor plans and Haiku for store pages", () => {
    expect(modelFor("plan")).toBe("claude-sonnet-5-5");
    expect(modelFor("product")).toBe("claude-haiku-5-5");
  });

  it("ALCOVE_MODEL sets both; the per-task settings win over it", () => {
    process.env.ALCOVE_MODEL = "claude-opus-5-5";
    expect([modelFor("plan"), modelFor("product")]).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);
    process.env.ALCOVE_PRODUCT_MODEL = "claude-haiku-5-5";
    expect([modelFor("plan"), modelFor("product")]).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it("asks for a fallback model only where the model supports it", async () => {
    const plan = await read("plan");
    const product = await read("product");
    const [planReq, productReq] = requests;

    expect(planReq.body.model).toBe("claude-sonnet-5-5");
    expect(planReq.body.fallbacks).toBe("default");
    expect(String(planReq.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");

    // Haiku rejects the fallback parameter, so it must not be sent at all.
    expect(productReq.body.model).toBe("claude-haiku-5-5");
    expect(productReq.body).not.toHaveProperty("fallbacks");
    expect(String(productReq.headers["anthropic-beta"] ?? "")).not.toContain("server-side-fallback");

    expect(plan.output).toEqual({ ok: true });
    expect(product.output).toEqual({ ok: true });
    // 1000 in + 100 out at $2/$10 per M vs $0.10/$0.50 per M.
    expect(plan.costUsd).toBeCloseTo(0.003);
    expect(product.costUsd).toBeCloseTo(0.00015);
  });
});
