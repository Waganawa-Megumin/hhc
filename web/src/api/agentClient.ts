// Abstract interface between Layer-1 (this keyless UI) and the keyed agent backend
// (§6 interpret / §7 OSINT), added in later phases. Layer-1 never requires it.
import type { InterpretResult, OsintResult, SubjectHint } from "@hhc/shared";

export interface InterpretImage {
  /** e.g. "image/png" */
  mediaType: string;
  /** base64 (no data: prefix) of a pasted screenshot. */
  dataBase64: string;
}

export interface InterpretRequest {
  text: string;
  images: InterpretImage[];
  /** Explicit consent to send to the model (§6 consent gate). */
  consent: boolean;
}

/** Live OSINT progress for a "N sources checked" indicator while the job runs. */
export interface OsintProgress {
  phase: string;
  toolRuns: { tool: string; status: string }[];
}

export interface AgentClient {
  /** §6: pasted text/screenshots → checklist prefill suggestions (human confirms). */
  analyzeApproach(req: InterpretRequest): Promise<InterpretResult>;
  /** §7: public/lawful OSINT corroboration for an identified subject. */
  runOsintAgent(hint: SubjectHint, onProgress?: (p: OsintProgress) => void): Promise<OsintResult>;
}

export class AgentBackendUnavailableError extends Error {
  constructor() {
    super("The HHC agent backend is not running. Layer-1 works without it; start the agent for §6/§7.");
    this.name = "AgentBackendUnavailableError";
  }
}

/** Placeholder used until the agent backend (Phase B+) is wired in. */
export const noopAgentClient: AgentClient = {
  async analyzeApproach() {
    throw new AgentBackendUnavailableError();
  },
  async runOsintAgent() {
    throw new AgentBackendUnavailableError();
  },
};
