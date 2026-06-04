import type { ToolRun } from "@hhc/shared";

/** The "honest absence" note attached to every unavailable/no_match envelope. */
export const ABSENCE_NOTE =
  "source unavailable / no evidence — NOT evidence of innocence (absence from a list never lowers risk)";

export function nowIso(): string {
  return new Date().toISOString();
}

export function ok(tool: string, data: unknown, opts: Partial<ToolRun> = {}): ToolRun {
  return { tool, status: "ok", available: true, queried_at: nowIso(), data, ...opts };
}

export function noMatch(tool: string, opts: Partial<ToolRun> = {}): ToolRun {
  return { tool, status: "no_match", available: true, queried_at: nowIso(), note: ABSENCE_NOTE, ...opts };
}

export function unavailable(tool: string, note?: string): ToolRun {
  return { tool, status: "unavailable", available: false, queried_at: nowIso(), note: note ?? ABSENCE_NOTE };
}

export function errored(tool: string, message: string): ToolRun {
  return { tool, status: "error", available: true, queried_at: nowIso(), note: `${message} — ${ABSENCE_NOTE}` };
}

export interface FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

/** fetch + JSON parse with a hard timeout. Never throws; returns a result object. */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { accept: "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
