import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { authApi } from "../auth/api";
import { AuthShell, authErr } from "./AuthShell";

type Method = "totp" | "email";

export default function MfaEnrollPage() {
  const { t } = useTranslation();
  const { status, user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (status === "anon" || status === "disabled") navigate("/login", { replace: true });
    else if (status === "authed" && user?.mustChangePassword) navigate("/onboarding/password", { replace: true });
    else if (status === "authed" && user && !user.mustEnrollMfa) navigate("/", { replace: true });
  }, [status, user, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function startTotp() {
    setError(null);
    const r = await authApi.mfaEnroll("totp");
    if (!r.ok) return setError(authErr(t, r.data.error));
    setQr(r.data.qrDataUrl ?? null);
    setSecret(r.data.secret ?? null);
    setMethod("totp");
  }
  async function startEmail() {
    setError(null);
    const r = await authApi.mfaEnroll("email");
    if (!r.ok) return setError(authErr(t, r.data.error));
    setEmailStatus(r.data.status ?? null);
    setMethod("email");
    setCooldown(45);
  }
  async function resendEmail() {
    const r = await authApi.mfaSend();
    if (r.status === 429) {
      setCooldown(r.data.retryInSec ?? 45);
      return;
    }
    setEmailStatus(r.data.status ?? null);
    setCooldown(45);
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!method) return;
    setBusy(true);
    setError(null);
    const r = await authApi.mfaConfirm(method, code.trim());
    setBusy(false);
    if (!r.ok) return setError(authErr(t, r.data.error));
    await refreshMe();
    navigate("/", { replace: true });
  }

  return (
    <AuthShell title={t("mfa.enrollTitle")}>
      {!method ? (
        <div className="auth-form">
          <p className="muted small">{t("onboarding.mustEnroll")}</p>
          <button type="button" className="primary auth-submit" onClick={startTotp}>
            {t("mfa.methodTotp")}
          </button>
          <button type="button" className="ghost auth-submit" onClick={startEmail}>
            {t("mfa.methodEmail")}
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={confirm}>
          {method === "totp" ? (
            <>
              <p className="muted small">{t("mfa.scanQr")}</p>
              {qr ? <img className="mfa-qr" src={qr} alt="TOTP QR" /> : null}
              {secret ? (
                <p className="muted small mfa-secret">
                  {t("mfa.manualSecret")}: <code>{secret}</code>
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="muted small">{t("mfa.emailMfaHint")}</p>
              {emailStatus && emailStatus !== "sent" ? <p className="warn small">{t("mfa.smtpUnavailable")}</p> : null}
              <div className="auth-resend">
                <button type="button" className="ghost" onClick={resendEmail} disabled={cooldown > 0}>
                  {cooldown > 0 ? t("mfa.resendIn", { s: cooldown }) : t("mfa.resend")}
                </button>
              </div>
            </>
          )}
          <label className="auth-field">
            <span>{t("mfa.code")}</span>
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          {error ? <p className="warn small">{error}</p> : null}
          <button type="submit" className="primary auth-submit" disabled={busy || code.length < 6}>
            {busy ? <span className="spinner" /> : t("mfa.confirm")}
          </button>
          <button type="button" className="ghost" onClick={() => setMethod(null)}>
            {t("mfa.back")}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
