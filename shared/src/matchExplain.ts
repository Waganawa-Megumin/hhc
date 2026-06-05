// Shared "where / how did it match" explainer. One source of truth so the OSINT
// panel's highlighting and the detailed event log describe a watchlist hit the
// same way: which tokens overlap, how strongly, and whether the hit is purely
// fuzzy/phonetic (a common false-positive shape for transliterated names).
import { jaroWinkler } from "./fuzzy";

export function normMatchToken(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function tokenizeName(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(normMatchToken)
    .filter(Boolean);
}

// Generic corporate/legal/role tokens are in almost every name, so an exact hit on
// one is not "where it meaningfully matched" — never count them as overlap.
export const MATCH_STOPWORDS = new Set([
  "co", "ltd", "inc", "llc", "corp", "corporation", "company", "limited", "private",
  "gmbh", "the", "and", "of", "group", "holdings", "industrial", "industries",
  "technology", "trading", "kk", "kabushiki", "kaisha", "pte", "plc", "sa", "ag",
  "bv", "srl", "international", "global",
]);

export const STRONG_SIM = 0.92; // near-exact token
export const FUZZY_SIM = 0.86; // visibly similar (spelling / transliteration)

export type MatchLevel = "strong" | "fuzzy" | "none";

/** Best match level of `token` against any token in `others`. */
export function classifyToken(token: string, others: string[]): MatchLevel {
  const t = normMatchToken(token);
  if (!t || MATCH_STOPWORDS.has(t)) return "none";
  let best = 0;
  for (const o of others) {
    const sim = t === o ? 1 : jaroWinkler(t, o);
    if (sim > best) best = sim;
  }
  if (best >= STRONG_SIM) return "strong";
  if (best >= FUZZY_SIM) return "fuzzy";
  return "none";
}

export interface MatchExplain {
  /** Entity tokens with a near-exact counterpart in the query. */
  strong: string[];
  /** Entity tokens that are only spelling/sound-close to a query token. */
  fuzzy: string[];
  /** True when nothing in the query strongly overlaps the entity (fuzzy-only hit). */
  fuzzyOnly: boolean;
}

/** Explain where/how a query string overlaps a matched entity string. */
export function explainMatch(query: string, entity: string): MatchExplain {
  const q = tokenizeName(query);
  const e = tokenizeName(entity);
  const strong: string[] = [];
  const fuzzy: string[] = [];
  for (const tok of e) {
    const level = classifyToken(tok, q);
    if (level === "strong") strong.push(tok);
    else if (level === "fuzzy") fuzzy.push(tok);
  }
  let fuzzyOnly = true;
  for (const tok of q) {
    if (classifyToken(tok, e) === "strong") {
      fuzzyOnly = false;
      break;
    }
  }
  return { strong, fuzzy, fuzzyOnly };
}

/** Provider score (0–1) → coarse confidence label (shared by panel + log). */
export function rateName(score: number): "high" | "mid" | "low" {
  return score >= 0.85 ? "high" : score >= 0.7 ? "mid" : "low";
}
