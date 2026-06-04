import { describe, it, expect } from "vitest";
import { parseModelJson, stripCodeFences, InterpretResultSchema, OsintResultSchema } from "../src/schema";

describe("parseModelJson — defensive model-output parsing", () => {
  it("strips a ```json fence the model added and validates", () => {
    const raw = '```json\n{"subject_hint":{"company":"Acme"},"matched_indicators":[]}\n```';
    const r = parseModelJson(raw, InterpretResultSchema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subject_hint.company).toBe("Acme");
      expect(r.value.subject_hint.person).toBe(""); // default filled
      expect(r.value.notes_for_user).toBe("");
    }
  });

  it("returns an error (not a throw) on invalid JSON", () => {
    const r = parseModelJson("totally not json", InterpretResultSchema);
    expect(r.ok).toBe(false);
  });

  it("validates the OSINT result shape with defaults", () => {
    const r = parseModelJson('{"subject_hint":{}}', OsintResultSchema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tool_runs).toEqual([]);
      expect(r.value.unavailable_sources).toEqual([]);
    }
  });

  it("stripCodeFences handles bare ``` and plain text", () => {
    expect(stripCodeFences("```\n{}\n```")).toContain("{}");
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts JSON even when the model wraps it in prose", () => {
    const raw = 'Here is the analysis you asked for:\n{"subject_hint":{"company":"Acme"},"matched_indicators":[]}\nHope that helps!';
    const r = parseModelJson(raw, InterpretResultSchema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.subject_hint.company).toBe("Acme");
  });

  it("tolerates messy field values (capitalized confidence, missing rationale, partial hint)", () => {
    const raw = JSON.stringify({
      subject_hint: { company: "Acme" },
      matched_indicators: [{ id: "C2", confidence: "HIGH" }, { id: "D1", confidence: "weird-value", rationale: 42 }],
      suggested_band: "high",
    });
    const r = parseModelJson(raw, InterpretResultSchema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.matched_indicators[0]).toMatchObject({ id: "C2", confidence: "high" });
      expect(r.value.matched_indicators[1]?.confidence).toBe("medium"); // bad value → fallback
      expect(r.value.subject_hint.person).toBe(""); // missing field filled
    }
  });
});
