import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checklist } from "./components/Checklist";
import { ScorePanel } from "./components/ScorePanel";
import { ActionPanel } from "./components/ActionPanel";
import { LanguageToggle } from "./components/LanguageToggle";
import { PasteIntake } from "./components/PasteIntake";
import { OsintPanel } from "./components/OsintPanel";
import { useChecklist } from "./state/useChecklist";
import { useOnline } from "./state/useOffline";
import { getAgentHealth, type AgentHealth } from "./api/httpAgentClient";

export default function App() {
  const { t } = useTranslation();
  const c = useChecklist();
  const online = useOnline();
  const [health, setHealth] = useState<AgentHealth | null>(null);

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
          <div>
            <h1>{t("app.title")}</h1>
            <p className="subtitle">{t("app.subtitle")}</p>
          </div>
          <div className="header-right">
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
          <Checklist c={c} />
          <OsintPanel c={c} health={health} />
        </div>
        <aside className="results">
          <ScorePanel result={c.result} />
          <ActionPanel band={c.result.band} />
        </aside>
      </main>
    </div>
  );
}
