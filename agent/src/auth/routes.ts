// Auth + admin route registration, mounted on the /api scope. Login is two-step
// (password → MFA challenge → session); onboarding (change password, enroll MFA)
// is forced for fresh accounts. Errors are intentionally generic to resist
// account enumeration; secrets/codes are never returned over HTTP.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { DB } from "../db/db";
import * as store from "../db/authStore";
import { requireRole } from "./hook";
import { hashPassword, passwordTooWeak, verifyPassword } from "./passwords";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  absoluteExpiry,
  challengeExpiry,
  newSessionToken,
  sessionCookieOptions,
  sha256hex,
} from "./sessions";
import { generateTotpSecret, totpKeyUri, totpQrDataUrl, verifyTotp } from "./totp";
import { seal, open } from "./secretBox";
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MS,
  EMAIL_RESEND_COOLDOWN_MS,
  generateEmailCode,
  hashCode,
  sendEmailCode,
  verifyCodeHash,
} from "./mfaEmail";
import {
  adminCreateUser,
  adminForceMfa,
  adminResetPassword,
  adminSetRole,
  adminSetStatus,
} from "./users";
import { queryAudit, summarizeAudit } from "../db/auditStore";
import { toPublicUser } from "./types";
import { env } from "../env";

const CHALLENGE_TTL_SEC = 5 * 60;

