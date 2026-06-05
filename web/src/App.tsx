import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checklist } from "./components/Checklist";
import { ScorePanel } from "./components/ScorePanel";
import { ActionPanel } from "./components/ActionPanel";
import { LanguageToggle } from "./components/LanguageToggle";
import { PasteIntake } from "./components/PasteIntake";
import { OsintPanel } from "./components/OsintPanel";
import { AboutPanel } from "./components/AboutPanel";
import { KnownSubjectBadge } from "./components/KnownSubjectBadge";
import { CaseHistoryPanel } from "./components/CaseHistoryPanel";
import { ReportDraft } from "./components/ReportDraft";
import { useChecklist } from "./state/useChecklist";
import { useOnline } from "./state/useOffline";
import { getAgentHealth, type AgentHealth } from "./api/httpAgentClient";

export default function App() {
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
            <button type="button" className="ghost about-btn" onClick={() => setAboutOpen(true)}>
              {t("about.button")}
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
        </aside>
      </main>

      {aboutOpen ? <AboutPanel onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
