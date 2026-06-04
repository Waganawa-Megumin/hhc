// §6 AI interpret core — SDK-free so it is unit-testable with a stubbed model.
import {
  InterpretResultSchema,
  parseModelJson,
  stripForbiddenLabels,
  isKnownIndicator,
  indicatorById,
  type InterpretResult,
} from "@hhc/shared";
import { INTERPRET_SYSTEM } from "./prompts";

export interface ImageInput {
  /** e.g. "image/png" */
  mediaType: string;
  dataBase64: string;
}

export interface InterpretRequest {
  text: string;
  images: ImageInput[];
  /** §6 consent gate — must be true or the request is refused. */
  consent: boolean;
}

/** Abstraction over the model call so the SDK lives only in client.ts/server.ts. */
export type ModelComplete = (input: {
  system: string;
  userText: string;
  images: ImageInput[];
  maxTokens?: number;
}) => Promise<string>;

export type InterpretOutcome =
  | { ok: true; result: InterpretResult; degraded?: string }
  | { ok: false; error: string };

const EMPTY_RESULT: InterpretResult = {
  subject_hint: { company: "", domain: "", person: "", title: "" },
  matched_indicators: [],
  free_observations: [],
  evidence: [],
  suggested_band: undefined,
  notes_for_user: "",
};

/** Apply guardrails to a parsed result: drop unknown/coefficient ids, scrub labels. */
export function sanitizeInterpretResult(result: InterpretResult): InterpretResult {
  const matched = result.matched_indicators
    // Only keep ids that exist AND are human-tickable (weight/watchlist, not E coefficients).
    .filter((m) => isKnownIndicator(m.id) && indicatorById(m.id)?.type !== "coefficient")
    .map((m) => ({ ...m, rationale: stripForbiddenLabels(m.rationale).text }));

  return {
    subject_hint: result.subject_hint,
    matched_indicators: matched,
    free_observations: result.free_observations.map((o) => stripForbiddenLabels(o).text),
    evidence: result.evidence,
    suggested_band: result.suggested_band,
    notes_for_user: stripForbiddenLabels(result.notes_for_user).text,
  };
}

export async function interpret(req: InterpretRequest, complete: ModelComplete): Promise<InterpretOutcome> {
  if (!req.consent) {
    return { ok: false, error: "consent_required" };
  }
  if (!req.text.trim() && req.images.length === 0) {
    return { ok: false, error: "empty_input" };
  }

  let raw: string;
  try {
    raw = await complete({ system: INTERPRET_SYSTEM, userText: req.text, images: req.images, maxTokens: 1024 });
  } catch (e) {
    return { ok: false, error: `model_error: ${(e as Error).message}` };
  }

  const parsed = parseModelJson(raw, InterpretResultSchema);
  if (!parsed.ok) {
    // Never throw on model drift — return a structured "could not interpret".
    return {
      ok: true,
      result: {
        ...EMPTY_RESULT,
        notes_for_user:
          "AIの出力を解釈できませんでした。チェックリストは手動で入力してください。 / Could not parse the AI output; please fill the checklist manually.",
      },
      degraded: parsed.error,
    };
  }

  return { ok: true, result: sanitizeInterpretResult(parsed.value) };
}
