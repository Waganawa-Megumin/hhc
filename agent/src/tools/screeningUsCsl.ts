import type { ToolRun, WatchlistCandidate } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import { makeCandidate } from "./watchlist";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "screening_us_csl";

interface CslResult {
  name?: string;
  source?: string;
  score?: number;
  source_list_url?: string;
}

export function makeScreeningUsCslTool(ctx: ToolContext): OsintTool {
  const available = !ctx.offline && ctx.tradeGovKey.trim().length > 0;
  return {
    name: TOOL,
    description:
      "US Trade.gov Consolidated Screening List (BIS Entity/Unverified/MEU, OFAC SDN, etc.) fuzzy name search. Maps to F1 (export-control / sanctions). Requires a free ITA subscription key.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "person/company/institution name" } },
      required: ["name"],
    },
    available,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : !available ? "set HHC_TRADEGOV_API_KEY" : undefined,
    async run(input): Promise<ToolRun> {
      if (!available) return unavailable(TOOL, this.unavailableReason);
      const name = String(input.name ?? "").trim();
      if (!name) return errored(TOOL, "missing name");
      const url = `https://data.trade.gov/consolidated_screening_list/v1/search?name=${encodeURIComponent(name)}&fuzzy_name=true`;
      const res = await fetchJson(url, { headers: { "subscription-key": ctx.tradeGovKey } }, 9000);
      if (res.error) return errored(TOOL, res.error);
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        return unavailable(TOOL, `Trade.gov HTTP ${res.status}`);
      }
      const results = (res.data as { results?: CslResult[] }).results ?? [];
      if (results.length === 0) {
        return noMatch(TOOL, { source_url: "https://www.trade.gov/consolidated-screening-list", citation: "Trade.gov CSL" });
      }
      // Trade.gov CSL returns `score` on a 0–100 scale (unlike OpenSanctions' 0–1);
      // makeCandidate → normalizeScore folds both onto 0–1 so % display and the
      // F-mapping stay correct (this is what fixed the "8000%" render).
      const candidates: WatchlistCandidate[] = results.slice(0, 8).map((r) =>
        makeCandidate(
          r.source ?? "CSL",
          r.name ?? "(unnamed)",
          name,
          typeof r.score === "number" ? r.score : 80,
          ["sanction", "export-control"],
          r.source_list_url ?? "https://www.trade.gov/consolidated-screening-list",
        ),
      );
      return ok(TOOL, { candidates }, { source_url: "https://www.trade.gov/consolidated-screening-list", citation: "Trade.gov CSL" });
    },
  };
}
