import type { ScoreInput } from "../../src/scoring";
import type { Band, BandSource } from "../../src/bands";

export interface Fixture {
  name: string;
  description: string;
  input: ScoreInput;
  expect: {
    band: Band;
    bandSource: BandSource;
    rawScore: number;
    criticalFlags: string[];
  };
}

function mk(selected: string[], opts: Partial<ScoreInput> = {}): ScoreInput {
  return { selected, coefficients: { E1: false, E2: false }, humanConfirmedF1: false, ...opts };
}

/**
 * Calibration personas. A normal recruiter must mostly land low/mid (false-positive
 * control), while an FIS-like approach lands high — preferably via a critical override.
 */
export const fixtures: Fixture[] = [
  {
    name: "legit-recruiter",
    description:
      "An ordinary recruiter from a newish boutique who was vague about how they found you. Benign signals only → low.",
    input: mk(["A2", "B4"]),
    expect: { band: "low", bandSource: "score", rawScore: 4, criticalFlags: [] },
  },
  {
    name: "fis-like",
    description:
      "Thin think-tank front, AI-style photo, avoids video, pushes to encrypted chat, probes your access and asks for sensitive reports; you hold sensitive access and are a gov affiliate.",
    input: mk(["A1", "B1", "C1", "C2", "D1", "D2"], { coefficients: { E1: true, E2: true } }),
    // base 3+3+3+3+4+3 = 19; ×1.3×1.2 = 1.56 → 29.64 → 30; C2+D1 fires.
    expect: { band: "high", bandSource: "override", rawScore: 30, criticalFlags: ["C2+D1"] },
  },
  {
    name: "translit-homonym",
    description:
      "A weak watchlist name match that is likely a transliteration/same-name coincidence, plus some sloppy site signals. F3 must not score → low.",
    input: mk(["A3", "F3"]),
    expect: { band: "low", bandSource: "score", rawScore: 2, criticalFlags: [] },
  },
];
