import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SubjectHintSchema, computeStats, type OsintResult } from "@hhc/shared";
import { env, hasAnthropicKey, isOffline, isAuthEnabled, isServeWeb, assertAuthConfig } from "./env";
import { interpret, type InterpretRequest } from "./anthropic/interpret";
import { runOsint, type OsintProgress } from "./anthropic/osintAgent";
import { makeModelComplete, makeLoopCreateMessage, makeWebSearch } from "./anthropic/client";
import { buildTools, toolContextFromEnv } from "./tools/registry";
import { getDb, isDbEnabled, type DB } from "./db/db";
import { recall, recordInquiry, getStatsRows } from "./db/store";
import { exportCaseArmored, importCaseArmored } from "./db/exportImport";
import { generateReport, type ReportRequest } from "./anthropic/report";
import { makeAuthOnRequest } from "./auth/hook";
import { registerAuthRoutes, registerAdminRoutes } from "./auth/routes";
import { bootstrapAdmin } from "./auth/users";

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

interface OsintJob {
  status: "running" | "done" | "error";
  startedAt: number;
  result?: OsintResult;
  error?: string;
  /** Live progress for the poller, so a long run shows "N sources checked". */
  progress?: OsintProgress;
}
const osintJobs = new Map<string, OsintJob>();
/** Drop jobs older than 30 minutes so the map can't grow unbounded (kept well past
 * the client poll deadline so a slow run's result is still retrievable). */
function sweepOsintJobs(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, job] of osintJobs) if (job.startedAt < cutoff) osintJobs.delete(id);
}

function webDistDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
}

