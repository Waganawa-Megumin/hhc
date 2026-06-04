import { useCallback, useMemo, useState } from "react";
import { scoreApproach, type ScoreResult } from "@hhc/shared";

export type CoefficientId = "E1" | "E2";

export interface ChecklistController {
  selected: Set<string>;
  coefficients: Record<CoefficientId, boolean>;
  humanConfirmedF1: boolean;
  /** Non-scored context only (design §0 / plan): never fed to scoreApproach. */
  nationalityContext: string;
  result: ScoreResult;
  toggle: (id: string) => void;
  toggleCoefficient: (id: CoefficientId) => void;
  setHumanConfirmedF1: (v: boolean) => void;
  setNationalityContext: (v: string) => void;
  reset: () => void;
}

export function useChecklist(): ChecklistController {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [coefficients, setCoefficients] = useState<Record<CoefficientId, boolean>>({ E1: false, E2: false });
  const [humanConfirmedF1, setHumanConfirmedF1] = useState(false);
  const [nationalityContext, setNationalityContext] = useState("");

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

  const reset = useCallback(() => {
    setSelected(new Set());
    setCoefficients({ E1: false, E2: false });
    setHumanConfirmedF1(false);
    setNationalityContext("");
  }, []);

  // The authoritative score. nationalityContext is intentionally NOT passed in.
  const result = useMemo(
    () => scoreApproach({ selected: [...selected], coefficients, humanConfirmedF1 }),
    [selected, coefficients, humanConfirmedF1],
  );

  return {
    selected,
    coefficients,
    humanConfirmedF1,
    nationalityContext,
    result,
    toggle,
    toggleCoefficient,
    setHumanConfirmedF1,
    setNationalityContext,
    reset,
  };
}
