import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { authApi } from "../auth/api";
import { AuthShell, authErr } from "./AuthShell";

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const { status, user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "anon" || status === "disabled") navigate("/login", { replace: true });
    else if (status === "authed" && user && !user.mustChangePassword) {
      navigate(user.mustEnrollMfa ? "/onboarding/mfa" : "/", { replace: true });
    }
  }, [status, user, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError(t("onboarding.mismatch"));
    if (next.length < 10) return setError(t("auth.err.weak_password"));
    setBusy(true);
    const r = await authApi.changePassword(current, next);
    setBusy(false);
    if (!r.ok) return setError(authErr(t, r.data.error));
    await refreshMe();
    navigate(r.data.mustEnrollMfa ? "/onboarding/mfa" : "/", { replace: true });
  }

  return (
    <AuthShell title={t("onboarding.changePasswordTitle")}>
      <p className="muted small">{t("onboarding.mustChange")}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>{t("onboarding.currentPassword")}</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="auth-field">
          <span>{t("onboarding.newPassword")}</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="auth-field">
          <span>{t("onboarding.confirmPassword")}</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error ? <p className="warn small">{error}</p> : null}
        <button type="submit" className="primary auth-submit" disabled={busy || !current || !next}>
          {busy ? <span className="spinner" /> : t("onboarding.changePassword")}
        </button>
      </form>
    </AuthShell>
  );
}
