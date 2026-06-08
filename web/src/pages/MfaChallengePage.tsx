import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { authApi } from "../auth/api";
import { AuthShell, authErr } from "./AuthShell";

export default function MfaChallengePage() {
  const { t } = useTranslation();
  const { status, mfaMethod, emailSend, submitMfa } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (status === "anon" || status === "disabled") navigate("/login", { replace: true });
    else if (status === "authed") navigate("/", { replace: true });
  }, [status, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await submitMfa(code.trim());
    setBusy(false);
    if (!r.ok) setError(authErr(t, r.error));
    else navigate("/", { replace: true });
  }

  async function resend() {
    setResendMsg(null);
    const r = await authApi.mfaResend();
    if (r.status === 429) {
      setCooldown(r.data.retryInSec ?? 45);
      setResendMsg(t("mfa.resendCooldownMsg"));
      return;
    }
    const s = r.data.status;
    setResendMsg(s === "sent" ? t("mfa.codeSent") : t("mfa.sendFailed"));
    setCooldown(45);
  }

  return (
    <AuthShell title={t("mfa.title")}>
      <form className="auth-form" onSubmit={submit}>
        <p className="muted small">{mfaMethod === "email" ? t("mfa.enterCodeEmail") : t("mfa.enterCodeTotp")}</p>
        {mfaMethod === "email" && emailSend && emailSend !== "sent" ? (
          <p className="warn small">{t("mfa.smtpUnavailable")}</p>
        ) : null}
        <label className="auth-field">
          <span>{t("mfa.code")}</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        {error ? <p className="warn small">{error}</p> : null}
        <button type="submit" className="primary auth-submit" disabled={busy || code.length < 6}>
          {busy ? <span className="spinner" /> : t("mfa.verify")}
        </button>
        {mfaMethod === "email" ? (
          <div className="auth-resend">
            <button type="button" className="ghost" onClick={resend} disabled={cooldown > 0}>
              {cooldown > 0 ? t("mfa.resendIn", { s: cooldown }) : t("mfa.resend")}
            </button>
            {resendMsg ? <span className="muted small">{resendMsg}</span> : null}
          </div>
        ) : null}
      </form>
    </AuthShell>
  );
}
