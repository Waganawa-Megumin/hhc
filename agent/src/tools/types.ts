import type { ToolRun, WatchlistCandidate } from "@hhc/shared";

/** JSON-schema fragment for an Anthropic tool's input. */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface OsintTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** False when a required credential is missing or HHC_OFFLINE=1; run() still returns a clean envelope. */
  available: boolean;
  unavailableReason?: string;
  run(input: Record<string, unknown>): Promise<ToolRun>;
}

/** Config + injected capabilities shared by all tools. */
export interface ToolContext {
  offline: boolean;
  houjinAppId: string;
  gbizToken: string;
  openCorporatesToken: string;
  openSanctionsBaseUrl: string;
  openSanctionsApiKey: string;
  tradeGovKey: string;
  /** Anthropic-backed web search; absent when no key / offline. */
  webSearch?: (query: string) => Promise<ToolRun>;
}

/** Tools attach structured watchlist candidates here so F-logic stays deterministic. */
export interface WatchlistData {
  candidates: WatchlistCandidate[];
}
