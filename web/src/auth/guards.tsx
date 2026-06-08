import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

function Loading() {
  return (
    <div className="auth-loading">
      <span className="spinner" />
    </div>
  );
}

/** Gate normal app routes: redirect to login / MFA / onboarding as needed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "disabled") return <>{children}</>; // auth off → app is open
  if (status === "anon") return <Navigate to="/login" replace />;
  if (status === "mfa") return <Navigate to="/mfa" replace />;
  if (user?.mustChangePassword) return <Navigate to="/onboarding/password" replace />;
  if (user?.mustEnrollMfa) return <Navigate to="/onboarding/mfa" replace />;
  return <>{children}</>;
}

/** Admin-only routes. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "disabled") return <Navigate to="/" replace />; // no admin when auth is off
  if (status !== "authed") return <Navigate to="/login" replace />;
  if (user?.mustChangePassword) return <Navigate to="/onboarding/password" replace />;
  if (user?.mustEnrollMfa) return <Navigate to="/onboarding/mfa" replace />;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
