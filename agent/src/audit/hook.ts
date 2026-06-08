// onResponse audit hook (mounted on the /api scope). Records request metadata for
// every meaningful API call: timestamp, user, action, route, method, status, client
// IP (req.ip — real when trustProxy/served), User-Agent, and best-effort geo. Never
// records request bodies (could contain passwords/MFA codes) and never throws.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "../db/db";
import { recordAudit } from "../db/auditStore";
import { geoLookup } from "./geo";

// Route+method → a stable, readable action verb. Unknown routes fall back to
// "METHOD route". The pattern (with :id) comes from req.routeOptions.url.
const ACTION_MAP: Record<string, string> = {
  "POST /api/auth/login": "login",
  "POST /api/auth/mfa": "login.mfa",
  "POST /api/auth/mfa/resend": "login.mfa.resend",
  "POST /api/auth/logout": "logout",
  "POST /api/auth/change-password": "password.change",
  "POST /api/auth/mfa/enroll": "mfa.enroll",
  "POST /api/auth/mfa/send": "mfa.send",
  "POST /api/auth/mfa/confirm": "mfa.confirm",
  "POST /api/interpret": "interpret",
  "POST /api/osint": "osint",
  "POST /api/subject/recall": "subject.recall",
  "POST /api/inquiry": "inquiry.record",
  "GET /api/stats": "stats.view",
  "GET /api/export": "case.export",
  "POST /api/import": "case.import",
  "POST /api/report": "report",
  "GET /api/admin/users": "user.list",
  "POST /api/admin/users": "user.create",
  "PATCH /api/admin/users/:id": "user.update",
  "GET /api/admin/audit": "audit.view",
  "GET /api/admin/audit/summary": "audit.summary",
};

// High-frequency / low-value paths we skip to keep the log signal-rich.
const SKIP = new Set(["GET /api/health", "GET /api/auth/me", "GET /api/osint/:jobId"]);

export function makeAuditOnResponse(getDb: () => DB) {
  return async function auditOnResponse(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const routePattern = req.routeOptions?.url ?? req.url.split("?")[0] ?? req.url;
      if (!routePattern.startsWith("/api")) return;
      const key = `${req.method} ${routePattern}`;
      if (SKIP.has(key)) return;

      const ip = req.ip ?? null;
      const geo = await geoLookup(ip);
      recordAudit(getDb(), {
        ts: new Date().toISOString(),
        user_id: req.auth?.userId ?? null,
        email: req.auth?.email ?? null,
        action: ACTION_MAP[key] ?? key,
        route: routePattern,
        method: req.method,
        status: reply.statusCode,
        ip,
        user_agent: req.headers["user-agent"] ?? null,
        geo_country: geo.country ?? null,
        geo_region: geo.region ?? null,
        geo_city: geo.city ?? null,
        geo_status: geo.status,
      });
    } catch {
      // Auditing must never break a response or the run.
    }
  };
}

/** Exposed for tests. */
export { ACTION_MAP as AUDIT_ACTION_MAP };
