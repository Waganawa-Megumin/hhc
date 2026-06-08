// DB access layer for auth (users / mfa / sessions / login_attempts). Mirrors
// store.ts: every function takes a `DB` handle, so it is unit-testable against
// openTestDb(). Booleans are stored as 0/1 (better-sqlite3 rejects JS booleans).
import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import type { MfaMethod, MfaRow, Role, SessionRow, UserRow, UserStatus } from "../auth/types";

const nowIso = (): string => new Date().toISOString();

// ── users ───────────────────────────────────────────────────────────────────
export function getUserByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as UserRow | undefined;
}
export function getUserById(db: DB, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(id) as UserRow | undefined;
}
export function listUsers(db: DB): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
}
export function countUsers(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}
export function countActiveAdmins(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").get() as { n: number })
    .n;
}

export interface InsertUserArgs {
  email: string;
  passwordHash: string;
  role: Role;
  mustChangePassword?: boolean;
  mustEnrollMfa?: boolean;
}
export function insertUser(db: DB, a: InsertUserArgs): UserRow {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO users
       (user_id, email, password_hash, role, status, mfa_method, mfa_enrolled,
        must_change_password, must_enroll_mfa, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 'none', 0, ?, ?, ?, ?)`,
  ).run(id, a.email.toLowerCase(), a.passwordHash, a.role, a.mustChangePassword ? 1 : 0, a.mustEnrollMfa ? 1 : 0, ts, ts);
  db.prepare("INSERT INTO mfa (user_id) VALUES (?)").run(id);
  return getUserById(db, id)!;
}

export function setPasswordHash(db: DB, userId: string, hash: string, mustChange = false): void {
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE user_id = ?").run(
    hash,
    mustChange ? 1 : 0,
    nowIso(),
    userId,
  );
}
export function setRole(db: DB, userId: string, role: Role): void {
  db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?").run(role, nowIso(), userId);
}
export function setStatus(db: DB, userId: string, status: UserStatus): void {
  db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE user_id = ?").run(status, nowIso(), userId);
}
export function setMustEnrollMfa(db: DB, userId: string, must: boolean): void {
  db.prepare("UPDATE users SET must_enroll_mfa = ?, updated_at = ? WHERE user_id = ?").run(
    must ? 1 : 0,
    nowIso(),
    userId,
  );
}
/** Mark an MFA method enrolled (clears the must-enroll flag) or reset to 'none'. */
export function setMfaMethod(db: DB, userId: string, method: MfaMethod, enrolled: boolean): void {
  db.prepare(
    "UPDATE users SET mfa_method = ?, mfa_enrolled = ?, must_enroll_mfa = ?, updated_at = ? WHERE user_id = ?",
  ).run(method, enrolled ? 1 : 0, enrolled ? 0 : 1, nowIso(), userId);
}
export function setLastLogin(db: DB, userId: string): void {
  db.prepare("UPDATE users SET last_login_at = ? WHERE user_id = ?").run(nowIso(), userId);
}

// ── mfa secrets / email codes ─────────────────────────────────────────────────
export function getMfa(db: DB, userId: string): MfaRow | undefined {
  return db.prepare("SELECT * FROM mfa WHERE user_id = ?").get(userId) as MfaRow | undefined;
}
export function setTotpSecret(db: DB, userId: string, sealedSecret: string): void {
  db.prepare("UPDATE mfa SET totp_secret_enc = ?, totp_confirmed_at = NULL WHERE user_id = ?").run(
    sealedSecret,
    userId,
  );
}
export function confirmTotp(db: DB, userId: string): void {
  db.prepare("UPDATE mfa SET totp_confirmed_at = ? WHERE user_id = ?").run(nowIso(), userId);
}
export function setEmailCode(db: DB, userId: string, codeHash: string, expiresIso: string): void {
  db.prepare(
    "UPDATE mfa SET email_code_hash = ?, email_code_expires = ?, email_code_sent_at = ?, email_code_attempts = 0 WHERE user_id = ?",
  ).run(codeHash, expiresIso, nowIso(), userId);
}
export function incEmailCodeAttempts(db: DB, userId: string): void {
  db.prepare("UPDATE mfa SET email_code_attempts = email_code_attempts + 1 WHERE user_id = ?").run(userId);
}
export function clearEmailCode(db: DB, userId: string): void {
  db.prepare(
    "UPDATE mfa SET email_code_hash = NULL, email_code_expires = NULL, email_code_attempts = 0 WHERE user_id = ?",
  ).run(userId);
}

// ── sessions ──────────────────────────────────────────────────────────────────
export interface CreateSessionArgs {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  mfaSatisfied: boolean;
  ip?: string | null;
  userAgent?: string | null;
}
export function createSession(db: DB, a: CreateSessionArgs): string {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO sessions
       (session_id, user_id, token_hash, created_at, last_seen_at, expires_at, mfa_satisfied, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, a.userId, a.tokenHash, ts, ts, a.expiresAt, a.mfaSatisfied ? 1 : 0, a.userAgent ?? null, a.ip ?? null);
  return id;
}
/** A session joined with its user (active users only). */
export interface SessionWithUser extends SessionRow {
  email: string;
  role: Role;
  user_status: UserStatus;
  must_change_password: number;
  must_enroll_mfa: number;
}
export function findSessionByTokenHash(db: DB, tokenHash: string): SessionWithUser | undefined {
  return db
    .prepare(
      `SELECT s.*, u.email AS email, u.role AS role, u.status AS user_status,
              u.must_change_password AS must_change_password, u.must_enroll_mfa AS must_enroll_mfa
         FROM sessions s JOIN users u ON u.user_id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as SessionWithUser | undefined;
}
export function touchSession(db: DB, sessionId: string): void {
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?").run(nowIso(), sessionId);
}
export function markSessionMfaSatisfied(db: DB, sessionId: string, expiresAt: string): void {
  db.prepare("UPDATE sessions SET mfa_satisfied = 1, expires_at = ?, last_seen_at = ? WHERE session_id = ?").run(
    expiresAt,
    nowIso(),
    sessionId,
  );
}
export function deleteSession(db: DB, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
}
export function deleteSessionsForUser(db: DB, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
export function sweepExpiredSessions(db: DB): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
}

// ── login attempts / lockout ──────────────────────────────────────────────────
export function recordLoginAttempt(
  db: DB,
  a: { email: string; ip?: string | null; success: boolean; reason?: string },
): void {
  db.prepare("INSERT INTO login_attempts (email, ip, ts, success, reason) VALUES (?, ?, ?, ?, ?)").run(
    a.email.toLowerCase(),
    a.ip ?? null,
    nowIso(),
    a.success ? 1 : 0,
    a.reason ?? null,
  );
}
/** Recent FAILED attempts for this email OR ip since `sinceIso` (lockout input). */
export function countRecentFailures(db: DB, email: string, ip: string | null, sinceIso: string): number {
  const byEmail = (
    db
      .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND email = ? AND ts >= ?")
      .get(email.toLowerCase(), sinceIso) as { n: number }
  ).n;
  const byIp = ip
    ? (db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND ip = ? AND ts >= ?").get(ip, sinceIso) as {
        n: number;
      }).n
    : 0;
  return Math.max(byEmail, byIp);
}
