import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authApi, type AuditRow, type AuditSummary } from "../../auth/api";

const PAGE = 50;

interface Filters {
  from: string;
  to: string;
  action: string;
  email: string;
}

function buildQuery(f: Filters, offset: number): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", `${f.from}T00:00:00.000Z`);
  if (f.to) p.set("to", `${f.to}T23:59:59.999Z`);
  if (f.action.trim()) p.set("action", f.action.trim());
  if (f.email.trim()) p.set("email", f.email.trim().toLowerCase());
  p.set("limit", String(PAGE));
  p.set("offset", String(offset));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function geoText(r: AuditRow): string {
  if (r.geo_status === "ok") return [r.geo_city, r.geo_country].filter(Boolean).join(", ") || "—";
  if (!r.ip) return "—";
  return r.geo_status === "error" ? "?" : "—"; // unavailable (private/loopback/offline) vs failed
}

export default function AuditPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>({ from: "", to: "", action: "", email: "" });
  const [applied, setApplied] = useState<Filters>({ from: "", to: "", action: "", email: "" });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = buildQuery(applied, offset);
    const [list, sum] = await Promise.all([authApi.adminAudit(qs), authApi.adminAuditSummary(buildQuery(applied, 0))]);
    if (list.ok) {
      setRows(list.data.rows);
      setTotal(list.data.total);
    } else setError(list.data.error ?? "error");
    if (sum.ok) setSummary(sum.data.summary);
    setLoading(false);
  }, [applied, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function apply() {
    setOffset(0);
    setApplied(filters);
  }

  return (
    <section className="admin-audit">
      <h2>{t("admin.auditTitle")}</h2>

      {summary ? (
        <div className="audit-summary">
          <div className="audit-stat">
            <span className="audit-stat-n">{summary.total}</span>
            <span className="muted small">{t("admin.audit.total")}</span>
          </div>
          <div className="audit-stat">
            <span className="audit-stat-n warn">{summary.failedLogins}</span>
            <span className="muted small">{t("admin.audit.failedLogins")}</span>
          </div>
          <div className="audit-actions-top">
            <span className="muted small">{t("admin.audit.topActions")}:</span>
            {summary.byAction.slice(0, 6).map((a) => (
              <button
                key={a.action}
                type="button"
                className="audit-chip"
                onClick={() => {
                  setFilters((f) => ({ ...f, action: a.action }));
                  setOffset(0);
                  setApplied((f) => ({ ...f, action: a.action }));
                }}
              >
                {a.action} <b>{a.count}</b>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="audit-filters">
        <label>
          {t("admin.audit.from")}
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label>
          {t("admin.audit.to")}
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <label>
          {t("admin.audit.action")}
          <input type="text" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        </label>
        <label>
          {t("admin.email")}
          <input type="text" value={filters.email} onChange={(e) => setFilters({ ...filters, email: e.target.value })} />
        </label>
        <button type="button" className="primary" onClick={apply}>
          {t("admin.audit.apply")}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const empty = { from: "", to: "", action: "", email: "" };
            setFilters(empty);
            setApplied(empty);
            setOffset(0);
          }}
        >
          {t("admin.audit.clear")}
        </button>
      </div>

      {error ? <p className="warn small">{error}</p> : null}

      <table className="about-table audit-table">
        <thead>
          <tr>
            <th>{t("admin.audit.time")}</th>
            <th>{t("admin.audit.user")}</th>
            <th>{t("admin.audit.action")}</th>
            <th>{t("admin.audit.status")}</th>
            <th>{t("admin.audit.ip")}</th>
            <th>{t("admin.audit.location")}</th>
            <th>{t("admin.audit.agent")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status >= 400 ? "row-fail" : ""}>
              <td className="nowrap">{new Date(r.ts).toLocaleString()}</td>
              <td>{r.email ?? <span className="muted">—</span>}</td>
              <td>
                <code>{r.action}</code>
                <span className="muted small"> {r.method}</span>
              </td>
              <td className={r.status >= 400 ? "warn" : ""}>{r.status}</td>
              <td className="nowrap">{r.ip ?? "—"}</td>
              <td>{geoText(r)}</td>
              <td className="audit-ua muted small" title={r.user_agent ?? ""}>
                {r.user_agent ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading ? <p className="muted">…</p> : rows.length === 0 ? <p className="muted">{t("admin.audit.empty")}</p> : null}

      <div className="audit-pager">
        <button type="button" className="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          ← {t("admin.audit.prev")}
        </button>
        <span className="muted small">
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} / {total}
        </span>
        <button type="button" className="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
          {t("admin.audit.next")} →
        </button>
      </div>
    </section>
  );
}
