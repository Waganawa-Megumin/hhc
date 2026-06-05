import { describe, it, expect } from "vitest";
import { generateReport } from "../src/anthropic/report";
import type { AssessmentSummary } from "@hhc/shared";

const assessment: AssessmentSummary = {
  generatedAt: "2026-06-05T00:00:00Z",
  subject: { company: "Acme Advisory", domain: "acme.example", person: "", title: "consultant" },
  score: 13,
  band: "high",
  bandSource: "override",
  criticalFlags: ["C2+D1"],
  matchedIndicatorIds: ["A1", "C2", "D1"],
  evidence: [{ source: "rdap", url: "https://rdap.org/", summary: "domain 3 weeks old" }],
  unavailableSources: ["corp_jp"],
  nationalityContext: "",
};

describe("§5-7 integrated report generator", () => {
  it("returns markdown and scrubs forbidden labels from model output", async () => {
    const out = await generateReport(
      { lang: "ja", assessment },
      async () => "# 統合レポート\nこの人物はスパイです。\n## 推奨アクション\nエンゲージ停止。",
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.report).not.toMatch(/スパイ/);
      expect(out.report).toContain("統合レポート");
    }
  });

  it("passes the deterministic band/score to the model as authoritative facts", async () => {
    let seen = "";
    await generateReport({ lang: "en", assessment }, async ({ userText }) => {
      seen = userText;
      return "# Report";
    });
    expect(seen).toContain("high");
    expect(seen).toContain("C2+D1");
  });

  it("surfaces model errors without throwing", async () => {
    const out = await generateReport({ lang: "en", assessment }, async () => {
      throw new Error("boom");
    });
    expect(out.ok).toBe(false);
  });
});
