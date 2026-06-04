import Fastify from "fastify";
import { z } from "zod";
import { env, hasAnthropicKey, isOffline } from "./env";
import { interpret, type InterpretRequest } from "./anthropic/interpret";
import { makeModelComplete } from "./anthropic/client";

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

  return app;
}

async function main() {
  const app = buildServer();
  try {
    await app.listen({ host: "127.0.0.1", port: env.HHC_AGENT_PORT });
    console.log(
      `[hhc-agent] http://127.0.0.1:${env.HHC_AGENT_PORT}  model=${env.HHC_MODEL} offline=${isOffline()} key=${hasAnthropicKey()}`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
