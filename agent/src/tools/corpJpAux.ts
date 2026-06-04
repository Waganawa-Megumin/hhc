import type { ToolRun } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "corp_jp_aux";

/** gBizINFO — auxiliary JP corporate activity info (A5). Freshness is low (deprecating); primary is corp_jp. */
export function makeCorpJpAuxTool(ctx: ToolContext): OsintTool {
  const available = !ctx.offline && ctx.gbizToken.trim().length > 0;
  return {
    name: TOOL,
    description:
      "gBizINFO — auxiliary Japanese corporate activity data (A5). Lower freshness (the service is deprecating); corroboration only, primary existence is corp_jp.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Japanese company name" } },
      required: ["name"],
    },
    available,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : !available ? "set HHC_GBIZ_INFO_API_KEY" : undefined,
    async run(input): Promise<ToolRun> {
      if (!available) return unavailable(TOOL, this.unavailableReason);
      const name = String(input.name ?? "").trim();
      if (!name) return errored(TOOL, "missing name");
      const url = `https://info.gbiz.go.jp/hojin/v1/hojin?name=${encodeURIComponent(name)}&limit=5`;
      const res = await fetchJson(url, { headers: { "X-hojinInfo-api-token": ctx.gbizToken } }, 9000);
      if (res.error) return errored(TOOL, res.error);
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        return unavailable(TOOL, `gBizINFO HTTP ${res.status}`);
      }
      const infos = (res.data as { "hojin-infos"?: unknown[] })["hojin-infos"] ?? [];
      if (infos.length === 0) return noMatch(TOOL, { source_url: url, citation: "gBizINFO" });
      return ok(TOOL, { count: infos.length, infos: infos.slice(0, 5) }, { source_url: url, citation: "gBizINFO" });
    },
  };
}
