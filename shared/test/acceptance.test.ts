// Maps to the design spec's §11 acceptance criteria (the programmatically checkable
// ones) plus false-positive calibration on realistic legitimate recruiters.
import { describe, it, expect } from "vitest";
import { scoreApproach, type ScoreInput } from "../src/scoring";
import { buildReportDraft, type AssessmentSummary } from "../src/reportDraft";
import { containsForbiddenLabel } from "../src/guardrails";

const input = (selected: string[], extra: Partial<ScoreInput> = {}): ScoreInput => ({
  selected,
  coefficients: { E1: false, E2: false },
  humanConfirmedF1: false,
  ...extra,
});

describe("§11 — critical-flag override beats score and AI", () => {
  it("D3 alone, C2+D1, and human-confirmed F1 each force high", () => {
    expect(scoreApproach(input(["D3"])).band).toBe("high");
    expect(scoreApproach(input(["C2", "D1"])).band).toBe("high");
    expect(scoreApproach(input(["A2"], { humanConfirmedF1: true })).band).toBe("high");
  });
});

describe("§11 — 'no evidence ≠ innocence': list non-presence never lowers the score", () => {
  it("adding an unmatched/flag-only F3 never reduces the score", () => {
    const without = scoreApproach(input(["A1", "C2"]));
    const withF3 = scoreApproach(input(["A1", "C2", "F3"]));
    expect(withF3.rawScore).toBe(without.rawScore); // F3 weight 0, never negative
  });
  it("an unconfirmed F1 candidate does not lower or raise the score", () => {
    const base = scoreApproach(input(["A1", "A4"]));
    const withCandidate = scoreApproach(input(["A1", "A4", "F1"]));
    expect(withCandidate.rawScore).toBe(base.rawScore);
  });
});

describe("§11 — false-positive calibration (legitimate recruiters stay low/mid)", () => {
  const legitScenarios: Array<{ name: string; selected: string[]; coeff?: Partial<ScoreInput["coefficients"]> }> = [
    { name: "ordinary recruiter, newish boutique domain", selected: ["A2"] },
    { name: "keen recruiter: pay a bit high, moves fast", selected: ["A4", "C3"] },
    { name: "sloppy but benign: thin site, typos, few connections", selected: ["A1", "A3", "B2"] },
    { name: "benign approach to a high-value target", selected: ["A1", "B4"], coeff: { E1: true, E2: true } },
  ];

  for (const s of legitScenarios) {
    it(`does not over-flag: ${s.name}`, () => {
      const r = scoreApproach(input(s.selected, { coefficients: { E1: false, E2: false, ...s.coeff } }));
      expect(r.band).not.toBe("high");
      expect(r.criticalFlags).toEqual([]);
    });
  }

  it("but a real solicitation (C2+D1) on the same target IS high", () => {
    expect(scoreApproach(input(["A1", "C2", "D1"], { coefficients: { E1: true, E2: false } })).band).toBe("high");
  });
});

describe("§11 — report draft is non-accusatory and demographic-free", () => {
  const assessment: AssessmentSummary = {
    generatedAt: "2026-06-04T00:00:00Z",
    subject: { company: "Apex Advisory", domain: "apex.example", person: "", title: "consultant" },
    score: 13,
    band: "high",
    bandSource: "override",
    criticalFlags: ["C2+D1"],
    matchedIndicatorIds: ["A1", "C2", "D1"],
    evidence: [{ source: "rdap", url: "https://rdap.org/", summary: "domain registered 3 weeks ago" }],
    unavailableSources: ["corp_jp"],
    nationalityContext: "",
  };

  for (const lang of ["ja", "en"] as const) {
    it(`(${lang}) includes the action + disclaimer, never says 'spy', states nationality unused`, () => {
      const { body } = buildReportDraft(assessment, lang);
      expect(containsForbiddenLabel(body)).toBe(false);
      expect(body).toMatch(lang === "ja" ? /国籍・民族は判定に使用していません/ : /Nationality\/ethnicity were not used/);
      expect(body).toMatch(lang === "ja" ? /推奨アクション/ : /Recommended action/);
      expect(body).toContain("A1");
      expect(body).toMatch(/absence ≠ innocence|証拠なし＝無実ではない/);
    });
  }
});
