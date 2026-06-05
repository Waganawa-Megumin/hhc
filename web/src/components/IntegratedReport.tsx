import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildEventLog, buildReportDraft, type AssessmentSummary, type EventLogInput } from "@hhc/shared";
import { useLang } from "../i18n";
import { generateReport, type AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

interface ReportEntry {
  id: string;
  at: string;
  band: string;
  body: string;
  ai: boolean;
  /** Deterministic detailed event log snapshot captured at generation time. */
  log: string;
}

function downloadText(filename: string, text: string, mime = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function tsSlug(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal, safe Markdown → HTML for the report subset (escapes first). */
function mdToHtml(md: string): string {
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  let html = "";
  let inList = false;
  let inPara = false;
  const closePara = () => {
    if (inPara) {
      html += "</p>";
      inPara = false;
    }
  };
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closePara();
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closePara();
      closeList();
      const lvl = h[1]!.length;
      html += `<h${lvl}>${inline(h[2]!)}</h${lvl}>`;
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      closePara();
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(li[1]!)}</li>`;
      continue;
    }
    if (/^---+$/.test(line)) {
      closePara();
      closeList();
      html += "<hr/>";
      continue;
    }
    closeList();
    if (!inPara) {
      html += "<p>";
      inPara = true;
    } else {
      html += "<br/>";
    }
    html += inline(line);
  }
  closePara();
  closeList();
  return html;
}

/** Open a branded, printable window with the banner cover (user picks "Save as PDF"). */
function openPrintWindow(entry: ReportEntry, lang: "ja" | "en"): boolean {
  const banner = `${location.origin}/og-image.png`;
  const logo = `${location.origin}/favicon.svg`;
  const when = new Date(entry.at).toLocaleString();
  const disclaimer =
    lang === "ja"
      ? "本書は断定・告発ではなく、指標合致と公開情報に基づく自衛上のリスク評価です。民族の自動推論は行っていません。"
      : "This is not an accusation; it is a self-defense risk assessment based on indicator matches and public information. No automated ethnicity inference was performed.";
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"/>
<title>HHC report ${escapeHtml(when)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1a1a1a; margin: 32px; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rpt-banner { width: 100%; height: auto; border-radius: 10px; display: block; }
  .rpt-banner-fallback { display: none; align-items: center; gap: 12px; border-bottom: 3px solid #3b6fd4; padding-bottom: 10px; }
  .rpt-banner-fallback img { width: 44px; height: 44px; }
  .rpt-meta { color: #555; font-size: 12px; margin: 12px 0 18px; }
  .band { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 700; font-size: 12px; }
  .band-high { background: #fde2e0; color: #b5302a; }
  .band-mid { background: #fbeccd; color: #8a5a12; }
  .band-low { background: #e9eaef; color: #555; }
  h1,h2,h3 { line-height: 1.3; } h2 { font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-top: 20px; } h3 { font-size: 14px; }
  code { background: #f0f2f7; padding: 0 3px; border-radius: 3px; font-size: 90%; }
  ul { margin: 6px 0; } a { color: #2a5db0; }
  footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 8px; color: #777; font-size: 11px; }
  @media print { body { margin: 12mm; } }
</style></head>
<body>
  <img class="rpt-banner" src="${banner}" alt="HHC — Human Hunter Check"
       onerror="this.style.display='none';document.getElementById('fb').style.display='flex';" />
  <div id="fb" class="rpt-banner-fallback"><img src="${logo}" alt=""/><h1 style="margin:0;font-size:20px;">HHC — Human Hunter Check</h1></div>
  <div class="rpt-meta">${escapeHtml(when)} · <span class="band band-${entry.band}">${entry.band.toUpperCase()}</span></div>
  <main>${mdToHtml(entry.body)}</main>
  <footer>${escapeHtml(disclaimer)}</footer>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},350);});</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
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

  /** Assemble the deterministic event-log input from the current analysis state. */
  function buildLogInput(): EventLogInput {
    const hint = c.subjectHint ?? { company: "", domain: "", person: "", title: "" };
    return {
      generatedAt: new Date().toISOString(),
      subject: hint,
      nationalityContext: c.nationalityContext || undefined,
      result: c.result,
      coefficients: c.coefficients,
      humanConfirmedF1: c.humanConfirmedF1,
      suggestions: c.suggestions,
      selectedIds: [...c.selected],
      osint: c.osint,
      interpretation: c.aiNotes
        ? { notes: c.aiNotes.notes, observations: c.aiNotes.observations, suggestedBand: c.aiNotes.suggestedBand }
        : undefined,
    };
  }

  function downloadLog() {
    const at = new Date().toISOString();
    downloadText(`hhc-eventlog-${tsSlug(at)}.txt`, buildEventLog(buildLogInput(), lang), "text/plain");
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
    const at = new Date().toISOString();
    const log = buildEventLog({ ...buildLogInput(), generatedAt: at }, lang);
    const entry: ReportEntry = { id: crypto.randomUUID(), at, band: c.result.band, body, ai, log };
    setHistory((prev) => [entry, ...prev]);
    setBusy(false);
  }

  return (
    <section className="integrated-report" aria-label={t("report2.heading")}>
      <h2>{t("report2.heading")}</h2>
      <div className="report2-actions">
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
        <button type="button" className="ghost" onClick={downloadLog} disabled={!ready} title={t("report2.eventLogHint")}>
          {t("report2.eventLog")}
        </button>
      </div>
      {!ready ? <p className="muted small">{t("report2.disabledHint")}</p> : <p className="muted small">{t("report2.eventLogHint")}</p>}
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
                  onClick={() => downloadText(`hhc-report-${tsSlug(r.at)}.md`, r.body)}
                >
                  {t("report2.download")}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (!openPrintWindow(r, lang)) setError(t("report2.popupBlocked"));
                  }}
                >
                  {t("report2.pdf")}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => downloadText(`hhc-eventlog-${tsSlug(r.at)}.txt`, r.log, "text/plain")}
                >
                  {t("report2.eventLog")}
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
