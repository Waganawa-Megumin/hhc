import { useTranslation } from "react-i18next";

// Phase 2 fills this with the audit-log table + filters + summary.
export default function AuditPage() {
  const { t } = useTranslation();
  return (
    <section className="admin-audit">
      <h2>{t("admin.auditTitle")}</h2>
      <p className="muted">{t("admin.auditComingSoon")}</p>
    </section>
  );
}
