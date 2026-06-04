import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS } from "../i18n";

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const current = i18n.language.startsWith("en") ? "en" : "ja";

  return (
    <div className="lang-toggle" role="group" aria-label={t("lang.label")}>
      {SUPPORTED_LANGS.map((lng) => (
        <button
          key={lng}
          type="button"
          className={current === lng ? "lang-btn active" : "lang-btn"}
          aria-pressed={current === lng}
          onClick={() => void i18n.changeLanguage(lng)}
        >
          {t(`lang.${lng}`)}
        </button>
      ))}
    </div>
  );
}
