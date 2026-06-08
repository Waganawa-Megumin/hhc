// Thin fetch wrappers for the auth + admin endpoints. All use credentials:"include"
// so the httpOnly session cookie rides along (same-origin in dev via the Vite proxy
// and in served mode where Fastify is the edge).
import type { MfaMethod, PublicUser, Role } from "./types";

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  ok: boolean;
  data: T & { error?: string };
}

const JSON_HEADERS = { "content-type": "application/json" };

async function req<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? JSON_HEADERS : undefined,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { status: res.status, ok: res.ok, data };
}

export const authApi = {
  me: () => req<{ user: PublicUser }>("GET", "/api/auth/me"),
  login: (email: string, password: string) =>
    req<{ mfaRequired: boolean; method?: MfaMethod; emailSend?: string; user?: PublicUser; mustChangePassword?: boolean; mustEnrollMfa?: boolean }>(
      "POST",
      "/api/auth/login",
      { email, password },
    ),
  mfa: (code: string) => req<{ user: PublicUser }>("POST", "/api/auth/mfa", { code }),
  mfaResend: () => req<{ status: string; retryInSec?: number }>("POST", "/api/auth/mfa/resend"),
  logout: () => req("POST", "/api/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ mustEnrollMfa: boolean }>("POST", "/api/auth/change-password", { currentPassword, newPassword }),
  mfaEnroll: (method: "totp" | "email") =>
    req<{ method: MfaMethod; qrDataUrl?: string; otpauthUri?: string; secret?: string; status?: string }>(
      "POST",
      "/api/auth/mfa/enroll",
      { method },
    ),
  mfaSend: () => req<{ status: string; retryInSec?: number }>("POST", "/api/auth/mfa/send"),
  mfaConfirm: (method: "totp" | "email", code: string) =>
    req<{ user: PublicUser }>("POST", "/api/auth/mfa/confirm", { method, code }),

  // invitation setup (public)
  inviteInfo: (token: string) => req<{ email: string }>("GET", `/api/invite/${encodeURIComponent(token)}`),
  inviteAccept: (token: string, password: string) =>
    req<{ user: PublicUser; mustEnrollMfa: boolean }>("POST", "/api/invite/accept", { token, password }),

  // admin
  adminListUsers: () => req<{ users: PublicUser[] }>("GET", "/api/admin/users"),
  adminCreateUser: (email: string, role: Role) =>
    req<{ user: PublicUser; inviteLink: string; emailStatus: string }>("POST", "/api/admin/users", { email, role }),
  adminPatchUser: (
    id: string,
    body: {
      action: "set-role" | "set-status" | "reset-password" | "force-mfa" | "resend-invite";
      role?: Role;
      status?: "active" | "disabled";
    },
  ) => req<{ initialPassword?: string; inviteLink?: string; emailStatus?: string }>("PATCH", `/api/admin/users/${id}`, body),

  adminAudit: (qs: string) =>
    req<{ rows: AuditRow[]; total: number; limit: number; offset: number }>("GET", `/api/admin/audit${qs}`),
  adminAuditSummary: (qs: string) => req<{ summary: AuditSummary }>("GET", `/api/admin/audit/summary${qs}`),
};

export interface AuditRow {
  id: number;
  ts: string;
  user_id: string | null;
  email: string | null;
  action: string;
  route: string;
  method: string;
  status: number;
  ip: string | null;
  user_agent: string | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  geo_status: string | null;
  detail: string | null;
}
export interface AuditSummary {
  total: number;
  byAction: { action: string; count: number }[];
  byDay: { day: string; count: number }[];
  failedLogins: number;
}
