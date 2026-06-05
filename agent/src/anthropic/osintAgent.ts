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

export interface OsintProgress {
  phase: "screening" | "model" | "finalize";
  /** Lightweight per-source status snapshot for a live "X sources checked" UI. */
  toolRuns: { tool: string; status: string }[];
}

export interface RunOsintOpts {
  maxSteps?: number;
  /** Wall-clock budget for the model tool-use loop. On exceed we finalize a PARTIAL
   * result (the deterministic screen still completes), rather than hang. Generous. */
  budgetMs?: number;
  /** Per-model-call timeout so one hung request can't stall the whole job. */
  stepTimeoutMs?: number;
  onProgress?: (p: OsintProgress) => void;
}

const DEFAULT_BUDGET_MS = 8 * 60_000;
const DEFAULT_STEP_TIMEOUT_MS = 90_000;

/** Reject if `p` doesn't settle within `ms` (the underlying work is abandoned). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("step_timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e as Error);
      },
    );
  });
}

export async function runOsint(
  hint: SubjectHint,
  tools: OsintTool[],
  call: LoopCaller,
  opts: RunOsintOpts = {},
): Promise<OsintResult> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  // The deterministic screen ALWAYS runs the list/registry/domain sources, so the
  // model doesn't need them — exposing them only invites duplicate calls (and, for
  // OpenSanctions, HTTP 429 rate-limiting). Advertise only the tools the screen
  // doesn't cover (web search, reverse-image links); the loop can still execute any
  // tool if asked.
  const screenToolNames = new Set([...F_SCREENING_TOOLS, ...CORP_SCREENING_TOOLS, ...DOMAIN_SCREENING_TOOLS]);
  const toolDefs: OsintToolDef[] = tools
    .filter((t) => !screenToolNames.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.available ? t.description : `${t.description} [UNAVAILABLE: ${t.unavailableReason ?? "n/a"} — will return 'unavailable'; treat absence as NOT evidence of innocence]`,
      input_schema: t.inputSchema,
    }));

  // Per-run call cache: an identical (tool, args) call is issued to the network only
  // once, even if both the model loop and the deterministic screen want it. Stores
  // the in-flight promise so concurrent identical calls share one request.
  const callCache = new Map<string, Promise<ToolRun>>();
  const callTool = (tool: OsintTool, args: Record<string, unknown>): Promise<ToolRun> => {
    const key = `${tool.name}:${JSON.stringify(args)}`;
    let p = callCache.get(key);
    if (!p) {
      p = (async () => {
        try {
          return await tool.run(args);
        } catch (e) {
          return errored(tool.name, (e as Error).message);
        }
      })();
      callCache.set(key, p);
    }
    return p;
  };

  const onProgress = opts.onProgress;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const startedAt = Date.now();
  const toolRuns: ToolRun[] = [];
  const report = (phase: OsintProgress["phase"]) => {
    try {
      onProgress?.({ phase, toolRuns: toolRuns.map((r) => ({ tool: r.tool, status: r.status })) });
    } catch {
      /* progress is best-effort; never let it break the run */
    }
  };

  // Run the reliable deterministic screen CONCURRENTLY with the model loop so the
  // most important signals (sanctions / registry / domain) are captured even if the
  // slow model loop is cut short by the budget. Each result is reported as it lands.
  const screenDone = deterministicScreen(tools, hint, callTool, (run) => {
    toolRuns.push(run);
    report("screening");
  });

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: buildOsintUserPrompt(hint) },
  ];
  const maxSteps = opts.maxSteps ?? 8;
  let lastText = "";
  let truncated = false;

  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() - startedAt > budgetMs) {
      truncated = true;
      break;
    }
    let resp: LoopResponse;
    try {
      resp = await withTimeout(
        call({ system: OSINT_SYSTEM, tools: toolDefs, messages, maxTokens: 2048 }),
        stepTimeoutMs,
      );
    } catch {
      truncated = true; // a model call timed out/errored — finalize with what we have
      break;
    }
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
      const run: ToolRun = tool ? await callTool(tool, input) : errored(name, "unknown tool");
      toolRuns.push(run);
      toolResults.push({
        type: "tool_result",
        tool_use_id: id,
        content: JSON.stringify(run),
        is_error: run.status === "error",
      });
    }
    report("model");
    messages.push({ role: "user", content: toolResults });
  }

  await screenDone; // ensure every deterministic-screen run is in toolRuns
  report("finalize");
  return finalizeOsint(hint, lastText, toolRuns, tools, { truncated });
}

// Run vs company + person (produce watchlist candidates).
const F_SCREENING_TOOLS = ["sanctions_opensanctions", "enduser_jp_meti", "screening_us_csl"];
// Run vs company name (corporate existence, A5 — visibility only, no auto-tick:
// absence from a registry is a weak signal, not proof of a fake).
const CORP_SCREENING_TOOLS = ["corp_jp", "corp_jp_aux", "corp_gleif", "corp_global"];
// Run vs domain (A2 — visibility only).
const DOMAIN_SCREENING_TOOLS = ["domain_rdap", "cert_ct"];

async function deterministicScreen(
  tools: OsintTool[],
  hint: SubjectHint,
  callTool: (tool: OsintTool, args: Record<string, unknown>) => Promise<ToolRun>,
  onRun?: (run: ToolRun) => void,
): Promise<ToolRun[]> {
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
        // Shared cache (never throws); label the citation with the query for display.
        const res = await callTool(tool, arg);
        const r: ToolRun = { ...res, citation: `${res.citation ?? toolName} — "${label}"` };
        onRun?.(r);
        return r;
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
  opts: { truncated?: boolean } = {},
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

  // De-duplicate the per-source list for display: the same (tool, args) call can be
  // pushed by both the model loop and the deterministic screen (the call cache
  // already prevented a second network request). Distinct queries/statuses survive.
  const dedupedRuns: ToolRun[] = [];
  const seenRun = new Set<string>();
  for (const r of toolRuns) {
    const key = `${r.tool}|${r.status}|${r.citation ?? ""}|${r.note ?? ""}`;
    if (seenRun.has(key)) continue;
    seenRun.add(key);
    dedupedRuns.push(r);
  }

  const matched = base.matched_indicators
    .filter((m) => isKnownIndicator(m.id) && indicatorById(m.id)?.type !== "coefficient")
    .map((m) => ({ ...m, rationale: stripForbiddenLabels(m.rationale).text }));

  // Surface every dark source: tools that ran unavailable/error AND tools that
  // were never callable (missing credential / offline). Absence ≠ exoneration.
  const unavailable_sources = [
    ...new Set([
      ...dedupedRuns.filter((r) => r.status === "unavailable" || r.status === "error").map((r) => r.tool),
      ...tools.filter((t) => !t.available).map((t) => t.name),
    ]),
  ];

  let notes = stripForbiddenLabels(base.notes_for_user).text;
  if (opts.truncated) {
    const partial =
      "※ 時間内に全ステップを完了できず、一部のソースのみの暫定結果です（制裁・法人・ドメインの決定論スクリーニングは完了）。識別子を確認のうえ「再OSINT」で続行できます。 / Partial result: the OSINT run hit its time budget; the deterministic screen completed — re-run OSINT to continue.";
    notes = notes ? `${notes}\n\n${partial}` : partial;
  }

  return {
    subject_hint: mergeHint(base.subject_hint, hint),
    matched_indicators: matched,
    watchlist_candidates: candidates,
    evidence: base.evidence,
    tool_runs: dedupedRuns,
    unavailable_sources,
    notes_for_user: notes,
  };
}
