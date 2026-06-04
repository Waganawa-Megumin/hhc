import { useCallback, useMemo, useState } from "react";
import {
  scoreApproach,
  type ScoreResult,
  type InterpretResult,
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
  /** Non-scored context only (design §0 / plan): never fed to scoreApproach. */
  nationalityContext: string;
  /** AI-suggested indicators (§6) — shown but NOT scored until the human ticks them. */
  suggestions: Record<string, IndicatorMatch>;
  subjectHint: SubjectHint | null;
  aiNotes: AiNotes | null;
  result: ScoreResult;
  toggle: (id: string) => void;
  toggleCoefficient: (id: CoefficientId) => void;
  setHumanConfirmedF1: (v: boolean) => void;
  setNationalityContext: (v: string) => void;
  applyInterpretResult: (r: InterpretResult) => void;
  reset: () => void;
}

export function useChecklist(): ChecklistController {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [coefficients, setCoefficients] = useState<Record<CoefficientId, boolean>>({ E1: false, E2: false });
  const [humanConfirmedF1, setHumanConfirmedF1] = useState(false);
  const [nationalityContext, setNationalityContext] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, IndicatorMatch>>({});
  const [subjectHint, setSubjectHint] = useState<SubjectHint | null>(null);
  const [aiNotes, setAiNotes] = useState<AiNotes | null>(null);

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

  const applyInterpretResult = useCallback((r: InterpretResult) => {
    const map: Record<string, IndicatorMatch> = {};
    for (const m of r.matched_indicators) map[m.id] = m;
    setSuggestions(map);
    setSubjectHint(r.subject_hint);
    setAiNotes({ notes: r.notes_for_user, observations: r.free_observations, suggestedBand: r.suggested_band });
  }, []);

  const reset = useCallback(() => {
    setSelected(new Set());
    setCoefficients({ E1: false, E2: false });
    setHumanConfirmedF1(false);
    setNationalityContext("");
    setSuggestions({});
    setSubjectHint(null);
    setAiNotes(null);
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
    suggestions,
    subjectHint,
    aiNotes,
    result,
    toggle,
    toggleCoefficient,
    setHumanConfirmedF1,
    setNationalityContext,
    applyInterpretResult,
    reset,
  };
}
