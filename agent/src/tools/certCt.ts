import type { ToolRun } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "cert_ct";

interface CrtEntry {
  not_before?: string;
  name_value?: string;
}

export function makeCertCtTool(ctx: ToolContext): OsintTool {
  return {
    name: TOOL,
    description:
      "Query Certificate Transparency logs (crt.sh) for a domain's certificate history and subdomains — corroborating evidence for A2 (recency). No key required; corroboration only.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "registrable domain" } },
      required: ["domain"],
    },
    available: !ctx.offline,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : undefined,
    async run(input): Promise<ToolRun> {
      if (ctx.offline) return unavailable(TOOL);
      const domain = String(input.domain ?? "").trim().toLowerCase();
      if (!domain) return errored(TOOL, "missing domain");
      const url = `https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json&exclude=expired`;
      const res = await fetchJson(url, {}, 9000);
      if (res.error) return errored(TOOL, res.error);
      if (!Array.isArray(res.data)) {
        return res.data ? noMatch(TOOL, { source_url: url }) : unavailable(TOOL, `crt.sh HTTP ${res.status}`);
      }
      const entries = res.data as CrtEntry[];
      if (entries.length === 0) return noMatch(TOOL, { source_url: url, citation: "crt.sh: no certs" });
      const dates = entries.map((e) => e.not_before).filter((d): d is string => !!d).sort();
      const subdomains = [...new Set(entries.flatMap((e) => (e.name_value ?? "").split("\n")))].slice(0, 50);
      return ok(
        TOOL,
        { certCount: entries.length, earliestNotBefore: dates[0] ?? null, subdomainSample: subdomains },
        { source_url: url, citation: `crt.sh ${domain}` },
      );
    },
  };
}
