import type { WatchlistCandidate } from "@hhc/shared";

/**
 * Map a provider match score + topics to an HHC F-indicator. Deterministic, so the
 * model never decides the F-mapping. Everything is pending_human_confirmation:
 * F1/F2 score only after a human confirms identity; F3 (weak match) never scores.
 */
export function mapsTo(score: number, topics: string[]): "F1" | "F2" | "F3" {
  const t = topics.map((s) => s.toLowerCase());
  if (score >= 0.7) {
    if (t.some((x) => x.includes("sanction"))) return "F1";
    if (t.some((x) => x.includes("pep") || x.includes("role"))) return "F2";
    return "F1"; // export-control / entity listing / state-linked entity
  }
  return "F3"; // weak / transliteration / same-name — flag only
}

export function makeCandidate(
  list: string,
  matchedEntity: string,
  query: string,
  score: number,
  topics: string[],
  sourceUrl?: string,
): WatchlistCandidate {
  return {
    list,
    matched_entity: matchedEntity,
    query,
    score,
    maps_to: mapsTo(score, topics),
    pending_human_confirmation: true,
    source_url: sourceUrl,
  };
}
