import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildReportDraft, type AssessmentSummary } from "@hhc/shared";
import { useLang } from "../i18n";
import type { ChecklistController } from "../state/useChecklist";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function downloadJson(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportDraft({ c }: { c: ChecklistController }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [copied, setCopied] = useState(false);
  const [frozen, setFrozen] = useState<string | null>(null);

  const assessment: AssessmentSummary = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      subject: c.subjectHint ?? { company: "", domain: "", person: "", title: "" },
      score: c.result.rawScore,
      band: c.result.band,
      bandSource: c.result.bandSource,
      criticalFlags: c.result.criticalFlags,
      matchedIndicatorIds: [...c.selected, ...(c.humanConfirmedF1 ? ["F1"] : [])],
      evidence: c.osint?.evidence ?? [],
      unavailableSources: c.osint?.unavailable_sources ?? [],
      nationalityContext: c.nationalityContext || undefined,
    }),
    [c.subjectHint, c.result, c.selected, c.humanConfirmedF1, c.osint, c.nationalityContext],
  );

  const hasContent = c.result.contributing.length > 0 || c.result.criticalFlags.length > 0;
  if (!hasContent) return null;

  const draft = buildReportDraft(assessment, lang);

  async function copy() {
    await navigator.clipboard.writeText(draft.body).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function freeze() {
    // §5-6: timestamp + content-hash snapshot for later reporting (personal record).
    const canonical = JSON.stringify(assessment);
    const sha256 = await sha256Hex(canonical);
    const snapshot = { kind: "hhc-evidence-snapshot", frozenAt: new Date().toISOString(), sha256, assessment };
    downloadJson(`hhc-snapshot-${snapshot.frozenAt.replace(/[:.]/g, "-")}.json`, JSON.stringify(snapshot, null, 2));
    setFrozen(sha256.slice(0, 16));
  }

  return (
    <section className="report-draft" aria-label={t("report.heading")}>
      <details open={c.result.band === "high"}>
        <summary>{t("report.heading")}</summary>
        <div className="report-actions">
          <button type="button" className="ghost" onClick={copy}>
            {copied ? t("report.copied") : t("report.copy")}
          </button>
          <button type="button" className="ghost" onClick={freeze}>
            {t("report.freeze")}
          </button>
        </div>
        {frozen ? <p className="muted small">{t("report.frozen", { hash: frozen })}</p> : null}
        <pre className="report-body">{draft.body}</pre>
      </details>
    </section>
  );
}
