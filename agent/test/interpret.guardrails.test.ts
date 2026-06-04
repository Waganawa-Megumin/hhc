import { describe, it, expect } from "vitest";
import { interpret, sanitizeInterpretResult, type ModelComplete } from "../src/anthropic/interpret";
import { InterpretResultSchema } from "@hhc/shared";

function stub(json: string): ModelComplete {
  return async () => json;
}

describe("§6 interpret — guardrails and graceful degradation", () => {
  it("refuses without consent", async () => {
    const out = await interpret({ text: "hi", images: [], consent: false }, stub("{}"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("consent_required");
  });

  it("refuses empty input", async () => {
    const out = await interpret({ text: "   ", images: [], consent: true }, stub("{}"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("empty_input");
  });

  it("parses a fenced JSON response and keeps only known, tickable indicators", async () => {
    const model = stub(
      "```json\n" +
        JSON.stringify({
          subject_hint: { company: "Acme Advisory" },
          matched_indicators: [
            { id: "C2", confidence: "high", rationale: "Pushed to Signal immediately" },
            { id: "E1", confidence: "high", rationale: "should be dropped — E is a coefficient" },
            { id: "ZZ", confidence: "low", rationale: "unknown id should be dropped" },
          ],
          free_observations: ["compensation seems excessive"],
          suggested_band: "high",
          notes_for_user: "Verify by video call.",
        }) +
        "\n```",
    );
    const out = await interpret({ text: "msg", images: [], consent: true }, model);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const ids = out.result.matched_indicators.map((m) => m.id);
      expect(ids).toEqual(["C2"]); // E1 and ZZ removed
      expect(out.result.subject_hint.company).toBe("Acme Advisory");
    }
  });

  it("scrubs forbidden labels from model text", () => {
    const sanitized = sanitizeInterpretResult({
      subject_hint: { company: "", domain: "", person: "", title: "" },
      matched_indicators: [{ id: "C1", confidence: "medium", rationale: "This person is clearly a spy." }],
      free_observations: ["likely a 工作員"],
      evidence: [],
      suggested_band: "high",
      notes_for_user: "They are a spy.",
    });
    const blob = JSON.stringify(sanitized);
    expect(blob).not.toMatch(/\bspy\b/i);
    expect(blob).not.toMatch(/工作員/);
    expect(sanitized.matched_indicators[0]?.id).toBe("C1");
  });

  it("degrades gracefully (no throw) on invalid model JSON", async () => {
    const out = await interpret({ text: "msg", images: [], consent: true }, stub("not json at all"));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.matched_indicators).toEqual([]);
      expect(out.degraded).toBeTruthy();
      expect(out.result.notes_for_user).toMatch(/manually|手動/);
    }
  });

  it("surfaces model errors without throwing", async () => {
    const failing: ModelComplete = async () => {
      throw new Error("network down");
    };
    const out = await interpret({ text: "msg", images: [], consent: true }, failing);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/model_error/);
  });

  it("the result shape validates against the shared schema", async () => {
    const out = await interpret(
      { text: "msg", images: [], consent: true },
      stub(JSON.stringify({ subject_hint: {}, matched_indicators: [] })),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(InterpretResultSchema.safeParse(out.result).success).toBe(true);
  });
});
