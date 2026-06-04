import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  recordInquiry,
  fetchStats,
  type AgentHealth,
  type RecordInquiryResponse,
} from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

interface StatsShape {
  totalInquiries: number;
  uniqueSubjects: number;
  repeatContacts: number;
  bandDistribution: { low: number; mid: number; high: number };
  frequentIndicators: Array<{ id: string; count: number }>;
  coordinated: Array<{ distinctSubjects: number; theme?: string; windowStart: string }>;
  probedThemes: Array<{ theme: string; count: number }>;
}

export function CaseHistoryPanel({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<RecordInquiryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsShape | null>(null);

  const enabled = health?.caseDb === true;

  async function loadStats() {
    const r = await fetchStats();
    if (r?.enabled && r.stats) setStats(r.stats as StatsShape);
  }

  useEffect(() => {
    if (enabled) void loadStats();
  }, [enabled]);

  if (!enabled) return null;

  const matchedIds = [...c.selected, ...(c.humanConfirmedF1 ? ["F1"] : [])];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const hint = c.subjectHint ?? { company: "", domain: "", person: "", title: "" };
      const evidenceKeys = (c.osint?.evidence ?? []).map((e) => `${e.source}:${e.url ?? e.summary}`);
      const res = await recordInquiry({
        identifiers: { company: hint.company, domain: hint.domain, person: hint.person },
        score: c.result.rawScore,
        band: c.result.band,
        matchedIndicatorIds: matchedIds,
        theme: theme || undefined,
        evidenceKeys,
      });
      setSaved(res);
      await loadStats();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="case-history" aria-label={t("history.heading")}>
      <h2>{t("history.heading")}</h2>
      <p className="muted small">{t("history.privacy")}</p>

      <div className="intake-actions">
        <input
          className="osint-input theme-input"
          placeholder={t("history.themePlaceholder")}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        />
        <div className="spacer" />
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? t("history.saving") : t("history.save")}
        </button>
      </div>
      {error ? <p className="warn small">{t("interpret.error", { msg: error })}</p> : null}

      {saved ? (
        <div className="save-result">
          {saved.diff.firstTime ? (
            <p className="muted small">{t("history.savedFirst", { count: saved.inquiryCount })}</p>
          ) : (
            <p className="muted small">
              {t("history.savedDiff", {
                count: saved.inquiryCount,
                added: saved.diff.newIndicators.join(", ") || "—",
                delta: saved.diff.scoreDelta,
              })}
              {saved.diff.bandChange ? ` (${saved.diff.bandChange.from}→${saved.diff.bandChange.to})` : ""}
            </p>
          )}
        </div>
      ) : null}

      {stats ? (
        <div className="stats">
          {stats.coordinated.length > 0 ? (
            <p className="warn">
              ⚠ {t("history.coordinated", { n: stats.coordinated[0]!.distinctSubjects, theme: stats.coordinated[0]!.theme ?? "—" })}
            </p>
          ) : null}
          <p className="muted small">
            {t("history.summary", {
              total: stats.totalInquiries,
              subjects: stats.uniqueSubjects,
              repeat: stats.repeatContacts,
            })}
          </p>
          <p className="muted small">
            {t("history.bands", {
              low: stats.bandDistribution.low,
              mid: stats.bandDistribution.mid,
              high: stats.bandDistribution.high,
            })}
          </p>
          {stats.frequentIndicators.length > 0 ? (
            <p className="muted small">
              {t("history.topTtp")}: {stats.frequentIndicators.slice(0, 5).map((f) => `${f.id}×${f.count}`).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
