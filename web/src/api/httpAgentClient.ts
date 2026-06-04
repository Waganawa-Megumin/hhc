// Talks to the local agent backend via the Vite dev proxy (/api → 127.0.0.1:8787).
import {
  InterpretResultSchema,
  OsintResultSchema,
  type InterpretResult,
  type OsintResult,
  type SubjectHint,
} from "@hhc/shared";
import { AgentBackendUnavailableError, type AgentClient, type InterpretRequest } from "./agentClient";

export interface AgentHealth {
  ok: boolean;
  model: string;
  offline: boolean;
  anthropicKey: boolean;
  caseDb: boolean;
}

export async function getAgentHealth(): Promise<AgentHealth | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    return (await res.json()) as AgentHealth;
  } catch {
    return null;
  }
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
      body: JSON.stringify(identifiers),
    });
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
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `http_${res.status}`);
  return data as unknown as RecordInquiryResponse;
}

export async function fetchStats(): Promise<{ enabled: boolean; stats?: unknown } | null> {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) return null;
    return (await res.json()) as { enabled: boolean; stats?: unknown };
  } catch {
    return null;
  }
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AgentBackendUnavailableError();
  }
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

  async runOsintAgent(hint: SubjectHint): Promise<OsintResult> {
    const data = (await postJson("/api/osint", hint)) as { result?: unknown };
    const parsed = OsintResultSchema.safeParse(data.result);
    if (!parsed.success) throw new Error("invalid_osint_response");
    return parsed.data;
  },
};
