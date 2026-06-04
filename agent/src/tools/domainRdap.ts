import type { ToolRun } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "domain_rdap";

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

export function makeDomainRdapTool(ctx: ToolContext): OsintTool {
  return {
    name: TOOL,
    description:
      "Look up a domain's registration age, registrar and country via RDAP (rdap.org, RFC 9224 JSON). Maps to indicator A2 (newly registered domain). No legacy WHOIS scraping. No key required.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "registrable domain, e.g. example.com" } },
      required: ["domain"],
    },
    available: !ctx.offline,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : undefined,
    async run(input): Promise<ToolRun> {
      if (ctx.offline) return unavailable(TOOL);
      const domain = String(input.domain ?? "").trim().toLowerCase();
      if (!domain) return errored(TOOL, "missing domain");
      const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
      const res = await fetchJson(url, {}, 8000);
      if (res.status === 404) return noMatch(TOOL, { source_url: url, citation: "RDAP: no record" });
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        return res.error ? errored(TOOL, res.error) : unavailable(TOOL, `RDAP HTTP ${res.status}`);
      }
      const obj = res.data as { events?: RdapEvent[]; ldhName?: string };
      const events = obj.events ?? [];
      const registration = events.find((e) => e.eventAction === "registration")?.eventDate;
      let ageDays: number | null = null;
      if (registration) {
        const ms = Date.now() - new Date(registration).getTime();
        ageDays = Math.floor(ms / 86_400_000);
      }
      return ok(
        TOOL,
        { domain: obj.ldhName ?? domain, registeredAt: registration ?? null, ageDays },
        { source_url: url, citation: `RDAP ${domain}` },
      );
    },
  };
}
