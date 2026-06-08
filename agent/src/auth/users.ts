// Higher-level user operations: first-admin bootstrap, admin-driven create/reset,
// and role/status changes that protect the "at least one active admin" invariant.
import { randomBytes } from "node:crypto";
import type { DB } from "../db/db";
import * as store from "../db/authStore";
import { hashPassword } from "./passwords";
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
  /** The generated password, returned ONCE, only when HHC generated it. */
  initialPassword: string | null;
}
export function adminCreateUser(db: DB, email: string, role: Role, initialPassword?: string): CreateUserResult {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error("invalid_email");
  if (store.getUserByEmail(db, e)) throw new Error("email_taken");
  const generated = !initialPassword || initialPassword.length < 10;
  const pw = generated ? generateInitialPassword() : initialPassword!;
  const user = store.insertUser(db, {
    email: e,
    passwordHash: hashPassword(pw),
    role,
    mustChangePassword: true,
    mustEnrollMfa: true,
  });
  return { user, initialPassword: generated ? pw : null };
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
