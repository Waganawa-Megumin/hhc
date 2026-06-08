// Auth domain types + Fastify request augmentation. Roles are exactly Admin/User.
export type Role = "admin" | "user";
export type MfaMethod = "none" | "totp" | "email";
// "invited" = created by an admin, awaiting first setup via the emailed invite link
// (no usable password yet); becomes "active" once the invite is accepted.
export type UserStatus = "active" | "disabled" | "invited";

export interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  mfa_method: MfaMethod;
  mfa_enrolled: number; // 0/1
  must_change_password: number; // 0/1
  must_enroll_mfa: number; // 0/1
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  mfa_satisfied: number; // 0/1
  user_agent: string | null;
  ip: string | null;
}

export interface MfaRow {
  user_id: string;
  totp_secret_enc: string | null;
  totp_confirmed_at: string | null;
  email_code_hash: string | null;
  email_code_expires: string | null;
  email_code_sent_at: string | null;
  email_code_attempts: number;
}

/** What the auth hook attaches to the request after validating the session. */
export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  mustEnrollMfa: boolean;
}

/** Safe user view returned to the client (never the password hash / secrets). */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  mfaMethod: MfaMethod;
  mfaEnrolled: boolean;
  mustChangePassword: boolean;
  mustEnrollMfa: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.user_id,
    email: u.email,
    role: u.role,
    status: u.status,
    mfaMethod: u.mfa_method,
    mfaEnrolled: u.mfa_enrolled === 1,
    mustChangePassword: u.must_change_password === 1,
    mustEnrollMfa: u.must_enroll_mfa === 1,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by the onRequest auth hook for authenticated routes. */
    auth?: AuthContext;
  }
}
