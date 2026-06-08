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
  "POST /api/invite/accept": "invite.accept",
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

// Category lets the dashboard show auth vs operation vs admin as separate sections.
const AUTH_ACTIONS = new Set([
  "login", "login.mfa", "login.mfa.resend", "logout", "password.change", "mfa.enroll", "mfa.send", "mfa.confirm", "invite.accept",
]);
const ADMIN_ACTIONS = new Set(["user.list", "user.create", "user.update", "audit.view", "audit.summary"]);
function categoryFor(action: string): "auth" | "admin" | "operation" {
  if (AUTH_ACTIONS.has(action)) return "auth";
  if (ADMIN_ACTIONS.has(action)) return "admin";
  return "operation"; // interpret / osint / report / inquiry / export / import / recall / stats
}

function trunc(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** A SAFE, non-sensitive operation summary from the request — never pasted text,
 * passwords, MFA codes, person names, or full bodies. */
function safeDetail(key: string, req: FastifyRequest): string | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    switch (key) {
      case "POST /api/auth/login":
      case "POST /api/auth/change-password":
        return typeof body.email === "string" ? `email=${trunc(body.email)}` : null;
      case "POST /api/osint":
      case "POST /api/subject/recall": {
        // The processed search query sent to the external sources / case DB — this is
        // "what was searched" (not the pasted text). Recorded for the audit trail.
        const parts: string[] = [];
        if (body.company) parts.push(`company="${trunc(String(body.company), 60)}"`);
        if (body.domain) parts.push(`domain=${trunc(String(body.domain), 60)}`);
        if (body.person) parts.push(`person="${trunc(String(body.person), 60)}"`);
        if (body.title) parts.push(`title="${trunc(String(body.title), 40)}"`);
        return parts.join(" ") || null;
      }
      case "POST /api/report": {
        const a = (body.assessment ?? {}) as Record<string, unknown>;
        const bits: string[] = [];
        if (a.band) bits.push(`band=${String(a.band)}`);
        if (typeof a.score === "number") bits.push(`score=${a.score}`);
        return bits.join(" ") || null;
      }
      case "POST /api/inquiry": {
        const bits: string[] = [];
        if (body.band) bits.push(`band=${String(body.band)}`);
        if (typeof body.score === "number") bits.push(`score=${body.score}`);
        return bits.join(" ") || null;
      }
      case "POST /api/interpret": {
        const n = Array.isArray(body.images) ? body.images.length : 0;
        const hasText = typeof body.text === "string" && body.text.length > 0;
        return `text=${hasText ? "yes" : "no"} images=${n}`; // never the content
      }
      case "POST /api/admin/users":
        return (
          [body.email ? `target=${trunc(String(body.email))}` : null, body.role ? `role=${String(body.role)}` : null]
            .filter(Boolean)
            .join(" ") || null
        );
      case "PATCH /api/admin/users/:id":
        return body.action
          ? `action=${String(body.action)}${body.role ? ` role=${String(body.role)}` : ""}${body.status ? ` status=${String(body.status)}` : ""}`
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function makeAuditOnResponse(getDb: () => DB) {
  return async function auditOnResponse(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const routePattern = req.routeOptions?.url ?? req.url.split("?")[0] ?? req.url;
      if (!routePattern.startsWith("/api")) return;
      const key = `${req.method} ${routePattern}`;
      if (SKIP.has(key)) return;

      const ip = req.ip ?? null;
      const geo = await geoLookup(ip);
      const action = ACTION_MAP[key] ?? key;
      recordAudit(getDb(), {
        ts: new Date().toISOString(),
        user_id: req.auth?.userId ?? null,
        email: req.auth?.email ?? null,
        action,
        category: categoryFor(action),
        route: routePattern,
        method: req.method,
        status: reply.statusCode,
        ip,
        user_agent: req.headers["user-agent"] ?? null,
        geo_country: geo.country ?? null,
        geo_region: geo.region ?? null,
        geo_city: geo.city ?? null,
        geo_status: geo.status,
        detail: safeDetail(key, req),
      });
    } catch {
      // Auditing must never break a response or the run.
    }
  };
}

/** Exposed for tests. */
export { ACTION_MAP as AUDIT_ACTION_MAP };
