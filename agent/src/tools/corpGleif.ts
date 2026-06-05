import type { ToolRun } from "@hhc/shared";
import { fetchJson, ok, noMatch, unavailable, errored } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "corp_gleif";

interface LeiRecord {
  id?: string;
  attributes?: {
    entity?: {
      legalName?: { name?: string };
      legalAddress?: { country?: string };
      status?: string;
    };
    registration?: { status?: string };
  };
}

/**
 * GLEIF Legal Entity Identifier registry — check whether a company is a registered
 * legal entity worldwide (A5). Free, keyless, no signup (good replacement for
 * OpenCorporates, which no longer self-serves free tokens).
 */
export function makeCorpGleifTool(ctx: ToolContext): OsintTool {
  return {
    name: TOOL,
    description:
      "GLEIF Legal Entity Identifier registry — check whether a company is a registered legal entity worldwide, with its country and status (A5). Free, no API key.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "company name" } },
      required: ["name"],
    },
    available: !ctx.offline,
    unavailableReason: ctx.offline ? "HHC_OFFLINE=1" : undefined,
    async run(input): Promise<ToolRun> {
      if (ctx.offline) return unavailable(TOOL);
      const name = String(input.name ?? "").trim();
      if (!name) return errored(TOOL, "missing name");
      const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=5`;
      const res = await fetchJson(url, { headers: { accept: "application/vnd.api+json" } }, 9000);
      if (res.error) return errored(TOOL, res.error);
      if (!res.ok || typeof res.data !== "object" || res.data === null) {
        return errored(TOOL, `GLEIF HTTP ${res.status}`);
      }
      const records = (res.data as { data?: LeiRecord[] }).data ?? [];
      if (records.length === 0) {
        return noMatch(TOOL, { source_url: "https://search.gleif.org/", citation: `GLEIF "${name}"` });
      }
      const companies = records.slice(0, 5).map((r) => ({
        lei: r.id,
        name: r.attributes?.entity?.legalName?.name,
        country: r.attributes?.entity?.legalAddress?.country,
        status: r.attributes?.entity?.status ?? r.attributes?.registration?.status,
      }));
      return ok(TOOL, { count: records.length, companies }, { source_url: "https://search.gleif.org/", citation: `GLEIF "${name}"` });
    },
  };
}
