import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SubjectHint } from "@hhc/shared";
import { httpAgentClient } from "../api/httpAgentClient";
import type { AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

const EMPTY: SubjectHint = { company: "", domain: "", person: "", title: "" };

export function OsintPanel({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const [hint, setHint] = useState<SubjectHint>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed identifiers from §6 subject hint when it arrives (the "clever" auto-extract).
  useEffect(() => {
    if (c.subjectHint) setHint((prev) => ({ ...prev, ...c.subjectHint }));
  }, [c.subjectHint]);

  const backendReady = health?.ok === true;
  const offline = health?.offline === true;
  const noKey = health ? health.anthropicKey === false : false;
  const hasAnyId = !!(hint.company || hint.domain || hint.person || hint.title);
  const canRun = backendReady && !offline && !noKey && !busy && hasAnyId;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await httpAgentClient.runOsintAgent(hint);
      c.applyOsintResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
      <p className="muted">{t("osint.intro")}</p>

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
          {busy ? t("osint.running") : t("osint.run")}
        </button>
      </div>

      {offline ? <p className="warn">{t("osint.offline")}</p> : null}
      {noKey ? <p className="warn">{t("interpret.noKey")}</p> : null}
      {error ? <p className="warn">{t("interpret.error", { msg: error })}</p> : null}

      {c.osint ? <OsintResults c={c} /> : null}
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
          {r.watchlist_candidates.map((w, i) => (
            <div key={i} className={`watchlist-item maps-${w.maps_to}`}>
              <div>
                <span className="maps-badge">{w.maps_to}</span> <strong>{w.matched_entity}</strong>
                <span className="muted small"> · {w.list}{typeof w.score === "number" ? ` · ${w.score.toFixed(2)}` : ""}</span>
              </div>
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
          ))}
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
        <p className="warn small">
          {t("osint.unavailable", { sources: r.unavailable_sources.join(", ") })}
        </p>
      ) : null}

      {r.notes_for_user ? <p className="osint-notes">{r.notes_for_user}</p> : null}

      <details className="tool-runs">
        <summary>{t("osint.toolRuns", { count: r.tool_runs.length })}</summary>
        <ul>
          {r.tool_runs.map((tr, i) => (
            <li key={i} className={`run-${tr.status}`}>
              <span className="ind-id">{tr.tool}</span> {tr.status}
              {tr.citation ? <span className="muted small"> · {tr.citation}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
