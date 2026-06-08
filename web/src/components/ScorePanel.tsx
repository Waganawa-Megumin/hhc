import { useTranslation } from "react-i18next";
import { BAND_GUIDANCE, BAND_ORDER, BANDS, CRITICAL_OVERRIDES, indicatorById, type Band, type ScoreResult } from "@hhc/shared";
import { useLang } from "../i18n";

export function ScorePanel({ result }: { result: ScoreResult }) {
  const { t } = useTranslation();
  const lang = useLang();
  const guidance = BAND_GUIDANCE[result.band];

  const overrideLabel = (id: string): string => {
    const ov = CRITICAL_OVERRIDES.find((o) => o.id === id);
    return ov ? ov.label[lang] : id;
  };

  // Band ranges straight from the KB thresholds, so the legend can't drift from scoring.
  const lowMax = BANDS.low.max ?? 5;
  const midMax = BANDS.mid.max ?? 12;
  const bandRange: Record<Band, string> = {
    low: `0–${lowMax}`,
    mid: `${lowMax + 1}–${midMax}`,
    high: `${midMax + 1}+`,
  };

  const hasSelection = result.contributing.length > 0 || result.criticalFlags.length > 0;

  return (
    <section className={`score-panel band-${result.band}`} aria-label={t("score.heading")}>
      <div className="score-head">
        <h2>{t("score.heading")}</h2>
        <span className={`band-badge band-${result.band}`}>{guidance.label[lang]}</span>
      </div>

      <div className="score-numbers">
        <div className="score-num">
          <span className="num">{result.rawScore}</span>
          <span className="num-label">{t("score.raw")}</span>
        </div>
        <div className="score-meta">
          <div>
            {t("score.band")}: <strong>{guidance.label[lang]}</strong>
          </div>
          <div className="muted">
            {result.bandSource === "override" ? t("score.bySourceOverride") : t("score.bySourceScore")}
          </div>
          {result.coefficient !== 1 ? (
            <div className="muted">
              {t("score.coefficient")}: ×{result.coefficient.toFixed(2)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="band-legend">
        <span className="legend-label">{t("score.legend")}</span>
        {BAND_ORDER.map((b) => (
          <span
            key={b}
            className={`legend-chip band-${b}${b === result.band ? " current" : ""}`}
            aria-current={b === result.band ? "true" : undefined}
          >
            {BAND_GUIDANCE[b].label[lang]} <span className="legend-range">{bandRange[b]}</span>
          </span>
        ))}
      </div>
      <p className="muted small legend-note">★ {t("score.overrideNote")}</p>

      {result.criticalFlags.length > 0 ? (
        <div className="critical-flags">
          <span className="crit-badge">★</span> {t("score.criticalFlags")}:
          <ul>
            {result.criticalFlags.map((id) => (
              <li key={id}>{overrideLabel(id)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="breakdown" open>
        <summary>{t("score.breakdown")}</summary>
        {hasSelection ? (
          <ul>
            {result.contributing.map((ctr) => (
              <li key={ctr.id} className={ctr.counted ? "counted" : "uncounted"}>
                <span className="ind-id">{ctr.id}</span>
                <span className="break-label">{indicatorById(ctr.id)?.label[lang] ?? ctr.id}</span>
                <span className="break-weight">
                  {ctr.counted ? `+${ctr.weight} ${t("score.weightUnit")}` : t("score.uncounted")}
                </span>
              </li>
            ))}
            {result.coefficient !== 1 ? (
              <li className="counted coeff-line">
                <span className="break-label">{t("score.coefficient")}</span>
                <span className="break-weight">×{result.coefficient.toFixed(2)}</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="muted">{t("score.none")}</p>
        )}
      </details>
    </section>
  );
}
