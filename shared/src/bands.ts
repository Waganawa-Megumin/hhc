import { BANDS, type BandConfig } from "./indicators";

export type Band = "low" | "mid" | "high";
export type BandSource = "score" | "override";

export const BAND_ORDER: readonly Band[] = ["low", "mid", "high"];

/** Map a numeric score to a band using the KB thresholds (low 0–5 / mid 6–12 / high 13+). */
export function bandFromScore(score: number, bands: BandConfig = BANDS): Band {
  if (score <= (bands.low.max ?? 5)) return "low";
  if (score <= (bands.mid.max ?? 12)) return "mid";
  return "high";
}

/** True if `a` is a strictly higher (more severe) band than `b`. */
export function isHigherBand(a: Band, b: Band): boolean {
  return BAND_ORDER.indexOf(a) > BAND_ORDER.indexOf(b);
}

/** The more severe of two bands. Used so an override can only raise, never lower. */
export function maxBand(a: Band, b: Band): Band {
  return isHigherBand(a, b) ? a : b;
}
