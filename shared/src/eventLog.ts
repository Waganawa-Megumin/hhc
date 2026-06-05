// §5-7 — a deterministic, line-oriented "detailed event log" that sits alongside
// the AI-organized integrated report. It records WHY (which indicators scored and
// from what source), WHERE (each OSINT source queried), and HOW (the exact
// query→entity overlap of every watchlist hit) — in a flat, greppable text format
// that is easy to diff/parse later. No AI, no nationality, model text scrubbed.
import { CRITICAL_OVERRIDES, indicatorById, type Lang } from "./indicators";
import type { Band } from "./bands";
import { stripForbiddenLabels } from "./guardrails";
import { explainMatch, rateName } from "./matchExplain";
import type { ScoreResult } from "./scoring";
import type { IndicatorMatch, OsintResult, SubjectHint } from "./schema";

export interface EventLogInput {
  generatedAt: string;
  subject: SubjectHint;
  /** Non-scored origin context the human typed (never used in the score). */
  nationalityContext?: string;
  result: ScoreResult;
  coefficients: { E1: boolean; E2: boolean };
  humanConfirmedF1: boolean;
  /** indicator id → the AI/OSINT suggestion that proposed it (rationale, confidence). */
  suggestions: Record<string, IndicatorMatch>;
  /** indicator ids the human ticked (i.e. that feed the score). */
  selectedIds: string[];
  osint: OsintResult | null;
  /** §6 AI interpretation free-text (reference only; the engine sets the real band). */
  interpretation?: { notes: string; observations: string[]; suggestedBand?: Band };
}

/** Quote a value onto a single, escaped log line. */
function q(s: unknown): string {
  return `"${String(s ?? "").replace(/\s+/g, " ").replace(/"/g, '\\"').trim()}"`;
}
function scrub(s: string | undefined): string {
  return stripForbiddenLabels(s ?? "").text;
}
function candidateCount(data: unknown): number | null {
  const c = (data as { candidates?: unknown[] } | undefined)?.candidates;
  return Array.isArray(c) ? c.length : null;
}

