// §7 OSINT verification agent — the tool-use loop. SDK-free core (the loop caller
// is injected) so it is unit-testable with a scripted model.
import {
  OsintResultSchema,
  parseModelJson,
  stripForbiddenLabels,
  isKnownIndicator,
  indicatorById,
  type OsintResult,
  type SubjectHint,
  type WatchlistCandidate,
  type ToolRun,
} from "@hhc/shared";
import { errored } from "../tools/http";
import type { OsintTool, ToolInputSchema } from "../tools/types";
import { OSINT_SYSTEM, buildOsintUserPrompt } from "./prompts";

export interface OsintToolDef {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

interface Block {
  type: string;
  [k: string]: unknown;
}
export interface LoopResponse {
  content: Block[];
  stop_reason: string | null;
}
export type LoopCaller = (params: {
  system: string;
  tools: OsintToolDef[];
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  maxTokens: number;
}) => Promise<LoopResponse>;

export async function runOsint(
  hint: SubjectHint,
  tools: OsintTool[],
  call: LoopCaller,
  opts: { maxSteps?: number } = {},
): Promise<OsintResult> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolDefs: OsintToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.available ? t.description : `${t.description} [UNAVAILABLE: ${t.unavailableReason ?? "n/a"} — will return 'unavailable'; treat absence as NOT evidence of innocence]`,
    input_schema: t.inputSchema,
  }));

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: buildOsintUserPrompt(hint) },
  ];
  const toolRuns: ToolRun[] = [];
  const maxSteps = opts.maxSteps ?? 8;
  let lastText = "";

  for (let step = 0; step < maxSteps; step++) {
    const resp = await call({ system: OSINT_SYSTEM, tools: toolDefs, messages, maxTokens: 2048 });
    messages.push({ role: "assistant", content: resp.content });

    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => String((b as { text?: string }).text ?? ""))
      .join("\n");
    if (text.trim()) lastText = text;

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

    const toolResults: unknown[] = [];
    for (const tu of toolUses) {
      const name = String(tu.name ?? "");
      const id = String(tu.id ?? "");
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const tool = byName.get(name);
      let run: ToolRun;
      try {
        run = tool ? await tool.run(input) : errored(name, "unknown tool");
      } catch (e) {
        run = errored(name, (e as Error).message);
      }
      toolRuns.push(run);
      toolResults.push({
        type: "tool_result",
        tool_use_id: id,
        content: JSON.stringify(run),
        is_error: run.status === "error",
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Deterministic screening: always run every list/registry source (not dependent
  // on whether the model chose to call them), so each source's result is reliable
  // and visible. F sources run vs company + person; corporate-existence sources
  // (A5) run vs company; domain sources vs the domain.
  toolRuns.push(...(await deterministicScreen(tools, hint)));

  return finalizeOsint(hint, lastText, toolRuns, tools);
}

// Run vs company + person (produce watchlist candidates).
const F_SCREENING_TOOLS = ["sanctions_opensanctions", "enduser_jp_meti", "screening_us_csl"];
// Run vs company name (corporate existence, A5 — visibility only, no auto-tick:
// absence from a registry is a weak signal, not proof of a fake).
const CORP_SCREENING_TOOLS = ["corp_jp", "corp_jp_aux", "corp_gleif", "corp_global"];
// Run vs domain (A2 — visibility only).
const DOMAIN_SCREENING_TOOLS = ["domain_rdap", "cert_ct"];

async function deterministicScreen(tools: OsintTool[], hint: SubjectHint): Promise<ToolRun[]> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const company = hint.company?.trim();
  const person = hint.person?.trim();
  const domain = hint.domain?.trim();
  const jobs: Promise<ToolRun>[] = [];

  const run = (toolName: string, arg: Record<string, unknown>, label: string) => {
    const tool = byName.get(toolName);
    if (!tool) return;
    jobs.push(
      (async () => {
        try {
          const r = await tool.run(arg);
          return { ...r, citation: `${r.citation ?? toolName} — "${label}"` };
        } catch (e) {
          return errored(toolName, `"${label}": ${(e as Error).message}`);
        }
      })(),
    );
  };

  for (const name of [company, person].filter((s): s is string => !!s)) {
    for (const t of F_SCREENING_TOOLS) run(t, { name }, name);
  }
  if (company) for (const t of CORP_SCREENING_TOOLS) run(t, { name: company }, company);
  if (domain) for (const t of DOMAIN_SCREENING_TOOLS) run(t, { domain }, domain);

  return Promise.all(jobs);
}

function mergeHint(model: SubjectHint | undefined, fallback: SubjectHint): SubjectHint {
  return {
    company: model?.company || fallback.company,
    domain: model?.domain || fallback.domain,
    person: model?.person || fallback.person,
    title: model?.title || fallback.title,
  };
}

/** Build the final result. Watchlist candidates and unavailable sources are derived
 * deterministically from the tool runs — not taken on the model's word. */
export function finalizeOsint(
  hint: SubjectHint,
  lastText: string,
  toolRuns: ToolRun[],
  tools: OsintTool[] = [],
): OsintResult {
  const parsed = parseModelJson(lastText, OsintResultSchema);
  const base: OsintResult = parsed.ok
    ? parsed.value
    : {
        subject_hint: hint,
        matched_indicators: [],
        watchlist_candidates: [],
        evidence: [],
        tool_runs: [],
        unavailable_sources: [],
        notes_for_user:
          "OSINTエージェントの最終出力を解釈できませんでした。 / Could not parse the OSINT agent's final output.",
      };

  // Deterministic watchlist candidates from tool data (never from the model),
  // de-duplicated across the agent's calls and the deterministic screening pass.
  const candidates: WatchlistCandidate[] = [];
  const seen = new Set<string>();
  for (const r of toolRuns) {
    const data = r.data as { candidates?: WatchlistCandidate[] } | undefined;
    if (data && Array.isArray(data.candidates)) {
      for (const c of data.candidates) {
        const key = `${c.list}|${c.matched_entity}|${c.query}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ ...c, pending_human_confirmation: true });
      }
    }
  }

  const matched = base.matched_indicators
    .filter((m) => isKnownIndicator(m.id) && indicatorById(m.id)?.type !== "coefficient")
    .map((m) => ({ ...m, rationale: stripForbiddenLabels(m.rationale).text }));

  // Surface every dark source: tools that ran unavailable/error AND tools that
  // were never callable (missing credential / offline). Absence ≠ exoneration.
  const unavailable_sources = [
    ...new Set([
      ...toolRuns.filter((r) => r.status === "unavailable" || r.status === "error").map((r) => r.tool),
      ...tools.filter((t) => !t.available).map((t) => t.name),
    ]),
  ];

  return {
    subject_hint: mergeHint(base.subject_hint, hint),
    matched_indicators: matched,
    watchlist_candidates: candidates,
    evidence: base.evidence,
    tool_runs: toolRuns,
    unavailable_sources,
    notes_for_user: stripForbiddenLabels(base.notes_for_user).text,
  };
}
