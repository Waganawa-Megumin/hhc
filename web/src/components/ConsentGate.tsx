import { useTranslation } from "react-i18next";

export function ConsentGate({ consented, onChange }: { consented: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div className="consent-gate">
      <p className="consent-title">{t("interpret.consentTitle")}</p>
      <p className="consent-body">{t("interpret.consentBody")}</p>
      <label className="indicator consent">
        <input type="checkbox" checked={consented} onChange={(e) => onChange(e.target.checked)} />
        <span className="ind-body">
          <span className="ind-label">{t("interpret.consentCheck")}</span>
        </span>
      </label>
    </div>
  );
}
