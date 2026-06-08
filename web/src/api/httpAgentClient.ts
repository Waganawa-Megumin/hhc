// Talks to the local agent backend via the Vite dev proxy (/api → 127.0.0.1:8787).
import {
  InterpretResultSchema,
  OsintResultSchema,
  type InterpretResult,
  type OsintResult,
  type SubjectHint,
} from "@hhc/shared";
import {
  AgentBackendUnavailableError,
  type AgentClient,
  type InterpretRequest,
  type OsintProgress,
} from "./agentClient";

export interface AgentHealth {
  ok: boolean;
  model: string;
  offline: boolean;
  anthropicKey: boolean;
  caseDb: boolean;
  /** True when the backend enforces login (HHC_AUTH=1). */
  auth?: boolean;
}

export async function getAgentHealth(): Promise<AgentHealth | null> {
  try {
    const res = await fetch("/api/health", { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as AgentHealth;
  } catch {
    return null;
  }
}

/** Set by AuthProvider; invoked when any API call returns 401 so the UI can
 * bounce the user to the login screen (session expired / revoked). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}
function noteStatus(status: number): void {
  if (status === 401 && onUnauthorized) onUnauthorized();
}

export interface CaseIdentifiers {
  company?: string;
  domain?: string;
  person?: string;
  handle?: string;
  email?: string;
  phone?: string;
}

export interface RecallResponse {
  ok: boolean;
  enabled: boolean;
  known: boolean;
  subject: {
    subjectId: string;
    clusterId: string;
    inquiryCount: number;
    latestBand: "low" | "mid" | "high" | null;
    firstSeen: string;
    lastSeen: string;
    bandHistory: Array<{ ts: string; band: "low" | "mid" | "high" }>;
  } | null;
  clusterSuggestions: Array<{ subjectId: string; clusterId: string; company: string; score: number }>;
}

export async function recallSubject(identifiers: CaseIdentifiers): Promise<RecallResponse | null> {
  try {
    const res = await fetch("/api/subject/recall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(identifiers),
    });
    noteStatus(res.status);
    if (!res.ok) return null;
    return (await res.json()) as RecallResponse;
  } catch {
    return null;
  }
}

export interface RecordInquiryBody {
  identifiers: CaseIdentifiers;
  score: number;
  band: "low" | "mid" | "high";
  matchedIndicatorIds: string[];
  theme?: string;
  evidenceKeys?: string[];
}

export interface RecordInquiryResponse {
  ok: boolean;
  subjectId: string;
  clusterId: string;
  inquiryCount: number;
  diff: {
    changed: boolean;
    firstTime: boolean;
    newIndicators: string[];
    lostIndicators: string[];
    scoreDelta: number;
    bandChange: { from: string; to: string } | null;
    newEvidence: string[];
  };
}

export async function recordInquiry(body: RecordInquiryBody): Promise<RecordInquiryResponse> {
  const res = await fetch("/api/inquiry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  noteStatus(res.status);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `http_${res.status}`);
  return data as unknown as RecordInquiryResponse;
}

export async function fetchStats(): Promise<{ enabled: boolean; stats?: unknown } | null> {
  try {
    const res = await fetch("/api/stats", { credentials: "include" });
    noteStatus(res.status);
    if (!res.ok) return null;
    return (await res.json()) as { enabled: boolean; stats?: unknown };
  } catch {
    return null;
  }
}

export async function exportCase(): Promise<{ filename: string; data: string }> {
  const res = await fetch("/api/export", { credentials: "include" });
  noteStatus(res.status);
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : `http_${res.status}`);
  return { filename: String(d.filename), data: String(d.data) };
}

export interface ImportResult {
  subjects: number;
  inquiries: number;
  evidence_cache: number;
}

export interface ReportRequestBody {
  lang: "ja" | "en";
  assessment: unknown;
  watchlist_candidates?: unknown[];
  tool_runs?: unknown[];
  osint_notes?: string;
}

/** §5-7 integrated report (AI-organized). Throws on no key / offline / error. */
export async function generateReport(body: ReportRequestBody): Promise<string> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  noteStatus(res.status);
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : `http_${res.status}`);
  return String(d.report ?? "");
}

export async function importCase(data: string): Promise<ImportResult> {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data }),
  });
  noteStatus(res.status);
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : `http_${res.status}`);
  return d as unknown as ImportResult;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    throw new AgentBackendUnavailableError();
  }
  noteStatus(res.status);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = typeof data.error === "string" ? data.error : `http_${res.status}`;
    throw new Error(err);
  }
  return data;
}

export const httpAgentClient: AgentClient = {
  async analyzeApproach(req: InterpretRequest): Promise<InterpretResult> {
    const data = (await postJson("/api/interpret", req)) as { result?: unknown };
    const parsed = InterpretResultSchema.safeParse(data.result);
    if (!parsed.success) throw new Error("invalid_interpret_response");
    return parsed.data;
  },

  // §7 runs as a background job; start it then poll so we never hold a long request.
  // The server caps its own work to a budget and always finalizes (partial if it ran
  // long), so this generous deadline is just a safety net; we also surface progress.
  async runOsintAgent(hint: SubjectHint, onProgress?: (p: OsintProgress) => void): Promise<OsintResult> {
    const start = (await postJson("/api/osint", hint)) as { jobId?: string };
    if (!start.jobId) throw new Error("osint_no_job");
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      let res: Response;
      try {
        res = await fetch(`/api/osint/${start.jobId}`, { credentials: "include" });
      } catch {
        continue; // transient network blip — keep polling
      }
      noteStatus(res.status);
      if (res.status === 404) throw new Error("osint_job_lost");
      if (!res.ok) continue;
      const d = (await res.json().catch(() => ({}))) as {
        status?: string;
        result?: unknown;
        error?: string;
        progress?: OsintProgress;
      };
      if (d.progress && onProgress) onProgress(d.progress);
      if (d.status === "done") {
        const parsed = OsintResultSchema.safeParse(d.result);
        if (!parsed.success) throw new Error("invalid_osint_response");
        return parsed.data;
      }
      if (d.status === "error") throw new Error(d.error ?? "osint_error");
    }
    throw new Error("osint_timeout");
  },
};
