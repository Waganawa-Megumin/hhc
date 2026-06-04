import type { ToolRun } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "corp_global";

interface OcCompany {
  company?: { name?: string; jurisdiction_code?: string; company_number?: string; opencorporates_url?: string };
}

/** OpenCorporates — non-JP company existence (A5). Requires an API token. */
export function makeCorpGlobalTool(ctx: ToolContext): OsintTool {
  const available = !ctx.offline && ctx.openCorporatesToken.trim().length > 0;
  return {
    name: TOOL,
    description:
      "OpenCorporates company search — check whether a non-Japanese company actually exists and its jurisdiction (A5). Requires an API token.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "company name" } },
      required: ["name"],
    },
    available,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : !available ? "set HHC_OPENCORPORATES_TOKEN" : undefined,
    async run(input): Promise<ToolRun> {
      if (!available) return unavailable(TOOL, this.unavailableReason);
      const name = String(input.name ?? "").trim();
      if (!name) return errored(TOOL, "missing name");
      const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(name)}&api_token=${encodeURIComponent(ctx.openCorporatesToken)}`;
      const res = await fetchJson(url, {}, 9000);
      if (res.error) return errored(TOOL, res.error);
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        return unavailable(TOOL, `OpenCorporates HTTP ${res.status}`);
      }
      const companies = (res.data as { results?: { companies?: OcCompany[] } }).results?.companies ?? [];
      if (companies.length === 0) return noMatch(TOOL, { source_url: "https://opencorporates.com/", citation: "OpenCorporates" });
      const sample = companies.slice(0, 5).map((c) => ({
        name: c.company?.name,
        jurisdiction: c.company?.jurisdiction_code,
        number: c.company?.company_number,
        url: c.company?.opencorporates_url,
      }));
      return ok(TOOL, { count: companies.length, companies: sample }, { source_url: "https://opencorporates.com/", citation: "OpenCorporates" });
    },
  };
}
