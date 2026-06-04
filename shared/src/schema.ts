// Forced-JSON schemas for §6 (AI interpret) and §7 (OSINT agent), shared so web
// and agent validate identically. The model is instructed to emit exactly these
// shapes; the receiver validates with zod and falls back gracefully on drift.
import { z } from "zod";

// Lenient field helpers: tolerate missing/wrong values so a small model deviation
// never nukes the whole parse (we degrade field-by-field instead).
const lstr = () => z.string().default("").catch("");

export const ConfidenceSchema = z
  .preprocess((v) => (typeof v === "string" ? v.toLowerCase().trim() : v), z.enum(["low", "medium", "high"]))
  .catch("medium");
export const BandSchema = z.enum(["low", "mid", "high"]);

export const SubjectHintSchema = z.object({
  company: lstr(),
  domain: lstr(),
  person: lstr(),
  title: lstr(),
});
export type SubjectHint = z.infer<typeof SubjectHintSchema>;

const EMPTY_HINT = { company: "", domain: "", person: "", title: "" };

export const IndicatorMatchSchema = z.object({
  id: lstr(),
  confidence: ConfidenceSchema,
  rationale: lstr(),
});
export type IndicatorMatch = z.infer<typeof IndicatorMatchSchema>;

export const EvidenceSchema = z.object({
  source: lstr(),
  url: z.string().optional(),
  summary: lstr(),
  fetched_at: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** §6 interpret output (pasted text/screenshots → checklist prefill suggestions). */
export const InterpretResultSchema = z.object({
  subject_hint: SubjectHintSchema.default(EMPTY_HINT).catch(EMPTY_HINT),
  matched_indicators: z.array(IndicatorMatchSchema).default([]).catch([]),
  free_observations: z.array(lstr()).default([]).catch([]),
  evidence: z.array(EvidenceSchema).default([]).catch([]),
  suggested_band: BandSchema.optional().catch(undefined),
  notes_for_user: lstr(),
});
export type InterpretResult = z.infer<typeof InterpretResultSchema>;

/** Uniform envelope every OSINT tool returns, so a failure never aborts the run. */
export const ToolStatusSchema = z.enum(["ok", "unavailable", "no_match", "error"]);
export const ToolRunSchema = z.object({
  tool: z.string(),
  status: ToolStatusSchema,
  available: z.boolean(),
  queried_at: z.string().optional(),
  source_url: z.string().optional(),
  citation: z.string().optional(),
  data: z.unknown().optional(),
  /** Carries the "no evidence ≠ innocence" note for unavailable/no_match. */
  note: z.string().optional(),
});
export type ToolRun = z.infer<typeof ToolRunSchema>;

/**
 * A sanctions / export-control / watchlist candidate. Surfaced for human identity
 * confirmation; F1/F2 only score after confirmation. Weak matches map to F3
 * (flag-only). Never records nationality — only which list/entry matched and how.
 */
export const WatchlistCandidateSchema = z.object({
  list: z.string(),
  matched_entity: z.string(),
  query: z.string(),
  /** Provider match score (e.g. OpenSanctions 0–1). */
  score: z.number().optional(),
  maps_to: z.enum(["F1", "F2", "F3"]),
  pending_human_confirmation: z.boolean().default(true),
  source_url: z.string().optional(),
});
export type WatchlistCandidate = z.infer<typeof WatchlistCandidateSchema>;

/** §7 OSINT agent synthesis. matched_indicators route back through scoreApproach. */
export const OsintResultSchema = z.object({
  subject_hint: SubjectHintSchema.default(EMPTY_HINT).catch(EMPTY_HINT),
  matched_indicators: z.array(IndicatorMatchSchema).default([]).catch([]),
  watchlist_candidates: z.array(WatchlistCandidateSchema).default([]).catch([]),
  evidence: z.array(EvidenceSchema).default([]).catch([]),
  tool_runs: z.array(ToolRunSchema).default([]).catch([]),
  /** Sources that could not be reached — surfaced as "absence ≠ exoneration". */
  unavailable_sources: z.array(lstr()).default([]).catch([]),
  notes_for_user: lstr(),
});
export type OsintResult = z.infer<typeof OsintResultSchema>;

/**
 * Defensively parse model JSON: strip accidental code fences, then validate.
 * Returns a discriminated result rather than throwing, so callers degrade
 * gracefully on model drift.
 */
export function parseModelJson<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
  const stripped = stripCodeFences(raw).trim();
  // Try the whole string, then fall back to the outermost { … } in case the model
  // wrapped the JSON in prose ("Here is the analysis: {…}").
  let parsed = tryJson(stripped);
  if (parsed === undefined) {
    const braced = outermostBraces(stripped);
    if (braced) parsed = tryJson(braced);
  }
  if (parsed === undefined) {
    return { ok: false, error: "invalid JSON (no parseable object found)" };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data as z.infer<S> };
}

function tryJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function outermostBraces(s: string): string | null {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  return first >= 0 && last > first ? s.slice(first, last + 1) : null;
}

/** Remove a leading/trailing ``` or ```json fence the model may have added anyway. */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
}
