import Fastify from "fastify";
import { z } from "zod";
import { SubjectHintSchema, computeStats } from "@hhc/shared";
import { env, hasAnthropicKey, isOffline } from "./env";
import { interpret, type InterpretRequest } from "./anthropic/interpret";
import { runOsint } from "./anthropic/osintAgent";
import { makeModelComplete, makeLoopCreateMessage, makeWebSearch } from "./anthropic/client";
import { buildTools, toolContextFromEnv } from "./tools/registry";
import { getDb, isDbEnabled } from "./db/db";
import { recall, recordInquiry, getStatsRows } from "./db/store";
import { exportCaseArmored, importCaseArmored } from "./db/exportImport";

const IdentifiersSchema = z
  .object({
    company: z.string().optional(),
    domain: z.string().optional(),
    person: z.string().optional(),
    handle: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })
  .strip();

const InquiryBodySchema = z.object({
  identifiers: IdentifiersSchema,
  score: z.number(),
  band: z.enum(["low", "mid", "high"]),
  matchedIndicatorIds: z.array(z.string()).default([]),
  theme: z.string().optional(),
  evidenceKeys: z.array(z.string()).optional(),
  inputFingerprint: z.string().optional(),
});

const InterpretBodySchema = z.object({
  text: z.string().default(""),
  images: z
    .array(z.object({ mediaType: z.string(), dataBase64: z.string() }))
    .max(8)
    .default([]),
  consent: z.boolean().default(false),
});

export function buildServer() {
  // Screenshots are base64 → allow a generous body limit.
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

  app.get("/health", async () => ({
    ok: true,
    service: "hhc-agent",
    model: env.HHC_MODEL,
    offline: isOffline(),
    anthropicKey: hasAnthropicKey(),
    caseDb: isDbEnabled(),
  }));

  app.post("/interpret", async (req, reply) => {
    const parsed = InterpretBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", detail: parsed.error.message });
    }
    const body = parsed.data;
    if (!body.consent) {
      return reply.code(403).send({ error: "consent_required" });
    }
    if (isOffline()) {
      return reply.code(503).send({ error: "offline", message: "HHC_OFFLINE=1; §6 interpret needs network." });
    }
    if (!hasAnthropicKey()) {
      return reply.code(503).send({ error: "no_api_key", message: "Set ANTHROPIC_API_KEY in .env to use §6." });
    }

    const outcome = await interpret(body as InterpretRequest, makeModelComplete());
    if (!outcome.ok) {
      return reply.code(502).send({ error: outcome.error });
    }
    return reply.send({ ok: true, result: outcome.result, degraded: outcome.degraded });
  });

  app.post("/osint", async (req, reply) => {
    const parsed = SubjectHintSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", detail: parsed.error.message });
    }
    if (isOffline()) {
      return reply.code(503).send({ error: "offline", message: "HHC_OFFLINE=1; §7 needs network for the model." });
    }
    if (!hasAnthropicKey()) {
      return reply.code(503).send({ error: "no_api_key", message: "Set ANTHROPIC_API_KEY in .env to use §7." });
    }
    try {
      const ctx = toolContextFromEnv(makeWebSearch());
      const tools = buildTools(ctx);
      const result = await runOsint(parsed.data, tools, makeLoopCreateMessage());
      return reply.send({ ok: true, result });
    } catch (e) {
      return reply.code(502).send({ error: `osint_error: ${(e as Error).message}` });
    }
  });

  // §7.2/§5-1 — instant recall of a known subject (read happens BEFORE any query).
  app.post("/subject/recall", async (req, reply) => {
    const parsed = IdentifiersSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    if (!isDbEnabled()) {
      return reply.send({ ok: true, enabled: false, known: false, subject: null, clusterSuggestions: [] });
    }
    return reply.send({ ok: true, enabled: true, ...recall(getDb(), parsed.data) });
  });

  // §7.3/§7.5 — record an assessment into the encrypted case history; returns the diff.
  app.post("/inquiry", async (req, reply) => {
    const parsed = InquiryBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", detail: parsed.error.message });
    if (!isDbEnabled()) {
      return reply.code(503).send({ error: "db_disabled", message: "Set HHC_DB_KEY to enable case history." });
    }
    try {
      return reply.send({ ok: true, ...recordInquiry(getDb(), parsed.data) });
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // §7.6 — personal threat-landscape statistics.
  app.get("/stats", async (_req, reply) => {
    if (!isDbEnabled()) return reply.send({ ok: true, enabled: false });
    const { inquiries, subjects } = getStatsRows(getDb());
    return reply.send({ ok: true, enabled: true, stats: computeStats(inquiries, subjects) });
  });

  // §9 — age-encrypted export of the whole case DB (survives outside the Codespace).
  app.get("/export", async (_req, reply) => {
    if (!isDbEnabled()) return reply.code(503).send({ error: "db_disabled" });
    try {
      const data = await exportCaseArmored(getDb(), env.HHC_DB_KEY);
      const filename = `hhc-case-${new Date().toISOString().replace(/[:.]/g, "-")}.age`;
      return reply.send({ ok: true, filename, data });
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // §9 — import (merge) an age-encrypted export back in.
  app.post("/import", async (req, reply) => {
    const parsed = z.object({ data: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    if (!isDbEnabled()) return reply.code(503).send({ error: "db_disabled" });
    try {
      const result = await importCaseArmored(getDb(), parsed.data.data, env.HHC_DB_KEY);
      return reply.send({ ok: true, ...result });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  return app;
}

async function main() {
  const app = buildServer();
  try {
    await app.listen({ host: "127.0.0.1", port: env.HHC_AGENT_PORT });
    console.log(
      `[hhc-agent] http://127.0.0.1:${env.HHC_AGENT_PORT}  model=${env.HHC_MODEL} offline=${isOffline()} key=${hasAnthropicKey()} caseDb=${isDbEnabled()}`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