/** Register the §6/§7 + case-DB feature routes (under the /api scope). */
function registerFeatureRoutes(api: FastifyInstance): void {
  api.get("/health", async () => ({
    ok: true,
    service: "hhc-agent",
    model: env.HHC_MODEL,
    offline: isOffline(),
    anthropicKey: hasAnthropicKey(),
    caseDb: isDbEnabled(),
    auth: isAuthEnabled(),
  }));

  api.post("/interpret", async (req, reply) => {
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

  // §7 OSINT is slow (multi-step tool-use). Run it as a background job and poll,
  // so no single request stays open long enough to hit a proxy/gateway 504.
  api.post("/osint", async (req, reply) => {
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
    sweepOsintJobs();
    const jobId = randomUUID();
    osintJobs.set(jobId, { status: "running", startedAt: Date.now() });
    const startedAt = Date.now();
    void (async () => {
      try {
        const ctx = toolContextFromEnv(makeWebSearch());
        const tools = buildTools(ctx);
        const result = await runOsint(parsed.data, tools, makeLoopCreateMessage(), {
          onProgress: (p) => {
            const j = osintJobs.get(jobId);
            if (j && j.status === "running") j.progress = p;
          },
        });
        osintJobs.set(jobId, { status: "done", result, startedAt });
      } catch (e) {
        osintJobs.set(jobId, { status: "error", error: `osint_error: ${(e as Error).message}`, startedAt });
      }
    })();
    return reply.send({ ok: true, jobId });
  });

  api.get<{ Params: { jobId: string } }>("/osint/:jobId", async (req, reply) => {
    const job = osintJobs.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    // Terminal jobs are kept (swept after 30 min) so a retry can re-read them.
    return reply.send({ ok: true, status: job.status, result: job.result, error: job.error, progress: job.progress });
  });

  // §7.2/§5-1 — instant recall of a known subject (read happens BEFORE any query).
  api.post("/subject/recall", async (req, reply) => {
    const parsed = IdentifiersSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    if (!isDbEnabled()) {
      return reply.send({ ok: true, enabled: false, known: false, subject: null, clusterSuggestions: [] });
    }
    return reply.send({ ok: true, enabled: true, ...recall(getDb(), parsed.data) });
  });

  // §7.3/§7.5 — record an assessment into the encrypted case history; returns the diff.
  api.post("/inquiry", async (req, reply) => {
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
  api.get("/stats", async (_req, reply) => {
    if (!isDbEnabled()) return reply.send({ ok: true, enabled: false });
    const { inquiries, subjects } = getStatsRows(getDb());
    return reply.send({ ok: true, enabled: true, stats: computeStats(inquiries, subjects) });
  });

  // §9 — age-encrypted export of the whole case DB (survives outside the Codespace).
  api.get("/export", async (_req, reply) => {
    if (!isDbEnabled()) return reply.code(503).send({ error: "db_disabled" });
    try {
      const data = await exportCaseArmored(getDb(), env.HHC_DB_KEY);
      const filename = `hhc-case-${new Date().toISOString().replace(/[:.]/g, "-")}.age`;
      return reply.send({ ok: true, filename, data });
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // §5-7 — AI-organized integrated report built on top of the deterministic facts.
  api.post("/report", async (req, reply) => {
    const Body = z.object({
      lang: z.enum(["ja", "en"]).default("ja"),
      assessment: z
        .object({
          generatedAt: z.string().default(() => new Date().toISOString()),
          subject: z
            .object({
              company: z.string().default(""),
              domain: z.string().default(""),
              person: z.string().default(""),
              title: z.string().default(""),
            })
            .default({ company: "", domain: "", person: "", title: "" }),
          score: z.number().default(0),
          band: z.enum(["low", "mid", "high"]).default("low"),
          bandSource: z.enum(["score", "override"]).default("score"),
          criticalFlags: z.array(z.string()).default([]),
          matchedIndicatorIds: z.array(z.string()).default([]),
          evidence: z
            .array(z.object({ source: z.string().default(""), url: z.string().optional(), summary: z.string().default("") }))
            .default([]),
          unavailableSources: z.array(z.string()).default([]),
          nationalityContext: z.string().optional(),
        })
        .passthrough(),
      watchlist_candidates: z.array(z.any()).optional(),
      tool_runs: z.array(z.any()).optional(),
      osint_notes: z.string().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", detail: parsed.error.message });
    if (isOffline()) return reply.code(503).send({ error: "offline" });
    if (!hasAnthropicKey()) return reply.code(503).send({ error: "no_api_key" });
    const out = await generateReport(parsed.data as unknown as ReportRequest, makeModelComplete());
    if (!out.ok) return reply.code(502).send({ error: out.error });
    return reply.send({ ok: true, report: out.report });
  });

  // §9 — import (merge) an age-encrypted export back in.
  api.post("/import", async (req, reply) => {
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
}

export interface BuildServerOpts {
  /** Inject a DB (e.g. openTestDb()) so auth tests don't need HHC_DB_KEY. */
  db?: DB;
}

export function buildServer(opts: BuildServerOpts = {}): FastifyInstance {
  // Screenshots / PDFs are base64 (≈ +33%) → allow a generous body limit.
  // trustProxy in served mode so req.ip reads the platform's X-Forwarded-For.
  const app = Fastify({ logger: false, bodyLimit: 60 * 1024 * 1024, trustProxy: isServeWeb() });
  const getDbHandle = (): DB => opts.db ?? getDb();

  void app.register(fastifyCookie, { secret: env.HHC_SESSION_SECRET || undefined });

  // Served mode: Fastify is the public edge — serve the built SPA + a fallback so
  // the client router's deep links resolve. The /api routes are handled below.
  if (isServeWeb()) {
    void app.register(fastifyStatic, { root: webDistDir(), prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.type("text/html").sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }

  void app.register(
    async (api) => {
      if (isAuthEnabled()) api.addHook("onRequest", makeAuthOnRequest(getDbHandle));
      registerFeatureRoutes(api);
      if (isAuthEnabled()) {
        registerAuthRoutes(api, getDbHandle);
        registerAdminRoutes(api, getDbHandle);
      }
    },
    { prefix: "/api" },
  );

  return app;
}

async function main() {
  assertAuthConfig(); // fail fast if HHC_AUTH=1 without HHC_DB_KEY / HHC_SESSION_SECRET
  if (isAuthEnabled()) bootstrapAdmin(getDb()); // create the first admin if none exists
  const app = buildServer();
  const host = isServeWeb() ? "0.0.0.0" : "127.0.0.1";
  try {
    await app.listen({ host, port: env.HHC_AGENT_PORT });
    console.log(
      `[hhc-agent] http://${host}:${env.HHC_AGENT_PORT}  model=${env.HHC_MODEL} offline=${isOffline()} key=${hasAnthropicKey()} caseDb=${isDbEnabled()} auth=${isAuthEnabled()} serveWeb=${isServeWeb()}`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
