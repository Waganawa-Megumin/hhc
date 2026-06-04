import type { ToolRun, WatchlistCandidate } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import { makeCandidate } from "./watchlist";
import type { OsintTool, ToolContext } from "./types";

const HOSTED_DEFAULT = "https://api.opensanctions.org";

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
      const res = await fetchJson(
        authedUrl,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ queries: { q1: { schema, properties: { name: [name] } } } }),
        },
        9000,
      );
      if (res.error) return errored(opts.name, res.error);
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        return unavailable(opts.name, `OpenSanctions HTTP ${res.status}`);
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
