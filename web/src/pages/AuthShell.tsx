import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "../components/LanguageToggle";

/** Centered branded card used by the login / MFA / onboarding screens. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width="34" height="34" />
          <h1>{t("app.title")}</h1>
          <div className="auth-lang">
            <LanguageToggle />
          </div>
        </div>
        <h2 className="auth-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Map a backend error code to a localized message (falls back to a generic one). */
export function authErr(t: (k: string, o?: Record<string, unknown>) => string, code?: string): string {
  if (!code) return t("auth.loginError");
  return t(`auth.err.${code}`, { defaultValue: t("auth.loginError") });
}
