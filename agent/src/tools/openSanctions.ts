import type { ToolRun, WatchlistCandidate } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored, type FetchResult } from "./http";
import { makeCandidate } from "./watchlist";
import type { OsintTool, ToolContext } from "./types";

const HOSTED_DEFAULT = "https://api.opensanctions.org";

// OpenSanctions' 429 is primarily a MONTHLY QUOTA (per their FAQ: rejected until the
// next calendar month), not just a burst limit — so the real fix is using FEWER
// calls (the run-level cache de-duplicates, and the model no longer re-calls these
// tools). Both datasets (default + jp_meti_eul) share one host, so we still serialize
// with light spacing and retry ONCE (covers a transient burst; a quota 429 won't
// recover, so we don't waste time hammering it).
const OS_SPACING_MS = 300;
let osQueue: Promise<unknown> = Promise.resolve();
let osLastAt = 0;
function osThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const task = async (): Promise<T> => {
    const gap = OS_SPACING_MS - (Date.now() - osLastAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    try {
      return await fn();
    } finally {
      osLastAt = Date.now();
    }
  };
  const next = osQueue.then(task, task);
  osQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function fetchOpenSanctions(url: string, init: RequestInit): Promise<FetchResult> {
  const first = await osThrottle(() => fetchJson(url, init, 12_000));
  if (first.status !== 429) return first;
  await new Promise((r) => setTimeout(r, 1200)); // one cheap retry for a transient burst
  return osThrottle(() => fetchJson(url, init, 12_000));
}

interface OsResult {
  caption?: string;
  schema?: string;
  score?: number;
  datasets?: string[];
  properties?: { topics?: string[] };
}

/**
 * OpenSanctions /match factory. Covers consolidated sanctions/PEP (dataset
 * "default") and the Japan METI End-User List (dataset "jp_meti_eul"), plus the
 * affiliated-entity matching the plan calls for (pass a company/institution name).
 */
export function makeOpenSanctionsTool(
  ctx: ToolContext,
  opts: { name: string; dataset: string; description: string },
): OsintTool {
  const base = ctx.openSanctionsBaseUrl || HOSTED_DEFAULT;
  const isSelfHost = base.replace(/\/$/, "") !== HOSTED_DEFAULT;
  const hasAuth = ctx.openSanctionsApiKey.trim().length > 0 || isSelfHost;
  const available = !ctx.offline && hasAuth;

  return {
    name: opts.name,
    description: opts.description,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "person, company, or affiliated institution name" },
        schema: { type: "string", description: "Person | Company | LegalEntity (default LegalEntity)" },
      },
      required: ["name"],
    },
    available,
    unavailableReason: ctx.offline
      ? "HHC_OFFLINE=1"
      : !hasAuth
        ? "set HHC_OPENSANCTIONS_API_KEY or self-host yente"
        : undefined,
    async run(input): Promise<ToolRun> {
      if (!available) return unavailable(opts.name, this.unavailableReason);
      const name = String(input.name ?? "").trim();
      if (!name) return errored(opts.name, "missing name");
      const schema = String(input.schema ?? "LegalEntity");

      const url = `${base.replace(/\/$/, "")}/match/${encodeURIComponent(opts.dataset)}`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      // OpenSanctions hosted API: standard header auth (also send the query param for compat).
      const authedUrl = ctx.openSanctionsApiKey
        ? `${url}?api_key=${encodeURIComponent(ctx.openSanctionsApiKey)}`
        : url;
      if (ctx.openSanctionsApiKey) headers["Authorization"] = `ApiKey ${ctx.openSanctionsApiKey}`;
      const res = await fetchOpenSanctions(authedUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ queries: { q1: { schema, properties: { name: [name] } } } }),
      });
      if (res.error) return errored(opts.name, res.error);
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        // Configured but the request failed. This is an ERROR, not "unavailable":
        // the source WAS queried and failed (distinct from not-configured / no-match).
        if (res.status === 429) {
          return errored(
            opts.name,
            "OpenSanctions HTTP 429 — 月間クォータ超過の可能性（翌月にリセット／コンソールでクォータ引き上げ可）。呼び出しは重複排除済み。 / monthly quota likely exhausted (resets next month; raise it in the console). Calls are de-duplicated to conserve quota.",
          );
        }
        return errored(opts.name, `OpenSanctions HTTP ${res.status}`);
      }
      const results =
        ((res.data as { responses?: { q1?: { results?: OsResult[] } } }).responses?.q1?.results ?? []);
      if (results.length === 0) {
        return noMatch(opts.name, { source_url: HOSTED_DEFAULT, citation: `OpenSanctions/${opts.dataset}` });
      }
      const candidates: WatchlistCandidate[] = results.slice(0, 8).map((r) =>
        makeCandidate(
          (r.datasets ?? [opts.dataset]).join(","),
          r.caption ?? "(unnamed)",
          name,
          typeof r.score === "number" ? r.score : 0,
          r.properties?.topics ?? [],
          "https://www.opensanctions.org/",
        ),
      );
      return ok(
        opts.name,
        { candidates },
        { source_url: "https://www.opensanctions.org/", citation: `OpenSanctions/${opts.dataset}` },
      );
    },
  };
}
