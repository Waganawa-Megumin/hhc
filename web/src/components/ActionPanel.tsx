import { useTranslation } from "react-i18next";
import { BAND_GUIDANCE, type Band } from "@hhc/shared";
import { useLang } from "../i18n";

export function ActionPanel({ band }: { band: Band }) {
  const { t } = useTranslation();
  const lang = useLang();
  const guidance = BAND_GUIDANCE[band];

  return (
    <section className={`action-panel band-${band}`} aria-label={t("action.heading")}>
      <h2>{t("action.heading")}</h2>
      <p className="action-4r">{guidance.action4R[lang]}</p>
      <p className="action-detail">{guidance.detail[lang]}</p>
    </section>
  );
}
