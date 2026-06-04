// §7.5 diff — re-investigation leads with what changed; "no change" collapses.
import type { Band } from "./bands";

export interface Snapshot {
  rawScore: number;
  band: Band;
  matchedIndicatorIds: string[];
  evidenceKeys: string[];
}

export interface DiffResult {
  changed: boolean;
  firstTime: boolean;
  newIndicators: string[];
  lostIndicators: string[];
  scoreDelta: number;
  bandChange: { from: Band; to: Band } | null;
  newEvidence: string[];
}

function minus(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((x) => !set.has(x));
}

export function diffSnapshots(prev: Snapshot | null, next: Snapshot): DiffResult {
  if (!prev) {
    return {
      changed: true,
      firstTime: true,
      newIndicators: [...next.matchedIndicatorIds],
      lostIndicators: [],
      scoreDelta: next.rawScore,
      bandChange: null,
      newEvidence: [...next.evidenceKeys],
    };
  }
  const newIndicators = minus(next.matchedIndicatorIds, prev.matchedIndicatorIds);
  const lostIndicators = minus(prev.matchedIndicatorIds, next.matchedIndicatorIds);
  const newEvidence = minus(next.evidenceKeys, prev.evidenceKeys);
  const scoreDelta = next.rawScore - prev.rawScore;
  const bandChange = prev.band !== next.band ? { from: prev.band, to: next.band } : null;
  const changed =
    newIndicators.length > 0 ||
    lostIndicators.length > 0 ||
    newEvidence.length > 0 ||
    scoreDelta !== 0 ||
    bandChange !== null;
  return { changed, firstTime: false, newIndicators, lostIndicators, scoreDelta, bandChange, newEvidence };
}
