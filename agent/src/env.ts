// Environment loading + validation. Uses Node 22's built-in env-file loader so we
// keep zero runtime deps for config. The .env lives at the repo root and is never
// committed (.gitignore).
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url)); // agent/src
for (const candidate of [resolve(process.cwd(), ".env"), resolve(here, "../../.env")]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore malformed/locked .env — env vars may be provided by the shell instead
    }
    break;
  }
}

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(""),
  // Accepted alias for the Anthropic key (e.g. a Codespaces secret named HHC_KEY).
  HHC_KEY: z.string().default(""),
  HHC_MODEL: z.string().default("claude-sonnet-4-6"),
  HHC_AGENT_PORT: z.coerce.number().int().positive().default(8787),
  HHC_OFFLINE: z.string().default("0"),
  HHC_DB_KEY: z.string().default(""),
  // Optional OSINT source credentials (Phase C). Absent → that tool degrades.
  HHC_HOUJIN_APP_ID: z.string().default(""),
  HHC_GBIZ_INFO_API_KEY: z.string().default(""),
  HHC_OPENCORPORATES_TOKEN: z.string().default(""),
  HHC_OPENSANCTIONS_API_KEY: z.string().default(""),
  HHC_OPENSANCTIONS_BASE_URL: z.string().default("https://api.opensanctions.org"),
  HHC_TRADEGOV_API_KEY: z.string().default(""),
  // ── Auth / accounts (Phase 1). When HHC_AUTH=1 the whole app requires login and
  //    HHC_DB_KEY + HHC_SESSION_SECRET become mandatory (enforced below). ──
  HHC_AUTH: z.string().default("0"),
  // Serve the built web SPA + API from Fastify on 0.0.0.0 (public edge) with
  // trustProxy, so the real client IP is visible. Off = today's dev topology.
  HHC_SERVE_WEB: z.string().default("0"),
  HHC_SESSION_SECRET: z.string().default(""),
  HHC_SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  HHC_SESSION_IDLE_MIN: z.coerce.number().positive().default(60),
  HHC_LOGIN_MAX_FAILS: z.coerce.number().int().positive().default(5),
  HHC_LOGIN_WINDOW_MIN: z.coerce.number().positive().default(15),
  HHC_ADMIN_EMAIL: z.string().default(""),
  HHC_ADMIN_INITIAL_PASSWORD: z.string().default(""),
  // Public base URL of the app (e.g. https://hhc.example.com). Used to build
  // invitation links in EMAILS. If unset, the link is derived from the request host
  // (which is wrong behind a dev proxy); the admin UI builds its link from the
  // browser origin regardless.
  HHC_APP_URL: z.string().default(""),
  // Email-MFA transport (optional; unset → email MFA is a graceful no-op).
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().default("0"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  // Geolocation for audit (Phase 2). Keyless; degrades gracefully.
  HHC_GEO_ENABLED: z.string().default("1"),
  HHC_GEO_BASE_URL: z.string().default("http://ip-api.com/json"),
  // Audit retention: delete audit rows older than N days (0 = keep forever). Default 30.
  HHC_AUDIT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),
  // Optional SIEM forwarding of each audit event (Splunk HEC or a generic JSON webhook).
  HHC_SIEM_URL: z.string().default(""),
  HHC_SIEM_TOKEN: z.string().default(""),
  HHC_SIEM_FORMAT: z.string().default("splunk"), // "splunk" (HEC) | "json"
});

export const env = EnvSchema.parse(process.env);

export const isOffline = (): boolean => env.HHC_OFFLINE === "1";

/** Whether accounts/auth/authz are enforced (and the app is login-gated).
 * Read from process.env live so tests can toggle it per-file. */
export const isAuthEnabled = (): boolean => (process.env.HHC_AUTH ?? env.HHC_AUTH) === "1";
/** Whether Fastify serves the built SPA itself (public edge with trustProxy). */
export const isServeWeb = (): boolean => (process.env.HHC_SERVE_WEB ?? env.HHC_SERVE_WEB) === "1";

/**
 * Fail fast on a misconfigured auth deployment: when auth is on, the encrypted DB
 * (credential store) and a session secret are mandatory. Called at server startup.
 */
export function assertAuthConfig(): void {
  if (!isAuthEnabled()) return;
  const missing: string[] = [];
  if (env.HHC_DB_KEY.trim().length === 0) missing.push("HHC_DB_KEY");
  if (env.HHC_SESSION_SECRET.trim().length === 0) missing.push("HHC_SESSION_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `auth_misconfigured: HHC_AUTH=1 requires ${missing.join(", ")} (credentials live in the encrypted DB).`,
    );
  }
}

/** Resolve the Anthropic key, accepting HHC_KEY as an alias of ANTHROPIC_API_KEY. */
export const anthropicApiKey = (): string => env.ANTHROPIC_API_KEY.trim() || env.HHC_KEY.trim();
export const hasAnthropicKey = (): boolean => anthropicApiKey().length > 0;
