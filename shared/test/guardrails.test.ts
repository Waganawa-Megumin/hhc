import { describe, it, expect } from "vitest";
import {
  containsForbiddenLabel,
  stripForbiddenLabels,
  findForbiddenDemographicKeys,
  assertNoDemographicScoringFields,
} from "../src/guardrails";

describe("forbidden accusatory labels (model output)", () => {
  it("detects spy / スパイ / 工作員 / 諜報員", () => {
    expect(containsForbiddenLabel("this person is a spy")).toBe(true);
    expect(containsForbiddenLabel("彼はスパイだ")).toBe(true);
    expect(containsForbiddenLabel("工作員の疑いがある")).toBe(true);
    expect(containsForbiddenLabel("諜報員")).toBe(true);
  });

  it("scrubs labels so the result is clean", () => {
    const { text, scrubbed } = stripForbiddenLabels("He is a spy and likely 工作員");
    expect(scrubbed).toBe(true);
    expect(containsForbiddenLabel(text)).toBe(false);
  });

  it("leaves benign risk language untouched", () => {
    const { scrubbed } = stripForbiddenLabels("This looks like a high-risk recruitment approach.");
    expect(scrubbed).toBe(false);
  });
});

describe("demographic scoring guard (nationality/ethnicity never score or persist)", () => {
  it("finds forbidden keys at any depth (EN + JP)", () => {
    expect(findForbiddenDemographicKeys({ a: { nationality: "x" } })).toContain("a.nationality");
    expect(findForbiddenDemographicKeys({ subject: { 民族: "x" } })).toContain("subject.民族");
    expect(findForbiddenDemographicKeys([{ ethnicity: "x" }])).toContain("[0].ethnicity");
  });

  it("throws for a scoring/DB structure that contains a demographic field", () => {
    expect(() => assertNoDemographicScoringFields({ race: "x" }, "case record")).toThrow(/demographic/i);
  });

  it("passes a clean scoring input", () => {
    expect(() =>
      assertNoDemographicScoringFields(
        { selected: ["A1", "C2"], coefficients: { E1: true, E2: false }, humanConfirmedF1: false },
        "score input",
      ),
    ).not.toThrow();
  });
});
