import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { authApi } from "../auth/api";
import { AuthShell, authErr } from "./AuthShell";

export default function InvitePage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const { refreshMe } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "valid" | "invalid">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await authApi.inviteInfo(token);
      if (r.ok && r.data.email) {
        setEmail(r.data.email);
        setState("valid");
      } else setState("invalid");
    })();
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError(t("onboarding.mismatch"));
    if (password.length < 10) return setError(t("auth.err.weak_password"));
    setBusy(true);
    const r = await authApi.inviteAccept(token, password);
    setBusy(false);
    if (!r.ok) return setError(authErr(t, r.data.error));
    await refreshMe();
    // New accounts must enroll MFA next; otherwise go straight in.
    navigate(r.data.mustEnrollMfa ? "/onboarding/mfa" : "/", { replace: true });
  }

  if (state === "loading") {
    return (
      <AuthShell title={t("invite.title")}>
        <div className="auth-loading">
          <span className="spinner" />
        </div>
      </AuthShell>
    );
  }
  if (state === "invalid") {
    return (
      <AuthShell title={t("invite.title")}>
        <p className="warn">{t("invite.invalid")}</p>
        <button type="button" className="ghost" onClick={() => navigate("/login")}>
          {t("auth.login")}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("invite.title")}>
      <p className="muted small">{t("invite.welcome", { email })}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>{t("onboarding.newPassword")}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="auth-field">
          <span>{t("onboarding.confirmPassword")}</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error ? <p className="warn small">{error}</p> : null}
        <button type="submit" className="primary auth-submit" disabled={busy || !password}>
          {busy ? <span className="spinner" /> : t("invite.setPassword")}
        </button>
      </form>
    </AuthShell>
  );
}
