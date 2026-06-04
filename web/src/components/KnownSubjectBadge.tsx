import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { recallSubject, type RecallResponse, type AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

/** §5-1 instant recall: shows prior history for the subject BEFORE any query is run. */
export function KnownSubjectBadge({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const [recall, setRecall] = useState<RecallResponse | null>(null);
  const hint = c.subjectHint;

  useEffect(() => {
    if (!health?.caseDb || !hint) {
      setRecall(null);
      return;
    }
    const hasId = hint.company || hint.domain || hint.person;
    if (!hasId) return;
    let alive = true;
    void recallSubject({ company: hint.company, domain: hint.domain, person: hint.person }).then((r) => {
      if (alive) setRecall(r);
    });
    return () => {
      alive = false;
    };
  }, [health?.caseDb, hint]);

  if (!recall || (!recall.known && recall.clusterSuggestions.length === 0)) return null;

  return (
    <section className="known-badge" aria-label={t("recall.heading")}>
      {recall.known && recall.subject ? (
        <p className="recall-line">
          <span className="recall-dot" />
          {t("recall.seen", {
            count: recall.subject.inquiryCount,
            band: recall.subject.latestBand ?? "?",
            date: recall.subject.lastSeen.slice(0, 10),
          })}
        </p>
      ) : null}
      {recall.clusterSuggestions.length > 0 ? (
        <p className="recall-suggest">
          {t("recall.possibleSameActor")}:{" "}
          {recall.clusterSuggestions.map((s) => `${s.company} (${s.score.toFixed(2)})`).join(", ")}
          <span className="muted small"> — {t("recall.confirmManually")}</span>
        </p>
      ) : null}
    </section>
  );
}
