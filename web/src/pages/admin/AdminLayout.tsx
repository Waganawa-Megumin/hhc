import { Link, NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "../../components/LanguageToggle";
import { useAuth } from "../../auth/AuthContext";

export default function AdminLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "admin-tab active" : "admin-tab");
  return (
    <div className="admin">
      <header className="app-header">
        <div className="title-row">
          <div className="brand">
            <img className="app-logo" src="/favicon.svg" alt="" width="32" height="32" />
            <h1>{t("admin.dashboard")}</h1>
          </div>
          <div className="header-right">
            <span className="user-email">{user?.email}</span>
            <Link className="ghost" to="/">
              ← {t("admin.backToApp")}
            </Link>
            <LanguageToggle />
          </div>
        </div>
        <nav className="admin-nav">
          <NavLink to="/admin/users" className={cls}>
            {t("admin.usersTitle")}
          </NavLink>
          <NavLink to="/admin/audit" className={cls}>
            {t("admin.auditTitle")}
          </NavLink>
        </nav>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
