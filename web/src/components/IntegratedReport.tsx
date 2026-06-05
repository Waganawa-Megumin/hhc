import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildReportDraft, type AssessmentSummary } from "@hhc/shared";
import { useLang } from "../i18n";
import { generateReport, type AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

interface ReportEntry {
  id: string;
  at: string;
  band: string;
  body: string;
  ai: boolean;
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** §5-7 — generate an integrated report (AI-organized, deterministic fallback),
 * keep a session history, and allow per-report download. */
export function IntegratedReport({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportEntry[]>([]);

  const hasContent = c.result.contributing.length > 0 || c.result.criticalFlags.length > 0;
  // Greyed out until an analysis has produced something and no run is in progress.
  const ready = hasContent && !c.analyzing;

  function buildAssessment(): AssessmentSummary {
    const hint = c.subjectHint ?? { company: "", domain: "", person: "", title: "" };
    return {
      generatedAt: new Date().toISOString(),
      subject: hint,
      score: c.result.rawScore,
      band: c.result.band,
      bandSource: c.result.bandSource,
      criticalFlags: c.result.criticalFlags,
      matchedIndicatorIds: [...c.selected, ...(c.humanConfirmedF1 ? ["F1"] : [])],
      evidence: c.osint?.evidence ?? [],
      unavailableSources: c.osint?.unavailable_sources ?? [],
      nationalityContext: c.nationalityContext || undefined,
    };
  }

  async function generate() {
    setBusy(true);
    setError(null);
    const assessment = buildAssessment();
    let body: string;
    let ai = true;
    try {
      body = await generateReport({
        lang,
        assessment,
        watchlist_candidates: c.osint?.watchlist_candidates ?? [],
        tool_runs: c.osint?.tool_runs ?? [],
        osint_notes: c.osint?.notes_for_user ?? "",
      });
    } catch (e) {
      // Deterministic fallback works without a key / offline.
      ai = false;
      body = buildReportDraft(assessment, lang).body;
      setError(t("report2.aiUnavailable", { msg: (e as Error).message }));
    }
    const entry: ReportEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), band: c.result.band, body, ai };
    setHistory((prev) => [entry, ...prev]);
    setBusy(false);
  }

  return (
    <section className="integrated-report" aria-label={t("report2.heading")}>
      <h2>{t("report2.heading")}</h2>
      <button type="button" className="primary" onClick={generate} disabled={busy || !ready}>
        {busy ? (
          <>
            <span className="spinner" />
            {t("report2.generating")}
          </>
        ) : (
          t("report2.generate")
        )}
      </button>
      {!ready ? <p className="muted small">{t("report2.disabledHint")}</p> : null}
      {ready && health && !health.anthropicKey ? <p className="muted small">{t("report2.keyNote")}</p> : null}
      {error ? <p className="warn small">{error}</p> : null}

      {history.length > 0 ? (
        <div className="report-history">
          <h3>{t("report2.historyHeading", { count: history.length })}</h3>
          {history.map((r) => (
            <details key={r.id} className="report-entry" open={r === history[0]}>
              <summary>
                <span className={`band-badge band-${r.band}`}>{r.band}</span>{" "}
                {new Date(r.at).toLocaleString()}
                {r.ai ? "" : ` · ${t("report2.deterministic")}`}
              </summary>
              <div className="report-entry-actions">
                <button type="button" className="ghost" onClick={() => void navigator.clipboard.writeText(r.body)}>
                  {t("report.copy")}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => downloadText(`hhc-report-${r.at.replace(/[:.]/g, "-")}.md`, r.body)}
                >
                  {t("report2.download")}
                </button>
              </div>
              <pre className="report-body">{r.body}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
