// Configurable "states of concern" policy for the category-G state-nexus factor.
// This is the USER's policy, not a hardcoded judgement about any nationality. The
// default seeds the foreign-intelligence services named in the threat model
// (design §1); allied/other origins are neutral. Edit freely in the UI.
//
// The factor is HUMAN-SET and additive only — a non-match never lowers risk, and
// there is no automated ethnicity inference anywhere.

export const DEFAULT_CONCERN_ORIGINS: readonly string[] = [
  "中国", "China", "Chinese", "PRC",
  "北朝鮮", "North Korea", "DPRK",
  "ロシア", "Russia", "Russian",
  "イラン", "Iran", "Iranian",
];

/** True if a free-text origin/nationality matches any configured concern term (either direction, case-insensitive). */
export function matchesConcernOrigin(text: string, concerns: readonly string[]): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return concerns.some((c) => {
    const cc = c.trim().toLowerCase();
    return cc.length > 0 && (t.includes(cc) || cc.includes(t));
  });
}
