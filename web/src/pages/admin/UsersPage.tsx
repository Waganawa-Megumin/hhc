import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { authApi } from "../../auth/api";
import type { PublicUser, Role } from "../../auth/types";

type Notice =
  | { kind: "invite"; email: string; link: string; emailStatus: string }
  | { kind: "password"; email: string; pw: string };

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [notice, setNotice] = useState<Notice | null>(null);

  async function load() {
    const r = await authApi.adminListUsers();
    if (r.ok) setUsers(r.data.users);
    else setError(r.data.error ?? "error");
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await authApi.adminCreateUser(newEmail.trim().toLowerCase(), newRole);
    if (!r.ok) return setError(r.data.error ?? "error");
    // Build the link from the admin's actual browser origin (correct externally even
    // behind a dev proxy); fall back to the server-built link.
    const link = r.data.invitePath ? window.location.origin + r.data.invitePath : r.data.inviteLink;
    setNotice({ kind: "invite", email: r.data.user.email, link, emailStatus: r.data.emailStatus });
    setNewEmail("");
    await load();
  }

  async function patch(u: PublicUser, body: Parameters<typeof authApi.adminPatchUser>[1]) {
    setError(null);
    const r = await authApi.adminPatchUser(u.id, body);
    if (!r.ok) return setError(r.data.error ?? "error");
    if (body.action === "reset-password" && r.data.initialPassword) {
      setNotice({ kind: "password", email: u.email, pw: r.data.initialPassword });
    } else if (body.action === "resend-invite" && (r.data.invitePath || r.data.inviteLink)) {
      const link = r.data.invitePath ? window.location.origin + r.data.invitePath : r.data.inviteLink!;
      setNotice({ kind: "invite", email: u.email, link, emailStatus: r.data.emailStatus ?? "" });
    }
    await load();
  }

  const statusLabel = (s: PublicUser["status"]) =>
    s === "active" ? t("admin.statusActive") : s === "invited" ? t("admin.statusInvited") : t("admin.statusDisabled");

  return (
    <section className="admin-users">
      <h2>{t("admin.usersTitle")}</h2>

      <form className="admin-create" onSubmit={create}>
        <input type="email" placeholder={t("admin.email")} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
          <option value="user">{t("auth.roleUser")}</option>
          <option value="admin">{t("auth.roleAdmin")}</option>
        </select>
        <button type="submit" className="primary">
          {t("admin.inviteUser")}
        </button>
      </form>

      {notice ? (
        <div className="admin-flash">
          {notice.kind === "invite" ? (
            <>
              <strong>{t("admin.inviteFor", { email: notice.email })}</strong>
              <p className="muted small">
                {notice.emailStatus === "sent" ? t("admin.inviteEmailSent") : t("admin.inviteEmailUnavailable")}
              </p>
              <div className="invite-link-row">
                <code className="invite-link">{notice.link}</code>
                <button type="button" className="ghost small-btn" onClick={() => void navigator.clipboard.writeText(notice.link)}>
                  {t("admin.copyLink")}
                </button>
              </div>
            </>
          ) : (
            <>
              <strong>{t("admin.initialPasswordFor", { email: notice.email })}:</strong> <code>{notice.pw}</code>
              <button type="button" className="ghost small-btn" onClick={() => void navigator.clipboard.writeText(notice.pw)}>
                {t("report.copy")}
              </button>
              <p className="muted small">{t("admin.initialPasswordHint")}</p>
            </>
          )}
          <button type="button" className="ghost small-btn" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}

      {error ? <p className="warn small">{error === "last_admin" ? t("admin.lastAdminWarning") : error}</p> : null}
      {loading ? <p className="muted">…</p> : null}

      <table className="about-table admin-table">
        <thead>
          <tr>
            <th>{t("admin.email")}</th>
            <th>{t("admin.role")}</th>
            <th>{t("admin.status")}</th>
            <th>{t("admin.mfa")}</th>
            <th>{t("admin.lastLogin")}</th>
            <th>{t("admin.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.status === "disabled" ? "row-disabled" : ""}>
              <td>{u.email}</td>
              <td>
                <select
                  value={u.role}
                  onChange={(e) => void patch(u, { action: "set-role", role: e.target.value as Role })}
                  disabled={u.id === me?.id}
                >
                  <option value="user">{t("auth.roleUser")}</option>
                  <option value="admin">{t("auth.roleAdmin")}</option>
                </select>
              </td>
              <td>{statusLabel(u.status)}</td>
              <td>{u.mfaEnrolled ? u.mfaMethod.toUpperCase() : t("admin.mfaNone")}</td>
              <td className="muted small">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
              <td className="admin-row-actions">
                {u.status === "invited" ? (
                  <button type="button" className="ghost small-btn" onClick={() => void patch(u, { action: "resend-invite" })}>
                    {t("admin.resendInvite")}
                  </button>
                ) : null}
                {u.status === "active" ? (
                  <>
                    <button
                      type="button"
                      className="ghost small-btn"
                      disabled={u.id === me?.id}
                      onClick={() => void patch(u, { action: "set-status", status: "disabled" })}
                    >
                      {t("admin.disable")}
                    </button>
                    <button type="button" className="ghost small-btn" onClick={() => void patch(u, { action: "reset-password" })}>
                      {t("admin.resetPassword")}
                    </button>
                    <button type="button" className="ghost small-btn" onClick={() => void patch(u, { action: "force-mfa" })}>
                      {t("admin.forceMfa")}
                    </button>
                  </>
                ) : null}
                {u.status === "disabled" ? (
                  <button type="button" className="ghost small-btn" onClick={() => void patch(u, { action: "set-status", status: "active" })}>
                    {t("admin.enable")}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
