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

  it("deterministically screens F sources even if the model calls no tools", async () => {
    const tools: OsintTool[] = [
      fakeTool("sanctions_opensanctions", async (input) =>
        ok("sanctions_opensanctions", {
          candidates: [
            {
              list: "us_ofac_sdn",
              matched_entity: "ACME SANCTIONED LLC",
              query: String(input.name ?? ""),
              score: 0.91,
              maps_to: "F1",
              pending_human_confirmation: false,
            },
          ],
        }),
      ),
      fakeTool("enduser_jp_meti", async () => unavailable("enduser_jp_meti"), false),
    ];
    // Model immediately returns final JSON without calling any tool.
    const call: LoopCaller = async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ subject_hint: {}, matched_indicators: [], notes_for_user: "" }) }],
    });
    const result = await runOsint({ company: "Acme Advisory", domain: "", person: "", title: "" }, tools, call);
    // The sanctions source was screened deterministically and its result is visible.
    expect(result.tool_runs.some((r) => r.tool === "sanctions_opensanctions")).toBe(true);
    expect(result.watchlist_candidates).toHaveLength(1);
    expect(result.unavailable_sources).toContain("enduser_jp_meti");
  });

  it("finalizes a PARTIAL result (deterministic screen still runs) when the model budget is exceeded", async () => {
    const tools: OsintTool[] = [
      fakeTool("sanctions_opensanctions", async (input) =>
        ok("sanctions_opensanctions", {
          candidates: [
            { list: "us_ofac_sdn", matched_entity: "ACME SANCTIONED LLC", query: String(input.name ?? ""), score: 0.9, maps_to: "F1", pending_human_confirmation: false },
          ],
        }),
      ),
    ];
    let modelCalled = false;
    const call: LoopCaller = async () => {
      modelCalled = true;
      return { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] };
    };
    const phases: string[] = [];
    const result = await runOsint({ company: "Acme Advisory", domain: "", person: "", title: "" }, tools, call, {
      budgetMs: -1, // force immediate truncation before any model call
      onProgress: (p) => phases.push(p.phase),
    });
    expect(modelCalled).toBe(false); // budget cut the loop before the model ran
    // …yet the deterministic screen completed and its candidate is present:
    expect(result.tool_runs.some((r) => r.tool === "sanctions_opensanctions")).toBe(true);
    expect(result.watchlist_candidates).toHaveLength(1);
    // partial note added, and progress was reported.
    expect(result.notes_for_user).toMatch(/Partial result|暫定結果/);
    expect(phases.length).toBeGreaterThan(0);
  });

  it("issues an identical (tool,args) call only once across the model loop and the screen (429 mitigation)", async () => {
    let calls = 0;
    const tools: OsintTool[] = [
      fakeTool("sanctions_opensanctions", async (input) => {
        calls += 1;
        return ok("sanctions_opensanctions", {
          candidates: [
            { list: "x", matched_entity: "X", query: String(input.name ?? ""), score: 0.9, maps_to: "F1", pending_human_confirmation: false },
          ],
        });
      }),
    ];
    // The model asks for the same sanctions call the deterministic screen will make.
    let step = 0;
    const call: LoopCaller = async () => {
      step += 1;
      if (step === 1) {
        return {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "sanctions_opensanctions", input: { name: "Acme Advisory" } }],
        };
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] };
    };
    await runOsint({ company: "Acme Advisory", domain: "", person: "", title: "" }, tools, call);
    expect(calls).toBe(1); // the per-run cache collapsed the duplicate into one request
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
