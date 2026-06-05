import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { classifyToken, explainMatch, rateName, tokenizeName, type SubjectHint } from "@hhc/shared";
import { httpAgentClient } from "../api/httpAgentClient";
import type { AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

const EMPTY: SubjectHint = { company: "", domain: "", person: "", title: "" };

/** Render `text`, highlighting the tokens that match (exactly or fuzzily) a token in
 * `against`. Shows WHERE — and how strongly — two strings overlap. Uses the shared
 * matchExplain logic so the panel and the detailed event log agree. */
function Highlighted({ text, against }: { text: string; against: string }) {
  const other = tokenizeName(against);
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) => {
        if (!p.trim()) return <span key={i}>{p}</span>;
        const level = classifyToken(p, other);
        return level === "none" ? (
          <span key={i}>{p}</span>
        ) : (
          <mark key={i} className={`match-hl ${level}`}>
            {p}
          </mark>
        );
      })}
    </>
  );
}

export function OsintPanel({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const [hint, setHint] = useState<SubjectHint>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  // Seed identifiers from §6 subject hint when it arrives (the "clever" auto-extract),
  // so the edit-and-re-run fields are pre-filled with what Analyze found.
  useEffect(() => {
    if (c.subjectHint) setHint((prev) => ({ ...prev, ...c.subjectHint }));
  }, [c.subjectHint]);

  const backendReady = health?.ok === true;
  const offline = health?.offline === true;
  const noKey = health ? health.anthropicKey === false : false;
  const hasAnyId = !!(hint.company || hint.domain || hint.person || hint.title);
  const canRun = backendReady && !offline && !noKey && !busy && hasAnyId;
  const hasResults = !!c.osint;
  // Before any result the fields are the manual entry point; after a result they
  // hide behind "correct & re-run" so the panel stays results-focused.
  const editOpen = !hasResults || showEdit;

  async function run() {
    setBusy(true);
    c.setAnalyzing(true);
    setError(null);
    try {
      const result = await httpAgentClient.runOsintAgent(hint);
      c.applyOsintResult(result);
      setShowEdit(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      c.setAnalyzing(false);
    }
  }

  const field = (key: keyof SubjectHint) => (
    <input
      className="osint-input"
      placeholder={t(`osint.field.${key}`)}
      value={hint[key]}
      onChange={(e) => setHint((prev) => ({ ...prev, [key]: e.target.value }))}
    />
  );

  return (
    <section className="osint" aria-label={t("osint.heading")}>
      <div className="section-head">
        <h2>{t("osint.heading")}</h2>
        {!backendReady ? <span className="net-badge offline">{t("interpret.backendUnavailable")}</span> : null}
      </div>
      <p className="muted">{t("osint.autoNote")}</p>

      {hasResults ? <OsintResults c={c} /> : <p className="muted small osint-empty">{t("osint.emptyHint")}</p>}

      {hasResults ? (
        <button type="button" className="ghost osint-edit-toggle" onClick={() => setShowEdit((v) => !v)} disabled={busy}>
          ✎ {t("osint.editRerun")}
        </button>
      ) : null}

      {editOpen ? (
        <div className="osint-edit">
          <div className="osint-fields">
            {field("company")}
            {field("domain")}
            {field("person")}
            {field("title")}
          </div>
          <div className="intake-actions">
            <span className="muted small">{t("osint.publicOnly")}</span>
            <div className="spacer" />
            <button type="button" className="primary" onClick={run} disabled={!canRun}>
              {busy ? (
                <>
                  <span className="spinner" />
                  {t("osint.running")}
                </>
              ) : hasResults ? (
                t("osint.rerun")
              ) : (
                t("osint.run")
              )}
            </button>
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="analyzing-banner" role="status" aria-live="polite">
          <span className="spinner" />
          <span>
            {t("osint.running")}
            <span className="analyzing-sub"> — {t("osint.runningWait")}</span>
          </span>
        </div>
      ) : null}

      {offline ? <p className="warn">{t("osint.offline")}</p> : null}
      {noKey ? <p className="warn">{t("interpret.noKey")}</p> : null}
      {error ? <p className="warn">{t("interpret.error", { msg: error })}</p> : null}
    </section>
  );
}

function OsintResults({ c }: { c: ChecklistController }) {
  const { t } = useTranslation();
  const r = c.osint!;
  return (
    <div className="osint-results">
      {r.watchlist_candidates.length > 0 ? (
        <div className="watchlist">
          <h3>{t("osint.watchlistHeading")}</h3>
          <p className="muted small">{t("osint.watchlistNote")}</p>
          {r.watchlist_candidates.map((w, i) => {
            const score = typeof w.score === "number" ? w.score : 0;
            const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
            const rate = rateName(score);
            const rateLabel = rate === "high" ? t("osint.rateHigh") : rate === "mid" ? t("osint.rateMid") : t("osint.rateLow");
            const fuzzyOnly = explainMatch(w.query, w.matched_entity).fuzzyOnly;
            return (
              <div key={i} className={`watchlist-item maps-${w.maps_to}`}>
                <div className="wl-main">
                  <div className="wl-line">
                    <span className="maps-badge">{w.maps_to}</span>
                    <span className="wl-match">
                      <span className="wl-query">
                        <Highlighted text={w.query} against={w.matched_entity} />
                      </span>
                      <span className="wl-arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="wl-entity">
                        <Highlighted text={w.matched_entity} against={w.query} />
                      </span>
                    </span>
                  </div>
                  <div className="muted small wl-meta">
                    {w.list}
                    {fuzzyOnly ? <span className="wl-fuzzy-tag"> · {t("osint.fuzzyMatch")}</span> : null}
                  </div>
                  {typeof w.score === "number" ? (
                    <div className={`wl-rate rate-${rate}`}>
                      <span className="wl-rate-label">
                        {t("osint.matchStrength")}: {pct}%（{rateLabel}）
                      </span>
                      <span className="wl-bar">
                        <span className="wl-bar-fill" style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="wl-action">
                  {w.maps_to === "F1" ? (
                    <button
                      type="button"
                      className={c.humanConfirmedF1 ? "ghost" : "primary small-btn"}
                      onClick={() => c.setHumanConfirmedF1(true)}
                      disabled={c.humanConfirmedF1}
                    >
                      {c.humanConfirmedF1 ? t("osint.f1Confirmed") : t("osint.confirmF1")}
                    </button>
                  ) : (
                    <span className="muted small">{t("osint.pending")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {r.evidence.length > 0 ? (
        <div className="evidence">
          <h3>{t("osint.evidenceHeading")}</h3>
          <ul>
            {r.evidence.map((e, i) => (
              <li key={i}>
                <strong>{e.source}</strong>
                {e.url ? (
                  <>
                    {" "}
                    <a href={e.url} target="_blank" rel="noreferrer noopener">
                      {t("osint.sourceLink")}
                    </a>
                  </>
                ) : null}
                : {e.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {r.unavailable_sources.length > 0 ? (
        <p className="warn small">{t("osint.unavailable", { sources: r.unavailable_sources.join(", ") })}</p>
      ) : null}

      {r.notes_for_user ? <p className="osint-notes">{r.notes_for_user}</p> : null}

      <div className="source-results">
        <h3>{t("osint.sourcesHeading", { count: r.tool_runs.length })}</h3>
        <ul>
          {r.tool_runs.map((tr, i) => {
            const cands = (tr.data as { candidates?: unknown[] } | undefined)?.candidates?.length ?? 0;
            const status =
              tr.status === "ok"
                ? cands > 0
                  ? t("osint.statusHits", { n: cands })
                  : t("osint.statusOk")
                : tr.status === "no_match"
                  ? t("osint.statusNoMatch")
                  : tr.status === "unavailable"
                    ? t("osint.statusUnavailable")
                    : t("osint.statusError");
            return (
              <li key={i} className={`src-line run-${tr.status}`}>
                <span className="src-dot" />
                <span className="src-name">{tr.tool}</span>
                <span className="src-status">{status}</span>
                {tr.citation ? <span className="muted small src-cite">{tr.citation}</span> : null}
                {tr.note && (tr.status === "unavailable" || tr.status === "error") ? (
                  <span className="muted small">— {tr.note}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
