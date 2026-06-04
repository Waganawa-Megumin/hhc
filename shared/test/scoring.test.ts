import { describe, it, expect } from "vitest";
import { scoreApproach, type ScoreInput } from "../src/scoring";
import { fixtures } from "./fixtures/cases";

function input(partial: Partial<ScoreInput> & { selected: string[] }): ScoreInput {
  return { coefficients: { E1: false, E2: false }, humanConfirmedF1: false, ...partial };
}

describe("scoreApproach — pinned numeric cases", () => {
  it("[A2,B2] → 4, low, by score", () => {
    const r = scoreApproach(input({ selected: ["A2", "B2"] }));
    expect(r.rawScore).toBe(4);
    expect(r.band).toBe("low");
    expect(r.bandSource).toBe("score");
    expect(r.criticalFlags).toEqual([]);
  });

  it("[A1,D1,C2] + E1 → base 10, raw 13, high via C2+D1 override", () => {
    const r = scoreApproach(input({ selected: ["A1", "D1", "C2"], coefficients: { E1: true, E2: false } }));
    expect(r.baseScore).toBe(10);
    expect(r.rawScore).toBe(13);
    expect(r.band).toBe("high");
    expect(r.bandSource).toBe("override");
    expect(r.criticalFlags).toContain("C2+D1");
  });

  it("[D3] alone → base 5 (would be low) but override forces high", () => {
    const r = scoreApproach(input({ selected: ["D3"] }));
    expect(r.rawScore).toBe(5);
    expect(r.band).toBe("high");
    expect(r.bandSource).toBe("override");
    expect(r.criticalFlags).toEqual(["D3"]);
  });

  it("F1 unconfirmed: [A1,A4,F1] → 6 mid, no F1 score/override", () => {
    const r = scoreApproach(input({ selected: ["A1", "A4", "F1"] }));
    expect(r.rawScore).toBe(6);
    expect(r.band).toBe("mid");
    expect(r.bandSource).toBe("score");
    expect(r.criticalFlags).not.toContain("F1");
    const f1 = r.contributing.find((c) => c.id === "F1");
    expect(f1?.counted).toBe(false);
  });

  it("F1 confirmed: [A1,A4,F1] + humanConfirmedF1 → 11 and high override", () => {
    const r = scoreApproach(input({ selected: ["A1", "A4", "F1"], humanConfirmedF1: true }));
    expect(r.rawScore).toBe(11);
    expect(r.band).toBe("high");
    expect(r.bandSource).toBe("override");
    expect(r.criticalFlags).toContain("F1");
    const f1 = r.contributing.find((c) => c.id === "F1");
    expect(f1?.counted).toBe(true);
    expect(f1?.weight).toBe(5);
  });

  it("F3 is flag-only (weight 0): [F3,A2] → 2 low, F3 uncounted", () => {
    const r = scoreApproach(input({ selected: ["F3", "A2"] }));
    expect(r.rawScore).toBe(2);
    expect(r.band).toBe("low");
    const f3 = r.contributing.find((c) => c.id === "F3");
    expect(f3?.counted).toBe(false);
    expect(f3?.weight).toBe(0);
  });
});

describe("scoreApproach — override truth table", () => {
  it("C2 alone does not override", () => {
    const r = scoreApproach(input({ selected: ["C2"] }));
    expect(r.criticalFlags).toEqual([]);
    expect(r.band).toBe("low");
  });

  it("D1 alone does not override", () => {
    const r = scoreApproach(input({ selected: ["D1"] }));
    expect(r.criticalFlags).toEqual([]);
  });

  it("C2 + D1 together override to high regardless of low base", () => {
    const r = scoreApproach(input({ selected: ["C2", "D1"] }));
    // base 3+4 = 7 → mid by score, but override → high
    expect(r.bandSource).toBe("override");
    expect(r.band).toBe("high");
    expect(r.criticalFlags).toContain("C2+D1");
  });

  it("override only raises, never lowers: a high score with no flag stays high by score", () => {
    const r = scoreApproach(input({ selected: ["A1", "A4", "A5", "B1", "D2"] }));
    expect(r.rawScore).toBe(15);
    expect(r.band).toBe("high");
    expect(r.bandSource).toBe("score");
    expect(r.criticalFlags).toEqual([]);
  });

  it("E coefficients multiply (E1×E2 = 1.56)", () => {
    const r = scoreApproach(input({ selected: ["A1"], coefficients: { E1: true, E2: true } }));
    // 3 × 1.56 = 4.68 → 5
    expect(r.coefficient).toBeCloseTo(1.56, 5);
    expect(r.rawScore).toBe(5);
  });
});

describe("scoreApproach — calibration personas", () => {
  for (const f of fixtures) {
    it(`${f.name}: ${f.description}`, () => {
      const r = scoreApproach(f.input);
      expect(r.rawScore).toBe(f.expect.rawScore);
      expect(r.band).toBe(f.expect.band);
      expect(r.bandSource).toBe(f.expect.bandSource);
      expect(r.criticalFlags).toEqual(f.expect.criticalFlags);
    });
  }

  it("a normal recruiter does not reach high (false-positive control)", () => {
    const legit = fixtures.find((f) => f.name === "legit-recruiter")!;
    expect(scoreApproach(legit.input).band).not.toBe("high");
  });
});
