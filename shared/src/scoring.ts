// §3 deterministic scoring — THE AUTHORITY.
//
// The AI interpret layer (§6) and the OSINT agent (§7) only *propose*
// matched_indicators. Those proposals are routed back through this function to
// obtain the band. The agent never sets the band; this deterministic result plus
// the critical-flag overrides ALWAYS take precedence over any AI `suggested_band`.
//
// By construction the scoring input contains no nationality/ethnicity field, so
// demographic attributes can never contribute to the score (design spec §0; see
// also guardrails.assertNoDemographicScoringFields).

import {
  INDICATORS,
  CRITICAL_OVERRIDES,
  indicatorById,
  type CategoryId,
  type CoefficientIndicator,
  type WatchlistIndicator,
} from "./indicators";
import { bandFromScore, maxBand, type Band, type BandSource } from "./bands";

export interface ScoreInput {
  /** Human-confirmed indicator ids from categories A–D and F2/F3. */
  selected: string[];
  /** E coefficients (target attributes). */
  coefficients: { E1: boolean; E2: boolean };
  /**
   * F1 (designation-list match) is critical and forces the high band, so it is
   * gated by an explicit human identity confirmation — separate from a tentative
   * selection — to avoid false positives from transliteration / same-name hits.
   */
  humanConfirmedF1: boolean;
}

export interface Contribution {
  id: string;
  category: CategoryId;
  /** Weight actually applied to the base (0 for F3 flag-only and unconfirmed F1). */
  weight: number;
  /** Whether this contributed to the base score. */
  counted: boolean;
  note?: string;
}

export interface ScoreResult {
  baseScore: number;
  coefficient: number;
  rawScore: number;
  band: Band;
  bandSource: BandSource;
  /** Override ids that fired (e.g. "D3", "C2+D1", "F1"). */
  criticalFlags: string[];
  contributing: Contribution[];
}

/** Round half-up, tolerant of floating-point drift (e.g. 10 * 1.3 = 13.0000…2). */
function roundHalfUp(value: number): number {
  return Math.round(value + 1e-9);
}

export function scoreApproach(input: ScoreInput): ScoreResult {
  // The selected set (ids the human confirmed). F1 may appear here as a candidate
  // marker, but it only scores / overrides via `humanConfirmedF1` below.
  const selectedRaw = new Set(input.selected);

  const contributing: Contribution[] = [];
  let base = 0;

  for (const ind of INDICATORS) {
    if (ind.type === "coefficient") continue; // E1/E2 are multipliers, handled below
    if (ind.id === "F1") continue; // critical watchlist hit, handled below via explicit confirmation
    if (!selectedRaw.has(ind.id)) continue;

    if (ind.type === "watchlist" && (ind as WatchlistIndicator).flagOnly) {
      // F3: weak/ambiguous match — shown to the human, never scored.
      contributing.push({
        id: ind.id,
        category: ind.category,
        weight: 0,
        counted: false,
        note: "flag-only (F3): shown to the human, not added to the score",
      });
      continue;
    }

    const weight = (ind as { weight: number }).weight;
    base += weight;
    contributing.push({ id: ind.id, category: ind.category, weight, counted: true });
  }

  // F1 — designation-list match. Scores only after explicit human confirmation.
  const f1 = indicatorById("F1") as WatchlistIndicator | undefined;
  if (f1) {
    if (input.humanConfirmedF1) {
      base += f1.weight;
      contributing.push({
        id: "F1",
        category: "F",
        weight: f1.weight,
        counted: true,
        note: "human-confirmed designation-list match",
      });
    } else if (selectedRaw.has("F1")) {
      contributing.push({
        id: "F1",
        category: "F",
        weight: 0,
        counted: false,
        note: "candidate — pending human identity confirmation, not scored",
      });
    }
  }

  // E coefficients (data-driven from the KB).
  const e1 = (indicatorById("E1") as CoefficientIndicator | undefined)?.coefficient ?? 1.3;
  const e2 = (indicatorById("E2") as CoefficientIndicator | undefined)?.coefficient ?? 1.2;
  let coefficient = 1;
  if (input.coefficients.E1) coefficient *= e1;
  if (input.coefficients.E2) coefficient *= e2;

  const rawScore = roundHalfUp(base * coefficient);
  const scoreBand = bandFromScore(rawScore);

  // Critical-flag overrides: D3 alone, C2+D1 together, or human-confirmed F1 →
  // force the high band regardless of score. An override can only raise, never lower.
  const criticalFlags: string[] = [];
  for (const ov of CRITICAL_OVERRIDES) {
    const fired =
      ov.kind === "humanConfirmedF1"
        ? input.humanConfirmedF1 === true
        : ov.indicators.every((id) => selectedRaw.has(id));
    if (fired) criticalFlags.push(ov.id);
  }

  let band = scoreBand;
  let bandSource: BandSource = "score";
  if (criticalFlags.length > 0) {
    band = maxBand(scoreBand, "high"); // always "high"; maxBand guarantees we never lower
    bandSource = "override";
  }

  return { baseScore: base, coefficient, rawScore, band, bandSource, criticalFlags, contributing };
}
