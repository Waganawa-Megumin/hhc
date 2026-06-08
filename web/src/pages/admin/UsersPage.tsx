import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { authApi } from "../../auth/api";
import type { PublicUser, Role } from "../../auth/types";

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [shown, setShown] = useState<{ email: string; pw: string } | null>(null);

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
    setNewEmail("");
    if (r.data.initialPassword) setShown({ email: r.data.user.email, pw: r.data.initialPassword });
    await load();
  }

  async function patch(
    id: string,
    body: Parameters<typeof authApi.adminPatchUser>[1],
    email?: string,
  ) {
    setError(null);
    const r = await authApi.adminPatchUser(id, body);
    if (!r.ok) return setError(r.data.error ?? "error");
    if (r.data.initialPassword && email) setShown({ email, pw: r.data.initialPassword });
    await load();
  }

  return (
    <section className="admin-users">
      <h2>{t("admin.usersTitle")}</h2>

      <form className="admin-create" onSubmit={create}>
        <input
          type="email"
          placeholder={t("admin.email")}
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          required
        />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
          <option value="user">{t("auth.roleUser")}</option>
          <option value="admin">{t("auth.roleAdmin")}</option>
        </select>
        <button type="submit" className="primary">
          {t("admin.createUser")}
        </button>
      </form>

      {shown ? (
        <div className="admin-flash">
          <strong>{t("admin.initialPasswordFor", { email: shown.email })}:</strong> <code>{shown.pw}</code>
          <button type="button" className="ghost small-btn" onClick={() => void navigator.clipboard.writeText(shown.pw)}>
            {t("report.copy")}
          </button>
          <button type="button" className="ghost small-btn" onClick={() => setShown(null)}>
            ✕
          </button>
          <p className="muted small">{t("admin.initialPasswordHint")}</p>
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
                  onChange={(e) => void patch(u.id, { action: "set-role", role: e.target.value as Role })}
                  disabled={u.id === me?.id}
                >
                  <option value="user">{t("auth.roleUser")}</option>
                  <option value="admin">{t("auth.roleAdmin")}</option>
                </select>
              </td>
              <td>{u.status === "active" ? t("admin.statusActive") : t("admin.statusDisabled")}</td>
              <td>{u.mfaEnrolled ? u.mfaMethod.toUpperCase() : t("admin.mfaNone")}</td>
              <td className="muted small">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
              <td className="admin-row-actions">
                {u.status === "active" ? (
                  <button
                    type="button"
                    className="ghost small-btn"
                    disabled={u.id === me?.id}
                    onClick={() => void patch(u.id, { action: "set-status", status: "disabled" })}
                  >
                    {t("admin.disable")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghost small-btn"
                    onClick={() => void patch(u.id, { action: "set-status", status: "active" })}
                  >
                    {t("admin.enable")}
                  </button>
                )}
                <button type="button" className="ghost small-btn" onClick={() => void patch(u.id, { action: "reset-password" }, u.email)}>
                  {t("admin.resetPassword")}
                </button>
                <button type="button" className="ghost small-btn" onClick={() => void patch(u.id, { action: "force-mfa" })}>
                  {t("admin.forceMfa")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
