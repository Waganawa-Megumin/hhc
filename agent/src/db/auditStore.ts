// DB access for the audit log. Takes a DB handle (testable via openTestDb()).
// Rows carry only request metadata + IP/UA/geo — never request bodies, secrets, or
// demographic fields (enforced by assertNoDemographicScoringFields on write).
import { assertNoDemographicScoringFields } from "@hhc/shared";
import type { DB } from "./db";

export interface AuditRow {
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
  /** Safe operation summary incl. the search query (e.g. "company=… person=…"); never bodies. */
  detail: string | null;
  /** 'auth' | 'operation' | 'admin' — lets the dashboard show separate sections. */
  category: string | null;
}

export function recordAudit(db: DB, row: AuditRow): void {
  assertNoDemographicScoringFields(row, "audit log");
  db.prepare(
    `INSERT INTO audit_logs
       (ts, user_id, email, action, route, method, status, ip, user_agent, geo_country, geo_region, geo_city, geo_status, detail, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.ts,
    row.user_id,
    row.email,
    row.action,
    row.route,
    row.method,
    row.status,
    row.ip,
    row.user_agent,
    row.geo_country,
    row.geo_region,
    row.geo_city,
    row.geo_status,
    row.detail,
    row.category,
  );
}

export interface AuditQuery {
  from?: string;
  to?: string;
  userId?: string;
  email?: string;
  action?: string;
  status?: number;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  rows: (AuditRow & { id: number })[];
  total: number;
  limit: number;
  offset: number;
}

function whereClause(q: AuditQuery): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.from) {
    where.push("ts >= ?");
    args.push(q.from);
  }
  if (q.to) {
    where.push("ts <= ?");
    args.push(q.to);
  }
  if (q.userId) {
    where.push("user_id = ?");
    args.push(q.userId);
  }
  if (q.email) {
    where.push("email = ?");
    args.push(q.email.toLowerCase());
  }
  if (q.action) {
    where.push("action = ?");
    args.push(q.action);
  }
  if (q.category) {
    where.push("category = ?");
    args.push(q.category);
  }
  if (typeof q.status === "number") {
    where.push("status = ?");
    args.push(q.status);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}

export function queryAudit(db: DB, q: AuditQuery = {}): AuditPage {
  const { sql, args } = whereClause(q);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${sql}`).get(...args) as { n: number }).n;
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 10000);
  const offset = Math.max(q.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as (AuditRow & { id: number })[];
  return { rows, total, limit, offset };
}

/** Delete audit rows older than `days` (0 = keep forever). Returns rows removed. */
export function purgeOldAudit(db: DB, days: number): number {
  if (!days || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.prepare("DELETE FROM audit_logs WHERE ts < ?").run(cutoff).changes;
}

/** Serialize audit rows to CSV for download (admin export). */
export function auditToCsv(rows: (AuditRow & { id: number })[]): string {
  const cols = [
    "ts", "category", "action", "method", "route", "status", "email", "user_id",
    "ip", "geo_country", "geo_region", "geo_city", "geo_status", "detail", "user_agent",
  ] as const;
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(","));
  return lines.join("\n");
}

export interface AuditSummary {
  total: number;
  byAction: { action: string; count: number }[];
  byDay: { day: string; count: number }[];
  failedLogins: number;
}

export function summarizeAudit(db: DB, q: AuditQuery = {}): AuditSummary {
  const { sql, args } = whereClause(q);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${sql}`).get(...args) as { n: number }).n;
  const byAction = db
    .prepare(`SELECT action, COUNT(*) AS count FROM audit_logs ${sql} GROUP BY action ORDER BY count DESC LIMIT 12`)
    .all(...args) as { action: string; count: number }[];
  const byDay = db
    .prepare(
      `SELECT substr(ts, 1, 10) AS day, COUNT(*) AS count FROM audit_logs ${sql} GROUP BY day ORDER BY day DESC LIMIT 14`,
    )
    .all(...args) as { day: string; count: number }[];
  // Failed sign-in attempts in range (login / MFA responses with a 4xx status).
  const failWhere = sql ? `${sql} AND` : "WHERE";
  const failedLogins = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_logs ${failWhere} action IN ('login','login.mfa') AND status >= 400`,
      )
      .get(...args) as { n: number }
  ).n;
  return { total, byAction, byDay, failedLogins };
}
