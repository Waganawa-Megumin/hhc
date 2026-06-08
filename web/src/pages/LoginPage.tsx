import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthShell, authErr } from "./AuthShell";

export default function LoginPage() {
  const { t } = useTranslation();
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "disabled" || status === "authed") navigate("/", { replace: true });
    else if (status === "mfa") navigate("/mfa", { replace: true });
  }, [status, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await login(email.trim().toLowerCase(), password);
    setBusy(false);
    if (!r.ok) {
      setError(authErr(t, r.error));
      return;
    }
    navigate(r.mfaRequired ? "/mfa" : "/", { replace: true });
  }

  return (
    <AuthShell title={t("auth.loginHeading")}>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>{t("auth.email")}</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>{t("auth.password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="warn small">{error}</p> : null}
        <button type="submit" className="primary auth-submit" disabled={busy || !email || !password}>
          {busy ? <span className="spinner" /> : t("auth.login")}
        </button>
      </form>
    </AuthShell>
  );
}