function setSessionCookie(reply: FastifyReply, raw: string, maxAgeSec: number): void {
  reply.setCookie(SESSION_COOKIE, raw, sessionCookieOptions(maxAgeSec));
}
function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function registerAuthRoutes(api: FastifyInstance, getDb: () => DB): void {
  // ── login: password step ───────────────────────────────────────────────────
  api.post("/auth/login", async (req, reply) => {
    const parsed = z.object({ email: z.string(), password: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const email = parsed.data.email.trim().toLowerCase();
    const db = getDb();
    const ip = req.ip;

    const since = new Date(Date.now() - env.HHC_LOGIN_WINDOW_MIN * 60_000).toISOString();
    if (store.countRecentFailures(db, email, ip, since) >= env.HHC_LOGIN_MAX_FAILS) {
      store.recordLoginAttempt(db, { email, ip, success: false, reason: "locked" });
      return reply.code(429).send({ error: "locked" });
    }

    const user = store.getUserByEmail(db, email);
    if (!user || user.status !== "active" || !verifyPassword(parsed.data.password, user.password_hash)) {
      store.recordLoginAttempt(db, { email, ip, success: false, reason: "invalid_credentials" });
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const enrolled = user.mfa_enrolled === 1 && user.mfa_method !== "none";
    const { raw, hash } = newSessionToken();
    if (!enrolled) {
      // No MFA yet (e.g. bootstrap admin) → full session; UI will force onboarding.
      store.createSession(db, {
        userId: user.user_id,
        tokenHash: hash,
        expiresAt: absoluteExpiry(),
        mfaSatisfied: true,
        ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      store.setLastLogin(db, user.user_id);
      store.recordLoginAttempt(db, { email, ip, success: true, reason: "no_mfa" });
      setSessionCookie(reply, raw, SESSION_TTL_SEC());
      return reply.send({
        ok: true,
        mfaRequired: false,
        user: toPublicUser(user),
        mustChangePassword: user.must_change_password === 1,
        mustEnrollMfa: user.must_enroll_mfa === 1,
      });
    }

    // MFA enrolled → short-lived challenge session (not yet authenticated).
    store.createSession(db, {
      userId: user.user_id,
      tokenHash: hash,
      expiresAt: challengeExpiry(),
      mfaSatisfied: false,
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
    setSessionCookie(reply, raw, CHALLENGE_TTL_SEC);
    let emailSend: string | undefined;
    if (user.mfa_method === "email") {
      const code = generateEmailCode();
      store.setEmailCode(db, user.user_id, hashCode(code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString());
      emailSend = await sendEmailCode(user.email, code);
    }
    return reply.send({ ok: true, mfaRequired: true, method: user.mfa_method, emailSend });
  });

  // ── login: MFA step ─────────────────────────────────────────────────────────
  api.post("/auth/mfa", async (req, reply) => {
    const parsed = z.object({ code: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const db = getDb();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: "no_challenge" });
    const sess = store.findSessionByTokenHash(db, sha256hex(token));
    if (!sess || sess.mfa_satisfied === 1) return reply.code(401).send({ error: "no_challenge" });
    if (Date.now() >= Date.parse(sess.expires_at)) {
      store.deleteSession(db, sess.session_id);
      return reply.code(401).send({ error: "challenge_expired" });
    }
    const user = store.getUserById(db, sess.user_id);
    if (!user || user.status !== "active") return reply.code(401).send({ error: "no_challenge" });
    const mfa = store.getMfa(db, user.user_id);

    let ok = false;
    if (user.mfa_method === "totp" && mfa?.totp_secret_enc) {
      ok = verifyTotp(parsed.data.code, open(mfa.totp_secret_enc));
    } else if (user.mfa_method === "email" && mfa?.email_code_hash && mfa.email_code_expires) {
      const expired = Date.now() >= Date.parse(mfa.email_code_expires);
      const tooMany = mfa.email_code_attempts >= EMAIL_CODE_MAX_ATTEMPTS;
      ok = !expired && !tooMany && verifyCodeHash(parsed.data.code, mfa.email_code_hash);
      if (!ok) store.incEmailCodeAttempts(db, user.user_id);
    }

    if (!ok) {
      store.recordLoginAttempt(db, { email: user.email, ip: req.ip, success: false, reason: "mfa_fail" });
      return reply.code(401).send({ error: "invalid_code" });
    }

    store.markSessionMfaSatisfied(db, sess.session_id, absoluteExpiry());
    store.setLastLogin(db, user.user_id);
    store.clearEmailCode(db, user.user_id);
    store.recordLoginAttempt(db, { email: user.email, ip: req.ip, success: true, reason: "mfa_ok" });
    setSessionCookie(reply, token, SESSION_TTL_SEC());
    return reply.send({
      ok: true,
      user: toPublicUser(user),
      mustChangePassword: user.must_change_password === 1,
      mustEnrollMfa: user.must_enroll_mfa === 1,
    });
  });

  // ── resend the email MFA code during the login challenge ──────────────────────
  api.post("/auth/mfa/resend", async (req, reply) => {
    const db = getDb();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: "no_challenge" });
    const sess = store.findSessionByTokenHash(db, sha256hex(token));
    if (!sess || sess.mfa_satisfied === 1) return reply.code(401).send({ error: "no_challenge" });
    const user = store.getUserById(db, sess.user_id);
    if (!user || user.mfa_method !== "email") return reply.code(400).send({ error: "not_email_mfa" });
    const mfa = store.getMfa(db, user.user_id);
    if (mfa?.email_code_sent_at && Date.now() - Date.parse(mfa.email_code_sent_at) < EMAIL_RESEND_COOLDOWN_MS) {
      const retryInSec = Math.ceil(
        (EMAIL_RESEND_COOLDOWN_MS - (Date.now() - Date.parse(mfa.email_code_sent_at))) / 1000,
      );
      return reply.code(429).send({ error: "resend_cooldown", retryInSec });
    }
    const code = generateEmailCode();
    store.setEmailCode(db, user.user_id, hashCode(code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString());
    const status = await sendEmailCode(user.email, code);
    return reply.send({ ok: true, status });
  });

  // ── logout ────────────────────────────────────────────────────────────────────
  api.post("/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const db = getDb();
      const sess = store.findSessionByTokenHash(db, sha256hex(token));
      if (sess) store.deleteSession(db, sess.session_id);
    }
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  // ── who am I (authenticated) ───────────────────────────────────────────────────
  api.get("/auth/me", async (req, reply) => {
    const db = getDb();
    const user = store.getUserById(db, req.auth!.userId);
    if (!user) return reply.code(401).send({ error: "auth_required" });
    return reply.send({ ok: true, user: toPublicUser(user) });
  });

  // ── change password (also clears the must-change flag) ──────────────────────────
  api.post("/auth/change-password", async (req, reply) => {
    const parsed = z.object({ currentPassword: z.string(), newPassword: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const db = getDb();
    const user = store.getUserById(db, req.auth!.userId);
    if (!user) return reply.code(401).send({ error: "auth_required" });
    if (!verifyPassword(parsed.data.currentPassword, user.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (passwordTooWeak(parsed.data.newPassword)) return reply.code(400).send({ error: "weak_password" });
    store.setPasswordHash(db, user.user_id, hashPassword(parsed.data.newPassword), false);
    return reply.send({ ok: true, mustEnrollMfa: user.must_enroll_mfa === 1 });
  });

  // ── MFA enrollment (authenticated): start ────────────────────────────────────────
  api.post("/auth/mfa/enroll", async (req, reply) => {
    const parsed = z.object({ method: z.enum(["totp", "email"]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const db = getDb();
    const user = store.getUserById(db, req.auth!.userId);
    if (!user) return reply.code(401).send({ error: "auth_required" });

    if (parsed.data.method === "totp") {
      const secret = generateTotpSecret();
      store.setTotpSecret(db, user.user_id, seal(secret));
      const uri = totpKeyUri(user.email, secret);
      const qrDataUrl = await totpQrDataUrl(uri);
      // Secret is shown once for manual entry; never logged.
      return reply.send({ ok: true, method: "totp", qrDataUrl, otpauthUri: uri, secret });
    }
    // email: send a confirmation code now.
    const code = generateEmailCode();
    store.setEmailCode(db, user.user_id, hashCode(code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString());
    const status = await sendEmailCode(user.email, code);
    return reply.send({ ok: true, method: "email", status });
  });

  // ── MFA enrollment: resend the email confirmation code ───────────────────────────
  api.post("/auth/mfa/send", async (req, reply) => {
    const db = getDb();
    const user = store.getUserById(db, req.auth!.userId);
    if (!user) return reply.code(401).send({ error: "auth_required" });
    const mfa = store.getMfa(db, user.user_id);
    if (mfa?.email_code_sent_at && Date.now() - Date.parse(mfa.email_code_sent_at) < EMAIL_RESEND_COOLDOWN_MS) {
      const retryInSec = Math.ceil(
        (EMAIL_RESEND_COOLDOWN_MS - (Date.now() - Date.parse(mfa.email_code_sent_at))) / 1000,
      );
      return reply.code(429).send({ error: "resend_cooldown", retryInSec });
    }
    const code = generateEmailCode();
    store.setEmailCode(db, user.user_id, hashCode(code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString());
    const status = await sendEmailCode(user.email, code);
    return reply.send({ ok: true, status });
  });

  // ── MFA enrollment: confirm + activate ───────────────────────────────────────────
  api.post("/auth/mfa/confirm", async (req, reply) => {
    const parsed = z.object({ method: z.enum(["totp", "email"]), code: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const db = getDb();
    const user = store.getUserById(db, req.auth!.userId);
    if (!user) return reply.code(401).send({ error: "auth_required" });
    const mfa = store.getMfa(db, user.user_id);

    let ok = false;
    if (parsed.data.method === "totp" && mfa?.totp_secret_enc) {
      ok = verifyTotp(parsed.data.code, open(mfa.totp_secret_enc));
      if (ok) store.confirmTotp(db, user.user_id);
    } else if (parsed.data.method === "email" && mfa?.email_code_hash && mfa.email_code_expires) {
      const expired = Date.now() >= Date.parse(mfa.email_code_expires);
      ok = !expired && verifyCodeHash(parsed.data.code, mfa.email_code_hash);
      if (ok) store.clearEmailCode(db, user.user_id);
    }
    if (!ok) return reply.code(401).send({ error: "invalid_code" });

    store.setMfaMethod(db, user.user_id, parsed.data.method, true);
    const updated = store.getUserById(db, user.user_id)!;
    return reply.send({ ok: true, user: toPublicUser(updated) });
  });
}

export function registerAdminRoutes(api: FastifyInstance, getDb: () => DB): void {
  const adminOnly = { preHandler: requireRole("admin") };

  api.get("/admin/users", adminOnly, async (_req, reply) => {
    return reply.send({ ok: true, users: store.listUsers(getDb()).map(toPublicUser) });
  });

  api.post("/admin/users", adminOnly, async (req, reply) => {
    const parsed = z
      .object({ email: z.string(), role: z.enum(["admin", "user"]).default("user"), initialPassword: z.string().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    try {
      const { user, initialPassword } = adminCreateUser(getDb(), parsed.data.email, parsed.data.role, parsed.data.initialPassword);
      return reply.send({ ok: true, user: toPublicUser(user), initialPassword });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  api.patch<{ Params: { id: string } }>("/admin/users/:id", adminOnly, async (req, reply) => {
    const parsed = z
      .object({
        action: z.enum(["set-role", "set-status", "reset-password", "force-mfa"]),
        role: z.enum(["admin", "user"]).optional(),
        status: z.enum(["active", "disabled"]).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const db = getDb();
    const id = req.params.id;
    try {
      switch (parsed.data.action) {
        case "set-role":
          if (!parsed.data.role) return reply.code(400).send({ error: "bad_request" });
          adminSetRole(db, id, parsed.data.role);
          return reply.send({ ok: true });
        case "set-status":
          if (!parsed.data.status) return reply.code(400).send({ error: "bad_request" });
          adminSetStatus(db, id, parsed.data.status);
          return reply.send({ ok: true });
        case "reset-password":
          return reply.send({ ok: true, initialPassword: adminResetPassword(db, id) });
        case "force-mfa":
          adminForceMfa(db, id);
          return reply.send({ ok: true });
      }
    } catch (e) {
      const msg = (e as Error).message;
      const code = msg === "last_admin" ? 409 : msg === "not_found" ? 404 : 400;
      return reply.code(code).send({ error: msg });
    }
  });

  // ── audit log (Phase 2) ─────────────────────────────────────────────────────
  const AuditQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().optional(),
    action: z.string().optional(),
    status: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().optional(),
    offset: z.coerce.number().int().optional(),
  });

  api.get("/admin/audit", adminOnly, async (req, reply) => {
    const parsed = AuditQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    return reply.send({ ok: true, ...queryAudit(getDb(), parsed.data) });
  });

  api.get("/admin/audit/summary", adminOnly, async (req, reply) => {
    const parsed = AuditQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    return reply.send({ ok: true, summary: summarizeAudit(getDb(), parsed.data) });
  });
}
