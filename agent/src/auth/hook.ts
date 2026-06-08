// onRequest auth hook (mounted on the /api scope) + a requireRole preHandler.
// Public routes skip auth; everything else needs a valid, MFA-satisfied session
// for an active user. Onboarding flags (must change password / enroll MFA) are
// enforced server-side, not just in the UI.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "../db/db";
import * as store from "../db/authStore";
import { SESSION_COOKIE, isSessionStale, sha256hex } from "./sessions";
import type { Role } from "./types";

// Full request paths (with the /api prefix) reachable WITHOUT a session.
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/mfa",
  "/api/auth/mfa/resend",
  "/api/auth/logout",
]);

// During forced onboarding, only these self-service paths are reachable.
const ALLOWED_WHEN_MUST_CHANGE_PW = new Set(["/api/auth/me", "/api/auth/change-password"]);
const ALLOWED_WHEN_MUST_ENROLL = new Set([
  "/api/auth/me",
  "/api/auth/mfa/enroll",
  "/api/auth/mfa/confirm",
  "/api/auth/mfa/send",
]);

function pathOf(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

export function makeAuthOnRequest(getDb: () => DB) {
  return async function authOnRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const path = pathOf(req.url);
    // Invite setup is public — the single-use token in the path IS the credential.
    if (PUBLIC_PATHS.has(path) || path.startsWith("/api/invite/")) return;

    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return void reply.code(401).send({ error: "auth_required" });

    const db = getDb();
    const sess = store.findSessionByTokenHash(db, sha256hex(token));
    if (!sess || sess.mfa_satisfied !== 1) return void reply.code(401).send({ error: "auth_required" });
    if (sess.user_status !== "active") {
      store.deleteSession(db, sess.session_id);
      return void reply.code(401).send({ error: "auth_required" });
    }
    if (isSessionStale(sess.expires_at, sess.last_seen_at)) {
      store.deleteSession(db, sess.session_id);
      return void reply.code(401).send({ error: "session_expired" });
    }
    store.touchSession(db, sess.session_id);

    req.auth = {
      userId: sess.user_id,
      email: sess.email,
      role: sess.role,
      mustChangePassword: sess.must_change_password === 1,
      mustEnrollMfa: sess.must_enroll_mfa === 1,
    };

    // Onboarding gates (order: password first, then MFA enrollment).
    if (req.auth.mustChangePassword && !ALLOWED_WHEN_MUST_CHANGE_PW.has(path)) {
      return void reply.code(409).send({ error: "must_change_password" });
    }
    if (req.auth.mustEnrollMfa && !req.auth.mustChangePassword && !ALLOWED_WHEN_MUST_ENROLL.has(path)) {
      return void reply.code(409).send({ error: "must_enroll_mfa" });
    }
  };
}

/** preHandler that requires a specific role (admin). */
export function requireRole(role: Role) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.auth || (role === "admin" && req.auth.role !== "admin")) {
      return void reply.code(403).send({ error: "forbidden" });
    }
  };
}