export function buildEventLog(input: EventLogInput, lang: Lang): string {
  const L: string[] = [];
  const r = input.result;

  L.push("HHC detailed event log / 詳細イベントログ");
  L.push(`# schema=hhc-eventlog/1  generated_at=${input.generatedAt}  lang=${lang}`);
  L.push("# WHY = score breakdown + indicator sources · WHERE = OSINT tool runs · HOW = watchlist match detail");
  L.push("# Not an accusation. No nationality/ethnicity in the score. Model text is label-scrubbed.");
  L.push("");

  // [SUBJECT]
  L.push("[SUBJECT]");
  L.push(`company=${q(input.subject.company)}`);
  L.push(`domain=${q(input.subject.domain)}`);
  L.push(`person=${q(input.subject.person)}`);
  L.push(`title=${q(input.subject.title)}`);
  if (input.nationalityContext) L.push(`nationality_context=${q(input.nationalityContext)}  # non-scored context`);
  L.push("");

  // [VERDICT]
  L.push("[VERDICT]");
  L.push(`score.base=${r.baseScore}  coefficient=${r.coefficient}  score.raw=${r.rawScore}`);
  L.push(`band=${r.band}  source=${r.bandSource}`);
  L.push(`critical_flags=${r.criticalFlags.length ? r.criticalFlags.join(", ") : "none"}`);
  for (const id of r.criticalFlags) {
    const label = CRITICAL_OVERRIDES.find((o) => o.id === id)?.label[lang] ?? id;
    L.push(`  override ${id}: ${label}`);
  }
  L.push("");

  // [SCORE BREAKDOWN] — WHY the number is what it is.
  L.push("[SCORE BREAKDOWN]  # WHY: each indicator's contribution to the base score");
  for (const c of r.contributing) {
    const sign = c.counted ? `+${c.weight}` : "  0";
    const label = indicatorById(c.id)?.label[lang] ?? "";
    L.push(`${sign}  id=${c.id}  cat=${c.category}  counted=${c.counted ? "yes" : "no"}  label=${q(label)}${c.note ? `  note=${q(c.note)}` : ""}`);
  }
  const e1 = indicatorById("E1");
  const e2 = indicatorById("E2");
  const e1c = e1 && e1.type === "coefficient" ? e1.coefficient : 1.3;
  const e2c = e2 && e2.type === "coefficient" ? e2.coefficient : 1.2;
  L.push(`coefficient E1 applied=${input.coefficients.E1 ? "yes" : "no"}  (x${e1c})`);
  L.push(`coefficient E2 applied=${input.coefficients.E2 ? "yes" : "no"}  (x${e2c})`);
  L.push("");

  // [INDICATOR SOURCES] — WHY each indicator was proposed (AI/OSINT rationale).
  const suggestionIds = Object.keys(input.suggestions);
  L.push("[INDICATOR SOURCES]  # WHY: what proposed each indicator (rationale)");
  if (suggestionIds.length === 0) {
    L.push("(none — indicators set manually by the human)");
  } else {
    const ticked = new Set(input.selectedIds);
    for (const id of suggestionIds) {
      const m = input.suggestions[id]!;
      const isTicked = ticked.has(id) || (id === "F1" && input.humanConfirmedF1);
      L.push(
        `id=${id}  confidence=${m.confidence}  ticked=${isTicked ? "yes" : "no"}  rationale=${q(scrub(m.rationale))}`,
      );
    }
  }
  L.push("");

  // OSINT sections.
  const o = input.osint;
  if (o) {
    // [OSINT TOOL RUNS] — WHERE we looked.
    L.push(`[OSINT TOOL RUNS]  # WHERE: ${o.tool_runs.length} source call(s)`);
    for (const tr of o.tool_runs) {
      const hits = candidateCount(tr.data);
      const parts = [
        tr.queried_at ? `at=${tr.queried_at}` : null,
        `tool=${tr.tool}`,
        `status=${tr.status}`,
        `available=${tr.available ? "yes" : "no"}`,
        hits !== null ? `hits=${hits}` : null,
        tr.source_url ? `source=${tr.source_url}` : null,
        tr.citation ? `cite=${q(scrub(tr.citation))}` : null,
        tr.note && (tr.status === "unavailable" || tr.status === "error" || tr.status === "no_match")
          ? `note=${q(scrub(tr.note))}`
          : null,
      ].filter(Boolean);
      L.push(parts.join("  "));
    }
    L.push("");

    // [WATCHLIST CANDIDATES] — HOW each matched.
    L.push(`[WATCHLIST CANDIDATES]  # HOW: query→entity overlap of ${o.watchlist_candidates.length} hit(s)`);
    if (o.watchlist_candidates.length === 0) {
      L.push("(none)");
    }
    for (const w of o.watchlist_candidates) {
      const score = typeof w.score === "number" ? w.score : null;
      const ex = explainMatch(w.query, w.matched_entity);
      const match = ex.fuzzyOnly ? "fuzzy" : "strong";
      L.push(
        `maps_to=${w.maps_to}  list=${q(w.list)}  score=${score === null ? "n/a" : score.toFixed(2)}  rate=${score === null ? "n/a" : rateName(score)}  match=${match}  pending_confirm=${w.pending_human_confirmation ? "yes" : "no"}`,
      );
      L.push(`  query =${q(w.query)}`);
      L.push(`  entity=${q(w.matched_entity)}`);
      const tokenNote =
        ex.strong.length || ex.fuzzy.length
          ? `matched_strong=[${ex.strong.join(", ")}]  matched_fuzzy=[${ex.fuzzy.join(", ")}]`
          : "matched_tokens=none (spelling/phonetic only — likely a different entity)";
      L.push(`  ${tokenNote}`);
      if (w.source_url) L.push(`  source=${w.source_url}`);
    }
    L.push("");

    // [EVIDENCE]
    if (o.evidence.length) {
      L.push("[EVIDENCE]");
      for (const ev of o.evidence) {
        L.push(`source=${q(ev.source)}  url=${q(ev.url)}  summary=${q(scrub(ev.summary))}`);
      }
      L.push("");
    }

    // [UNAVAILABLE SOURCES]
    L.push("[UNAVAILABLE SOURCES]  # absence of evidence is NOT evidence of innocence");
    L.push(o.unavailable_sources.length ? o.unavailable_sources.join(", ") : "(none)");
    L.push("");

    if (o.notes_for_user.trim()) {
      L.push("[OSINT NOTES]");
      L.push(scrub(o.notes_for_user));
      L.push("");
    }
  }

  // [AI INTERPRETATION] — reference only.
  if (input.interpretation && (input.interpretation.notes.trim() || input.interpretation.observations.length)) {
    L.push("[AI INTERPRETATION]  # reference only — the deterministic engine sets the band");
    if (input.interpretation.suggestedBand) L.push(`suggested_band=${input.interpretation.suggestedBand}`);
    if (input.interpretation.notes.trim()) L.push(`notes=${q(scrub(input.interpretation.notes))}`);
    for (const ob of input.interpretation.observations) L.push(`- ${scrub(ob)}`);
    L.push("");
  }

  L.push("# end of log");
  return L.join("\n");
}
