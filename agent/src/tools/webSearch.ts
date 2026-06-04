import type { ToolRun } from "@hhc/shared";
import { unavailable } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "web_search";

/**
 * Web entity/claims check (A1, A3, B3). Backed by Anthropic's server-side web
 * search, injected via ctx.webSearch (absent → unavailable). Public/lawful pages
 * only; never login-gated, never LinkedIn scraping.
 */
export function makeWebSearchTool(ctx: ToolContext): OsintTool {
  return {
    name: TOOL,
    description:
      "Search the public web to corroborate a company/person/claim (official site, news, job posts). Maps to A1/A3/B3. Public, lawful pages only — never login-gated content and never LinkedIn scraping.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "search query" } },
      required: ["query"],
    },
    available: !!ctx.webSearch,
    unavailableReason: ctx.webSearch ? undefined : "no Anthropic key / offline",
    async run(input): Promise<ToolRun> {
      if (!ctx.webSearch) return unavailable(TOOL, this.unavailableReason);
      const query = String(input.query ?? "").trim();
      if (!query) return unavailable(TOOL, "missing query");
      return ctx.webSearch(query);
    },
  };
}
