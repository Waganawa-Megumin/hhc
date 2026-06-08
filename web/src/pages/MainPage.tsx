import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Checklist } from "../components/Checklist";
import { ScorePanel } from "../components/ScorePanel";
import { ActionPanel } from "../components/ActionPanel";
import { LanguageToggle } from "../components/LanguageToggle";
import { PasteIntake } from "../components/PasteIntake";
import { OsintPanel } from "../components/OsintPanel";
import { AboutPanel } from "../components/AboutPanel";
import { KnownSubjectBadge } from "../components/KnownSubjectBadge";
import { CaseHistoryPanel } from "../components/CaseHistoryPanel";
import { ReportDraft } from "../components/ReportDraft";
import { IntegratedReport } from "../components/IntegratedReport";
import { useChecklist } from "../state/useChecklist";
import { useOnline } from "../state/useOffline";
import { getAgentHealth, type AgentHealth } from "../api/httpAgentClient";
import { useAuth } from "../auth/AuthContext";

function UserMenu() {
  const { t } = useTranslation();
  const { status, user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  if (status !== "authed" || !user) return null;
  return (
    <div className="user-menu">
      <span className="user-email" title={user.email}>
        {user.email}
      </span>
      <span className={`role-badge role-${user.role}`}>{isAdmin ? t("auth.roleAdmin") : t("auth.roleUser")}</span>
      {isAdmin ? (
        <Link className="ghost" to="/admin/users">
          {t("admin.link")}
        </Link>
      ) : null}
      <button
        type="button"
        className="ghost"
        onClick={() => {
          void logout().then(() => navigate("/login"));
        }}
      >
        {t("auth.logout")}
      </button>
    </div>
  );
}

export default function MainPage() {
  const { t } = useTranslation();
  const c = useChecklist();
  const online = useOnline();
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAgentHealth().then((h) => {
      if (alive) setHealth(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="title-row">
          <div className="brand">
            <img className="app-logo" src="/favicon.svg" alt="" width="40" height="40" />
            <div>
              <h1>{t("app.title")}</h1>
              <p className="subtitle">{t("app.subtitle")}</p>
            </div>
          </div>
          <div className="header-right">
            <UserMenu />
            <button type="button" className="about-btn" onClick={() => setAboutOpen(true)}>
              <span aria-hidden="true">ⓘ</span> {t("about.button")}
            </button>
            <span className={online ? "net-badge online" : "net-badge offline"}>
              {online ? t("offline.online") : t("offline.offline")}
            </span>
            <LanguageToggle />
          </div>
        </div>
        <p className="intro">{t("app.intro")}</p>
        <p className="disclaimer">{t("app.disclaimer")}</p>
      </header>

      <main className="layout">
        <div className="left-col">
          <PasteIntake c={c} health={health} />
          <OsintPanel c={c} health={health} />
          <Checklist c={c} />
          <CaseHistoryPanel c={c} health={health} />
        </div>
        <aside className="results">
          <KnownSubjectBadge c={c} health={health} />
          <ScorePanel result={c.result} />
          <ActionPanel band={c.result.band} />
          <ReportDraft c={c} />
          <IntegratedReport c={c} health={health} />
        </aside>
      </main>

      {aboutOpen ? <AboutPanel onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
