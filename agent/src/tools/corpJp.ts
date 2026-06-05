import type { ToolRun } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "corp_jp";

/** Japan NTA corporate-number Web-API (法人番号システム). Primary JP corporate existence check (A5). */
export function makeCorpJpTool(ctx: ToolContext): OsintTool {
  const available = !ctx.offline && ctx.houjinAppId.trim().length > 0;
  return {
    name: TOOL,
    description:
      "Japan NTA corporate-number system (法人番号 Web-API) — primary check that a claimed Japanese company actually exists (A5). Requires a free NTA application ID.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Japanese company name" } },
      required: ["name"],
    },
    available,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : !available ? "set HHC_HOUJIN_APP_ID (free, ~1mo lead)" : undefined,
    async run(input): Promise<ToolRun> {
      if (!available) return unavailable(TOOL, this.unavailableReason);
      const name = String(input.name ?? "").trim();
      if (!name) return errored(TOOL, "missing name");
      // type=12 → CSV (Shift_JIS); we surface a snippet for the model/human, plus existence.
      const url =
        `https://api.houjin-bangou.nta.go.jp/4/name?id=${encodeURIComponent(ctx.houjinAppId)}` +
        `&name=${encodeURIComponent(name)}&type=12&mode=2`;
      const res = await fetchJson(url, {}, 9000);
      if (res.error) return errored(TOOL, res.error);
      if (!res.ok) return errored(TOOL, `NTA HTTP ${res.status}`);
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      // First CSV line is a count header; >1 line implies at least one match.
      const matched = lines.length > 1;
      if (!matched) return noMatch(TOOL, { source_url: url, citation: "NTA 法人番号" });
      return ok(TOOL, { format: "csv", matchedLines: lines.length - 1, sample: text.slice(0, 1500) }, { source_url: url, citation: "NTA 法人番号" });
    },
  };
}
