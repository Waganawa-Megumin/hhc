import { useTranslation } from "react-i18next";
import {
  CATEGORIES,
  indicatorsByCategory,
  coefficientIndicators,
  matchesConcernOrigin,
  ORIGIN_NEXUS_NOTE,
  type CategoryId,
  type Indicator,
  type WatchlistIndicator,
} from "@hhc/shared";
import { useLang } from "../i18n";
import type { ChecklistController, CoefficientId } from "../state/useChecklist";

const WEIGHT_CATEGORIES: CategoryId[] = ["A", "B", "C", "D"];

function SuggestionHint({ c, id }: { c: ChecklistController; id: string }) {
  const { t } = useTranslation();
  const s = c.suggestions[id];
  if (!s) return null;
  return (
    <span className="ai-suggest">
      <span className="ai-suggest-tag">{t("interpret.aiSuggest", { confidence: s.confidence })}</span> {s.rationale}
    </span>
  );
}

function rowClass(c: ChecklistController, id: string): string {
  return c.suggestions[id] ? "indicator suggested" : "indicator";
}

export function Checklist({ c }: { c: ChecklistController }) {
  const { t } = useTranslation();
  const lang = useLang();

  return (
    <section className="checklist" aria-label={t("checklist.heading")}>
      <div className="section-head">
        <h2>{t("checklist.heading")}</h2>
        <div className="section-head-actions">
          <span className="muted">{t("checklist.selectedCount", { count: c.selected.size })}</span>
          <button type="button" className="ghost" onClick={c.reset}>
            {t("checklist.reset")}
          </button>
        </div>
      </div>

      {WEIGHT_CATEGORIES.map((cat) => (
        <fieldset key={cat} className="cat">
          <legend>
            <span className="cat-id">{cat}</span> {CATEGORIES[cat].label[lang]}
          </legend>
          {indicatorsByCategory(cat).map((ind) => (
            <label key={ind.id} className={rowClass(c, ind.id)}>
              <input type="checkbox" checked={c.selected.has(ind.id)} onChange={() => c.toggle(ind.id)} />
              <span className="ind-body">
                <span className="ind-label">
                  <span className="ind-id">{ind.id}</span> {ind.label[lang]}
                  {"critical" in ind && ind.critical ? <span className="crit-badge">★</span> : null}
                  <span className="weight-chip">+{"weight" in ind ? ind.weight : 0}</span>
                </span>
                <span className="ind-desc">{ind.description[lang]}</span>
                <SuggestionHint c={c} id={ind.id} />
              </span>
            </label>
          ))}
        </fieldset>
      ))}

      <GCategory c={c} />

      <FCategory c={c} />

      <fieldset className="cat coeff">
        <legend>
          <span className="cat-id">E</span> {t("checklist.coefficientsHeading")}
        </legend>
        {coefficientIndicators().map((ind) => {
          const id = ind.id as CoefficientId;
          return (
            <label key={ind.id} className="indicator">
              <input type="checkbox" checked={c.coefficients[id]} onChange={() => c.toggleCoefficient(id)} />
              <span className="ind-body">
                <span className="ind-label">
                  <span className="ind-id">{ind.id}</span> {ind.label[lang]}
                  <span className="weight-chip coeff-chip">×{ind.coefficient}</span>
                </span>
                <span className="ind-desc">{ind.description[lang]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}

function FCategory({ c }: { c: ChecklistController }) {
  const { t } = useTranslation();
  const lang = useLang();
  const fIndicators = indicatorsByCategory("F") as WatchlistIndicator[];

  return (
    <fieldset className="cat f-cat">
      <legend>
        <span className="cat-id">F</span> {t("f.heading")}
      </legend>
      {fIndicators.map((ind) => {
        if (ind.id === "F1") {
          return (
            <div key="F1" className="f1-block">
              <div className="ind-label">
                <span className="ind-id">F1</span> {ind.label[lang]}
                <span className="crit-badge">★</span>
                <span className="weight-chip">+{ind.weight}</span>
              </div>
              <p className="ind-desc">{ind.description[lang]}</p>
              <SuggestionHint c={c} id="F1" />
              <label className="indicator confirm">
                <input
                  type="checkbox"
                  checked={c.humanConfirmedF1}
                  onChange={(e) => c.setHumanConfirmedF1(e.target.checked)}
                />
                <span className="ind-body">
                  <span className="ind-label">{t("f.confirmF1")}</span>
                  {!c.humanConfirmedF1 ? <span className="pending">{t("f.f1Pending")}</span> : null}
                </span>
              </label>
            </div>
          );
        }
        if (ind.flagOnly) {
          return (
            <label key={ind.id} className={`${rowClass(c, ind.id)} f3`}>
              <input type="checkbox" checked={c.selected.has(ind.id)} onChange={() => c.toggle(ind.id)} />
              <span className="ind-body">
                <span className="ind-label">
                  <span className="ind-id">{ind.id}</span> {ind.label[lang]}
                  <span className="weight-chip zero">+0</span>
                </span>
                <span className="ind-desc">{t("f.f3Note")}</span>
                <SuggestionHint c={c} id={ind.id} />
              </span>
            </label>
          );
        }
        return (
          <label key={ind.id} className={rowClass(c, ind.id)}>
            <input type="checkbox" checked={c.selected.has(ind.id)} onChange={() => c.toggle(ind.id)} />
            <span className="ind-body">
              <span className="ind-label">
                <span className="ind-id">{ind.id}</span> {ind.label[lang]}
                <span className="weight-chip">+{ind.weight}</span>
              </span>
              <span className="ind-desc">{ind.description[lang]}</span>
              <SuggestionHint c={c} id={ind.id} />
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function GCategory({ c }: { c: ChecklistController }) {
  const { t } = useTranslation();
  const lang = useLang();
  const g1 = indicatorsByCategory("G")[0] as Indicator | undefined;
  if (!g1) return null;
  const matched = matchesConcernOrigin(c.nationalityContext, c.concernOrigins);
  const g1Selected = c.selected.has("G1");

  return (
    <fieldset className="cat g-cat">
      <legend>
        <span className="cat-id">G</span> {CATEGORIES.G.label[lang]}
      </legend>

      <label className="indicator">
        <input type="checkbox" checked={g1Selected} onChange={() => c.toggle("G1")} />
        <span className="ind-body">
          <span className="ind-label">
            <span className="ind-id">G1</span> {g1.label[lang]}
            <span className="weight-chip">+{"weight" in g1 ? g1.weight : 0}</span>
          </span>
          <span className="ind-desc">{g1.description[lang]}</span>
          <SuggestionHint c={c} id="G1" />
        </span>
      </label>

      <input
        type="text"
        className="nationality-input"
        value={c.nationalityContext}
        placeholder={t("nationality.placeholder")}
        onChange={(e) => c.setNationalityContext(e.target.value)}
      />
      {matched && !g1Selected ? (
        <div className="nexus-suggest">
          {t("nationality.matched")}
          <button type="button" className="primary small-btn" onClick={() => c.toggle("G1")}>
            {t("nationality.addG1")}
          </button>
        </div>
      ) : null}

      <details className="concern-editor">
        <summary>{t("nationality.concernHeading")}</summary>
        <input
          type="text"
          className="nationality-input"
          value={c.concernOrigins.join(", ")}
          onChange={(e) =>
            c.setConcernOrigins(
              e.target.value
                .split(/[,、]/)
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </details>

      <p className="ind-desc note">{ORIGIN_NEXUS_NOTE[lang]}</p>
    </fieldset>
  );
}
