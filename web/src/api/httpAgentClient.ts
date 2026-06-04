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
