// §0 hard guardrails, enforced in code.
//
// Two distinct concerns:
//  1. Accusatory labelling — model output (§6/§7) must never call a person a
//     "spy"/工作員 etc. stripForbiddenLabels() scrubs model-generated text.
//  2. Demographic scoring — nationality/ethnicity must never enter the score or
//     the persisted case DB. assertNoDemographicScoringFields() guards those
//     structures. NOTE: a transient, non-scored UI "context" object MAY display a
//     claimed nationality for the human's own judgement; that object is never
//     passed to scoring or written to the DB, so it is not checked here.

/** Accusatory verdict words that must not appear in AI/agent output about a person. */
export const FORBIDDEN_VERDICT_PATTERNS: readonly RegExp[] = [
  /\bsp(?:y|ies|ying)\b/gi,
  /スパイ/g,
  /工作員/g,
  /諜報員/g,
];

export function containsForbiddenLabel(text: string): boolean {
  return FORBIDDEN_VERDICT_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/**
 * Scrub accusatory labels from model-generated text. Returns the scrubbed text
 * and whether anything was replaced. Intended for §6/§7 output only — not for the
 * app's own domain copy (which legitimately discusses intelligence recruitment).
 */
export function stripForbiddenLabels(text: string): { text: string; scrubbed: boolean } {
  let scrubbed = false;
  let out = text;
  for (const re of FORBIDDEN_VERDICT_PATTERNS) {
    out = out.replace(re, () => {
      scrubbed = true;
      return "［ラベル除去 / redacted-label］";
    });
  }
  return { text: out, scrubbed };
}

/** Keys that must never appear in a scoring input or a persisted case record. */
export const FORBIDDEN_DEMOGRAPHIC_KEYS: readonly string[] = [
  "nationality",
  "ethnicity",
  "race",
  "national_origin",
  "nationalorigin",
  "国籍",
  "民族",
  "人種",
];

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_DEMOGRAPHIC_KEYS.map((k) => k.toLowerCase()));

/** Recursively collect any forbidden demographic keys found in an object graph. */
export function findForbiddenDemographicKeys(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenDemographicKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_SET.has(k.toLowerCase())) hits.push(path ? `${path}.${k}` : k);
      hits.push(...findForbiddenDemographicKeys(v, path ? `${path}.${k}` : k));
    }
  }
  return hits;
}

/**
 * Throw if a structure that feeds scoring or persistence contains demographic
 * fields. This is the structural enforcement of "nationality/ethnicity never
 * contribute to the score and are never stored in the case DB."
 */
export function assertNoDemographicScoringFields(value: unknown, context: string): void {
  const hits = findForbiddenDemographicKeys(value);
  if (hits.length > 0) {
    throw new Error(
      `[guardrail] ${context} must not contain demographic fields (nationality/ethnicity). Found: ${hits.join(", ")}`,
    );
  }
}

/** Shown next to any non-scored nationality context in the UI. */
export const NATIONALITY_NOT_SCORED_NOTE = {
  ja: "国籍は判断材料として表示しています（自動スコアには加算しません）。検知は所属・リスト突合（カテゴリF）で行います。",
  en: "Nationality is shown for your judgement only; it is not added to the automated score. Detection relies on affiliation/list matching (category F).",
} as const;
