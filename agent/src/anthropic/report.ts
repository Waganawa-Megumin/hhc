// §5-7 integrated report — an AI-organized Markdown report built ON TOP of the
// deterministic assessment (which stays authoritative). The model organizes and
// explains the facts; it does not change the band/score or invent findings.
import {
  buildReportDraft,
  stripForbiddenLabels,
  type AssessmentSummary,
  type Lang,
  type WatchlistCandidate,
  type ToolRun,
} from "@hhc/shared";
import type { ModelComplete } from "./interpret";

export interface ReportRequest {
  lang: Lang;
  assessment: AssessmentSummary;
  watchlist_candidates?: WatchlistCandidate[];
  tool_runs?: ToolRun[];
  osint_notes?: string;
}

export type ReportOutcome = { ok: true; report: string } | { ok: false; error: string };

const SYSTEM = `You are the report writer for HHC (Human Hunter Check), a defensive counter-intelligence self-triage tool. Produce ONE well-structured Markdown report in the requested language, organizing and explaining the DETERMINISTIC assessment you are given.

Authoritative inputs (do NOT change them, do NOT invent findings beyond them):
- the risk band, score, matched indicators, OSINT per-source results, and watchlist candidates with their match strength.

Write these sections (translate the headings into the requested language):
1. Summary (概要)
2. Risk verdict — band, score, the band-threshold legend (low/mid/high ranges from the draft's "判定基準/criteria" section), and which critical indicators fired AND what each means (リスク判定). Keep the scoring-criteria legend so the reader can interpret a number like 17.
3. Matched indicators and why (該当指標と理由)
4. OSINT results — render the per-source results as a Markdown TABLE with columns "Source / Status / Detail" (translate the headers); then list watchlist candidates with their match strength and which part matched (OSINT結果)
5. Recommended actions (推奨アクション)
6. Plain-language explanation of the reasoning (解説)
7. Notes / caveats (注記)

Each source has a "state" — map it to a precise, NON-misleading status label and NEVER conflate these three:
- "not_configured" → it was NOT queried because an API key/credential is unset (or offline). Say e.g. "未照会（APIキー未設定）" / "not queried (no API key)". Do NOT write "取得不可"/"failed"/"取得して不一致". This is a configuration gap, not a result.
- "query_failed" → it WAS queried but the request errored (HTTP/network). Say e.g. "照会失敗（エラー）" / "query failed (error)".
- "no_match" → it WAS queried successfully and found nothing. Say e.g. "該当なし（照会済み）" / "no match (queried OK)". This is a real negative result — clearly different from "not_configured".
- "ok"/"hit(N)" → queried successfully; N candidate(s) where shown.
Put the source's note in the Detail column when present.

Hard rules:
- Never call anyone a "spy"/工作員/agent; never assert that a person IS a foreign agent or assert their identity.
- Never assert or infer nationality/ethnicity; state in the notes that nationality was not used to compute the score.
- "No evidence" is not innocence — absence from a list does not lower risk. But a not_configured source is not even "no evidence" — it simply was not checked.
- This is advisory, not a verdict; the human decides. Sanctions/watchlist matches are candidates pending human confirmation.
Output Markdown only — no code fences, no preamble.`;

export async function generateReport(req: ReportRequest, complete: ModelComplete): Promise<ReportOutcome> {
  const draft = buildReportDraft(req.assessment, req.lang); // deterministic ground truth
  const facts = {
    band: req.assessment.band,
    score: req.assessment.score,
    band_source: req.assessment.bandSource,
    critical_flags: req.assessment.criticalFlags,
    matched_indicators: req.assessment.matchedIndicatorIds,
    subject: req.assessment.subject,
    nationality_context: req.assessment.nationalityContext ?? "",
    watchlist_candidates: (req.watchlist_candidates ?? []).map((w) => ({
      list: w.list,
      matched_entity: w.matched_entity,
      query: w.query,
      score: w.score,
      maps_to: w.maps_to,
    })),
    sources: (req.tool_runs ?? []).map((r) => {
      const cands = Array.isArray((r.data as { candidates?: unknown[] } | undefined)?.candidates)
        ? (r.data as { candidates: unknown[] }).candidates.length
        : 0;
      const state =
        r.status === "ok"
          ? cands > 0
            ? `hit(${cands})`
            : "ok"
          : r.status === "no_match"
            ? "no_match"
            : r.status === "error"
              ? "query_failed"
              : r.available
                ? "unavailable"
                : "not_configured";
      return { tool: r.tool, state, citation: r.citation, note: r.note };
    }),
    unavailable_sources: req.assessment.unavailableSources,
    osint_notes: req.osint_notes ?? "",
  };

  const userText = [
    `Language: ${req.lang}`,
    "",
    "## DETERMINISTIC DRAFT (authoritative — do not change the band/score)",
    draft.body,
    "",
    "## STRUCTURED DATA (JSON)",
    JSON.stringify(facts, null, 2),
  ].join("\n");

  let raw: string;
  try {
    raw = await complete({ system: SYSTEM, userText, images: [], maxTokens: 3000 });
  } catch (e) {
    return { ok: false, error: `model_error: ${(e as Error).message}` };
  }
  const clean = stripForbiddenLabels(raw).text.trim();
  if (!clean) return { ok: false, error: "empty_report" };
  return { ok: true, report: clean };
}
