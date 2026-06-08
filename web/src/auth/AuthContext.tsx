import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi } from "./api";
import { getAgentHealth } from "../api/httpAgentClient";
import type { MfaMethod, PublicUser } from "./types";

// "disabled" = the backend runs with HHC_AUTH off (today's keyless/local mode), so
// the app is open and no login is shown. Otherwise the normal auth flow applies.
type Status = "loading" | "disabled" | "anon" | "mfa" | "authed";

interface LoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  error?: string;
}

interface AuthValue {
  status: Status;
  user: PublicUser | null;
  /** During the MFA challenge: which method to prompt for. */
  mfaMethod: MfaMethod | null;
  /** Last email-send status (so the challenge screen can warn if it failed). */
  emailSend: string | null;
  isAdmin: boolean;
  needsOnboarding: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  submitMfa: (code: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [mfaMethod, setMfaMethod] = useState<MfaMethod | null>(null);
  const [emailSend, setEmailSend] = useState<string | null>(null);

  async function refreshMe(): Promise<void> {
    const r = await authApi.me();
    if (r.status === 200 && r.data.user) {
      setUser(r.data.user);
      setStatus("authed");
    } else {
      setUser(null);
      setStatus("anon");
    }
  }

  useEffect(() => {
    void (async () => {
      // If the backend is unreachable or auth is off, run open (no login gate).
      const h = await getAgentHealth();
      if (!h || h.auth !== true) {
        setStatus("disabled");
        return;
      }
      await refreshMe();
    })();
  }, []);

  async function login(email: string, password: string): Promise<LoginResult> {
    const r = await authApi.login(email, password);
    if (r.ok && r.data.mfaRequired) {
      setMfaMethod((r.data.method as MfaMethod) ?? "totp");
      setEmailSend(r.data.emailSend ?? null);
      setStatus("mfa");
      return { ok: true, mfaRequired: true };
    }
    if (r.ok && r.data.user) {
      setUser(r.data.user);
      setStatus("authed");
      return { ok: true, mfaRequired: false };
    }
    return { ok: false, error: r.data.error };
  }

  async function submitMfa(code: string): Promise<{ ok: boolean; error?: string }> {
    const r = await authApi.mfa(code);
    if (r.ok && r.data.user) {
      setUser(r.data.user);
      setStatus("authed");
      setMfaMethod(null);
      return { ok: true };
    }
    return { ok: false, error: r.data.error };
  }

  async function logout(): Promise<void> {
    await authApi.logout();
    setUser(null);
    setMfaMethod(null);
    setStatus("anon");
  }

  const value: AuthValue = {
    status,
    user,
    mfaMethod,
    emailSend,
    isAdmin: user?.role === "admin",
    needsOnboarding: !!user && (user.mustChangePassword || user.mustEnrollMfa),
    login,
    submitMfa,
    logout,
    refreshMe,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}
