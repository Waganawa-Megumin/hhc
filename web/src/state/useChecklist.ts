import { useCallback, useMemo, useState } from "react";
import {
  scoreApproach,
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
  result: ScoreResult;
  toggle: (id: string) => void;
  toggleCoefficient: (id: CoefficientId) => void;
  setHumanConfirmedF1: (v: boolean) => void;
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

  const applyInterpretResult = useCallback(
    (r: InterpretResult) => {
      mergeSuggestions(r.matched_indicators);
      setSubjectHint(r.subject_hint);
      setAiNotes({ notes: r.notes_for_user, observations: r.free_observations, suggestedBand: r.suggested_band });
    },
    [mergeSuggestions],
  );

  const applyOsintResult = useCallback(
    (r: OsintResult) => {
      mergeSuggestions(r.matched_indicators);
      setSubjectHint((prev) => ({ ...(prev ?? { company: "", domain: "", person: "", title: "" }), ...r.subject_hint }));
      setOsint(r);
    },
    [mergeSuggestions],
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
    result,
    toggle,
    toggleCoefficient,
    setHumanConfirmedF1,
    setNationalityContext,
    setConcernOrigins,
    applyInterpretResult,
    applyOsintResult,
    reset,
  };
}
