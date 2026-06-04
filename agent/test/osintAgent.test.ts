import { describe, it, expect } from "vitest";
import { runOsint, finalizeOsint, type LoopCaller } from "../src/anthropic/osintAgent";
import type { OsintTool } from "../src/tools/types";
import { ok, unavailable } from "../src/tools/http";
import type { SubjectHint, WatchlistCandidate } from "@hhc/shared";

const hint: SubjectHint = { company: "Acme Advisory", domain: "acme.example", person: "", title: "" };

function fakeTool(name: string, run: OsintTool["run"], available = true): OsintTool {
  return { name, description: name, inputSchema: { type: "object", properties: {} }, available, run };
}

describe("§7 OSINT loop", () => {
  it("runs tools the model calls, then synthesizes deterministic results", async () => {
    const candidate: WatchlistCandidate = {
      list: "us_ofac_sdn",
      matched_entity: "ACME SANCTIONED LLC",
      query: "Acme Advisory",
      score: 0.92,
      maps_to: "F1",
      pending_human_confirmation: false, // tool says false; finalize must force true
      source_url: "https://www.opensanctions.org/",
    };
    const tools: OsintTool[] = [
      fakeTool("sanctions_opensanctions", async () => ok("sanctions_opensanctions", { candidates: [candidate] })),
      fakeTool("corp_jp", async () => unavailable("corp_jp"), false),
    ];

    // Script: step 1 calls the sanctions tool; step 2 returns final JSON.
    let step = 0;
    const call: LoopCaller = async () => {
      step += 1;
      if (step === 1) {
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Checking sanctions." },
            { type: "tool_use", id: "tu_1", name: "sanctions_opensanctions", input: { name: "Acme Advisory" } },
          ],
        };
      }
      return {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              subject_hint: { company: "Acme Advisory", domain: "acme.example", person: "", title: "" },
              matched_indicators: [
                { id: "A1", confidence: "medium", rationale: "thin web presence" },
                { id: "E1", confidence: "high", rationale: "should be dropped (coefficient)" },
                { id: "ZZ", confidence: "low", rationale: "unknown id dropped" },
              ],
              evidence: [{ source: "rdap", url: "https://rdap.org/", summary: "new domain" }],
              notes_for_user: "They might be a spy.",
            }),
          },
        ],
      };
    };

    const result = await runOsint(hint, tools, call, { maxSteps: 5 });

    // Tool runs recorded; unavailable source surfaced.
    expect(result.tool_runs.map((r) => r.tool)).toContain("sanctions_opensanctions");
    expect(result.unavailable_sources).toContain("corp_jp");

    // Watchlist candidate taken from tool data, forced pending_human_confirmation.
    expect(result.watchlist_candidates).toHaveLength(1);
    expect(result.watchlist_candidates[0]?.pending_human_confirmation).toBe(true);
    expect(result.watchlist_candidates[0]?.maps_to).toBe("F1");

    // matched_indicators filtered to known, tickable ids; "spy" scrubbed.
    expect(result.matched_indicators.map((m) => m.id)).toEqual(["A1"]);
    expect(JSON.stringify(result)).not.toMatch(/\bspy\b/i);
  });

  it("finalizeOsint never lets the model inject watchlist candidates (deterministic from tools)", () => {
    const out = finalizeOsint(
      hint,
      JSON.stringify({
        subject_hint: {},
        matched_indicators: [],
        watchlist_candidates: [
          { list: "fake", matched_entity: "x", query: "y", maps_to: "F1", pending_human_confirmation: false },
        ],
        evidence: [],
        notes_for_user: "",
      }),
      [], // no tool runs → no real candidates
    );
    expect(out.watchlist_candidates).toEqual([]);
  });

  it("degrades gracefully when the model's final output is not JSON", () => {
    const out = finalizeOsint(hint, "I could not complete the research.", [unavailable("corp_jp")]);
    expect(out.matched_indicators).toEqual([]);
    expect(out.unavailable_sources).toContain("corp_jp");
    expect(out.subject_hint.company).toBe("Acme Advisory");
  });
});
