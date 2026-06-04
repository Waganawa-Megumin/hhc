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
});

export const env = EnvSchema.parse(process.env);

export const isOffline = (): boolean => env.HHC_OFFLINE === "1";
export const hasAnthropicKey = (): boolean => env.ANTHROPIC_API_KEY.trim().length > 0;
