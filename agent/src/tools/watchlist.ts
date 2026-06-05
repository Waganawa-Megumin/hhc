import type { WatchlistCandidate } from "@hhc/shared";

/**
 * Normalize a provider match score to a 0–1 fraction. Sources disagree on scale:
 * OpenSanctions returns 0–1, but Trade.gov CSL returns 0–100 — so an unnormalized
 * 80 rendered as "8000%" and read as a high-confidence hit. Treat anything >1 as a
 * percentage and clamp, so display, rating, and the F-mapping are all consistent.
 */
export function normalizeScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const s = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, s));
}

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
  const norm = normalizeScore(score);
  return {
    list,
    matched_entity: matchedEntity,
    query,
    score: norm,
    maps_to: mapsTo(norm, topics),
    pending_human_confirmation: true,
    source_url: sourceUrl,
  };
}
