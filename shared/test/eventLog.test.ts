import { describe, it, expect } from "vitest";
import {
  explainMatch,
  rateName,
  buildEventLog,
  scoreApproach,
  type EventLogInput,
} from "../src";

describe("matchExplain", () => {
  it("flags a fuzzy-only hit (ARK Co.,Ltd. vs ARGO I) with no strong overlap", () => {
    const ex = explainMatch("ARK Co.,Ltd.", "ARGO I");
    expect(ex.fuzzyOnly).toBe(true);
    expect(ex.strong).toHaveLength(0);
  });

  it("recognizes an exact name overlap as strong (not fuzzy-only)", () => {
    const ex = explainMatch("Laila Cheng", "Laila Cheng");
    expect(ex.fuzzyOnly).toBe(false);
    expect(ex.strong).toEqual(expect.arrayContaining(["laila", "cheng"]));
  });

  it("ignores generic corporate stopwords as overlap", () => {
    const ex = explainMatch("Acme Company Limited", "Globex Company Limited");
    expect(ex.fuzzyOnly).toBe(true);
    expect(ex.strong).toHaveLength(0);
  });

  it("rateName maps a normalized 0–1 score to a band label", () => {
    expect(rateName(0.95)).toBe("high");
    expect(rateName(0.8)).toBe("mid");
    expect(rateName(0.5)).toBe("low");
  });
});

function makeInput(): EventLogInput {
  return {
    generatedAt: "2026-06-05T00:00:00.000Z",
    subject: { company: "ARK Co.,Ltd.", domain: "ark.example", person: "Laila Cheng", title: "Recruiter" },
    result: scoreApproach({ selected: ["B3", "B4", "F2"], coefficients: { E1: false, E2: false }, humanConfirmedF1: false }),
    coefficients: { E1: false, E2: false },
    humanConfirmedF1: false,
    suggestions: { B3: { id: "B3", confidence: "high", rationale: "claimed degree is unverifiable" } },
    selectedIds: ["B3", "B4", "F2"],
    osint: {
      subject_hint: { company: "ARK Co.,Ltd.", domain: "", person: "", title: "" },
      matched_indicators: [],
      watchlist_candidates: [
        { list: "SDN", matched_entity: "ARGO I", query: "ARK Co.,Ltd.", score: 0.8, maps_to: "F1", pending_human_confirmation: true },
      ],
      evidence: [],
      tool_runs: [
        { tool: "screening_us_csl", status: "ok", available: true, citation: "Trade.gov CSL", data: { candidates: [{}] } },
        { tool: "sanctions_opensanctions", status: "unavailable", available: false, note: "set HHC_OPENSANCTIONS_API_KEY" },
      ],
      unavailable_sources: ["sanctions_opensanctions"],
      notes_for_user: "treat as a スパイ", // must be scrubbed
    },
  };
}

describe("buildEventLog", () => {
  it("emits the why / where / how sections", () => {
    const log = buildEventLog(makeInput(), "ja");
    expect(log).toContain("[SCORE BREAKDOWN]");
    expect(log).toContain("[OSINT TOOL RUNS]");
    expect(log).toContain("[WATCHLIST CANDIDATES]");
  });

  it("labels a fuzzy-only watchlist hit and shows no meaningful token overlap", () => {
    const log = buildEventLog(makeInput(), "ja");
    expect(log).toContain("match=fuzzy");
    expect(log).toContain("matched_tokens=none");
  });

  it("scrubs forbidden accusatory labels from model text", () => {
    const log = buildEventLog(makeInput(), "en");
    expect(log).not.toMatch(/スパイ/);
    expect(log).toContain("redacted-label");
  });

  it("records the verdict and surfaces unavailable sources", () => {
    const log = buildEventLog(makeInput(), "en");
    expect(log).toMatch(/band=(low|mid|high)/);
    expect(log).toContain("[UNAVAILABLE SOURCES]");
    expect(log).toContain("sanctions_opensanctions");
  });
});
