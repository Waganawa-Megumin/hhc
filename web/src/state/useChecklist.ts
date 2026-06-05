import { useCallback, useMemo, useState } from "react";
import {
  scoreApproach,
  indicatorById,
  DEFAULT_CONCERN_ORIGINS,
  type ScoreResult,
  type InterpretResult,
  type OsintResult,
  type IndicatorMatch,
  type SubjectHint,
  type Band,
} from "@hhc/shared";

export type CoefficientId = "E1" | "E2";

export interface AiNotes {
  notes: string;
  observations: string[];
  suggestedBand?: Band;
}

export interface ChecklistController {
  selected: Set<string>;
  coefficients: Record<CoefficientId, boolean>;
  humanConfirmedF1: boolean;
  /** Free-text origin/nationality used to help the human decide G1 (never scored directly). */
  nationalityContext: string;
  /** User's configurable "states of concern" list for the category-G nexus factor. */
  concernOrigins: string[];
  /** AI-suggested indicators (§6) — shown but NOT scored until the human ticks them. */
  suggestions: Record<string, IndicatorMatch>;
  subjectHint: SubjectHint | null;
  aiNotes: AiNotes | null;
  osint: OsintResult | null;
  /** True while an analyze/OSINT run is in progress (gates the report button). */
  analyzing: boolean;
  result: ScoreResult;
  toggle: (id: string) => void;
  toggleCoefficient: (id: CoefficientId) => void;
  setHumanConfirmedF1: (v: boolean) => void;
  setAnalyzing: (v: boolean) => void;
  setNationalityContext: (v: string) => void;
  setConcernOrigins: (v: string[]) => void;
  applyInterpretResult: (r: InterpretResult) => void;
  applyOsintResult: (r: OsintResult) => void;
  reset: () => void;
}

export function useChecklist(): ChecklistController {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [coefficients, setCoefficients] = useState<Record<CoefficientId, boolean>>({ E1: false, E2: false });
  const [humanConfirmedF1, setHumanConfirmedF1] = useState(false);
  const [nationalityContext, setNationalityContext] = useState("");
  const [concernOrigins, setConcernOrigins] = useState<string[]>([...DEFAULT_CONCERN_ORIGINS]);
  const [suggestions, setSuggestions] = useState<Record<string, IndicatorMatch>>({});
  const [subjectHint, setSubjectHint] = useState<SubjectHint | null>(null);
  const [aiNotes, setAiNotes] = useState<AiNotes | null>(null);
  const [osint, setOsint] = useState<OsintResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCoefficient = useCallback((id: CoefficientId) => {
    setCoefficients((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const mergeSuggestions = useCallback((matches: IndicatorMatch[]) => {
    setSuggestions((prev) => {
      const next = { ...prev };
      for (const m of matches) next[m.id] = m;
      return next;
    });
  }, []);

  // Auto-tick AI/OSINT matches into the checklist (the human can still untick).
  // F1 is excluded — it forces the high band, so it stays a one-click confirm to
  // guard against transliteration/same-name false positives. E coefficients are
  // about YOU, not the subject, so they are never auto-set.
  const tickMany = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (id === "F1") continue;
        const ind = indicatorById(id);
        if (!ind || ind.type === "coefficient") continue;
        next.add(id);
      }
      return next;
    });
  }, []);

  const applyInterpretResult = useCallback(
    (r: InterpretResult) => {
      mergeSuggestions(r.matched_indicators);
      tickMany(r.matched_indicators.map((m) => m.id));
      setSubjectHint(r.subject_hint);
      setAiNotes({ notes: r.notes_for_user, observations: r.free_observations, suggestedBand: r.suggested_band });
    },
    [mergeSuggestions, tickMany],
  );

  const applyOsintResult = useCallback(
    (r: OsintResult) => {
      // Auto-apply F2/F3 watchlist candidates.
      const fromWatchlist: IndicatorMatch[] = r.watchlist_candidates
        .filter((w) => w.maps_to === "F2" || w.maps_to === "F3")
        .map((w) => ({ id: w.maps_to, confidence: "medium", rationale: `${w.list}: ${w.matched_entity}` }));
      // High-confidence F1 list hit → auto-confirm (the human unticks if it's a
      // transliteration/same-name false positive). Surfaced with its rationale.
      const f1 = r.watchlist_candidates.find((w) => w.maps_to === "F1");
      const f1Suggestion: IndicatorMatch[] = f1
        ? [{ id: "F1", confidence: "high", rationale: `${f1.list}: ${f1.matched_entity}` }]
        : [];
      mergeSuggestions([...r.matched_indicators, ...fromWatchlist, ...f1Suggestion]);
      tickMany([...r.matched_indicators.map((m) => m.id), ...fromWatchlist.map((m) => m.id)]);
      if (f1) setHumanConfirmedF1(true);
      setSubjectHint((prev) => ({ ...(prev ?? { company: "", domain: "", person: "", title: "" }), ...r.subject_hint }));
      setOsint(r);
    },
    [mergeSuggestions, tickMany],
  );

  const reset = useCallback(() => {
    setSelected(new Set());
    setCoefficients({ E1: false, E2: false });
    setHumanConfirmedF1(false);
    setNationalityContext("");
    setConcernOrigins([...DEFAULT_CONCERN_ORIGINS]);
    setSuggestions({});
    setSubjectHint(null);
    setAiNotes(null);
    setOsint(null);
    setAnalyzing(false);
  }, []);

  // The authoritative score. nationalityContext and AI suggestions are intentionally
  // NOT passed in — only indicators the human actually ticked are scored.
  const result = useMemo(
    () => scoreApproach({ selected: [...selected], coefficients, humanConfirmedF1 }),
    [selected, coefficients, humanConfirmedF1],
  );

  return {
    selected,
    coefficients,
    humanConfirmedF1,
    nationalityContext,
    concernOrigins,
    suggestions,
    subjectHint,
    aiNotes,
    osint,
    analyzing,
    result,
    toggle,
    toggleCoefficient,
    setHumanConfirmedF1,
    setAnalyzing,
    setNationalityContext,
    setConcernOrigins,
    applyInterpretResult,
    applyOsintResult,
    reset,
  };
}
