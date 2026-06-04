// Forced-JSON schemas for §6 (AI interpret) and §7 (OSINT agent), shared so web
// and agent validate identically. The model is instructed to emit exactly these
// shapes; the receiver validates with zod and falls back gracefully on drift.
import { z } from "zod";

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export const BandSchema = z.enum(["low", "mid", "high"]);

export const SubjectHintSchema = z.object({
  company: z.string().default(""),
  domain: z.string().default(""),
  person: z.string().default(""),
  title: z.string().default(""),
});
export type SubjectHint = z.infer<typeof SubjectHintSchema>;

export const IndicatorMatchSchema = z.object({
  id: z.string(),
  confidence: ConfidenceSchema,
  rationale: z.string(),
});
export type IndicatorMatch = z.infer<typeof IndicatorMatchSchema>;

export const EvidenceSchema = z.object({
  source: z.string(),
  url: z.string().optional(),
  summary: z.string(),
  fetched_at: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** §6 interpret output (pasted text/screenshots → checklist prefill suggestions). */
export const InterpretResultSchema = z.object({
  subject_hint: SubjectHintSchema,
  matched_indicators: z.array(IndicatorMatchSchema).default([]),
  free_observations: z.array(z.string()).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  suggested_band: BandSchema.optional(),
  notes_for_user: z.string().default(""),
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
  subject_hint: SubjectHintSchema,
  matched_indicators: z.array(IndicatorMatchSchema).default([]),
  watchlist_candidates: z.array(WatchlistCandidateSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  tool_runs: z.array(ToolRunSchema).default([]),
  /** Sources that could not be reached — surfaced as "absence ≠ exoneration". */
  unavailable_sources: z.array(z.string()).default([]),
  notes_for_user: z.string().default(""),
});
export type OsintResult = z.infer<typeof OsintResultSchema>;

/**
 * Defensively parse model JSON: strip accidental code fences, then validate.
 * Returns a discriminated result rather than throwing, so callers degrade
 * gracefully on model drift.
 */
export function parseModelJson<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; error: string } {
  const stripped = stripCodeFences(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}

/** Remove a leading/trailing ``` or ```json fence the model may have added anyway. */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
}
