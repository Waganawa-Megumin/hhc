// Higher-level user operations: first-admin bootstrap, admin-driven create/reset,
// and role/status changes that protect the "at least one active admin" invariant.
import { randomBytes } from "node:crypto";
import type { DB } from "../db/db";
import * as store from "../db/authStore";
import { hashPassword } from "./passwords";
import { createInvite } from "./invitations";
import { env } from "../env";
import type { Role, UserRow } from "./types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Create the first admin from env if the users table is empty (served/auth mode). */
export function bootstrapAdmin(db: DB): void {
  if (store.countUsers(db) > 0) return;
  const email = env.HHC_ADMIN_EMAIL.trim().toLowerCase();
  const pw = env.HHC_ADMIN_INITIAL_PASSWORD;
  if (!email || !pw) {
    throw new Error(
      "auth_bootstrap: no users exist — set HHC_ADMIN_EMAIL and HHC_ADMIN_INITIAL_PASSWORD to create the first admin.",
    );
  }
  store.insertUser(db, {
    email,
    passwordHash: hashPassword(pw),
    role: "admin",
    mustChangePassword: true,
    mustEnrollMfa: true,
  });
  // Log the email only — never the password.
  console.log(`[hhc-auth] bootstrap admin created: ${email} (must change password + enroll MFA at first login)`);
}

export function generateInitialPassword(): string {
  return randomBytes(14).toString("base64url"); // ~19 chars, strong
}

export interface CreateUserResult {
  user: UserRow;
  /** Single-use setup token (goes into the emailed invite link; never a password). */
  rawToken: string;
}
/** Add a user/admin as "invited": no usable password — they set one + enroll MFA via
 * the emailed invite link. */
export function adminCreateUser(db: DB, email: string, role: Role): CreateUserResult {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error("invalid_email");
  if (store.getUserByEmail(db, e)) throw new Error("email_taken");
  const unusable = hashPassword(randomBytes(24).toString("base64url")); // no one knows this
  const user = store.insertUser(db, {
    email: e,
    passwordHash: unusable,
    role,
    status: "invited",
    mustChangePassword: false,
    mustEnrollMfa: true,
  });
  const { rawToken } = createInvite(db, user.user_id, e);
  return { user, rawToken };
}

/** Re-issue a fresh invite for a still-invited user (the previous link is dropped). */
export function adminResendInvite(db: DB, userId: string): { rawToken: string; email: string } {
  const u = store.getUserById(db, userId);
  if (!u) throw new Error("not_found");
  if (u.status !== "invited") throw new Error("not_invited");
  const { rawToken } = createInvite(db, u.user_id, u.email);
  return { rawToken, email: u.email };
}

export function adminResetPassword(db: DB, userId: string): string {
  if (!store.getUserById(db, userId)) throw new Error("not_found");
  const pw = generateInitialPassword();
  store.setPasswordHash(db, userId, hashPassword(pw), true);
  store.deleteSessionsForUser(db, userId); // force re-login everywhere
  return pw;
}

export function adminSetRole(db: DB, userId: string, role: Role): void {
  const target = store.getUserById(db, userId);
  if (!target) throw new Error("not_found");
  if (target.role === "admin" && role !== "admin" && store.countActiveAdmins(db) <= 1) {
    throw new Error("last_admin");
  }
  store.setRole(db, userId, role);
}

export function adminSetStatus(db: DB, userId: string, status: "active" | "disabled"): void {
  const target = store.getUserById(db, userId);
  if (!target) throw new Error("not_found");
  if (status === "disabled" && target.role === "admin" && store.countActiveAdmins(db) <= 1) {
    throw new Error("last_admin");
  }
  store.setStatus(db, userId, status);
  if (status === "disabled") store.deleteSessionsForUser(db, userId);
}

/** Force a user to re-enroll MFA (resets their method to 'none'). */
export function adminForceMfa(db: DB, userId: string): void {
  if (!store.getUserById(db, userId)) throw new Error("not_found");
  store.setMfaMethod(db, userId, "none", false);
  store.deleteSessionsForUser(db, userId);
}
