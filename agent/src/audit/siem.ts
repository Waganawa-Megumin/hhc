// Optional SIEM forwarding of audit events (e.g. Splunk HTTP Event Collector or a
// generic JSON webhook). Fire-and-forget and fully graceful — forwarding never
// blocks a response, never throws, and never breaks auditing if the SIEM is down.
import { env } from "../env";
import type { AuditRow } from "../db/auditStore";

export function siemEnabled(): boolean {
  return env.HHC_SIEM_URL.trim().length > 0;
}

export async function forwardAudit(row: AuditRow): Promise<void> {
  if (!siemEnabled()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    let body: string;
    if (env.HHC_SIEM_FORMAT === "json") {
      // Generic webhook: post the event; bearer token if provided.
      if (env.HHC_SIEM_TOKEN) headers["Authorization"] = `Bearer ${env.HHC_SIEM_TOKEN}`;
      body = JSON.stringify({ source: "hhc", sourcetype: "hhc:audit", event: row });
    } else {
      // Splunk HTTP Event Collector envelope.
      if (env.HHC_SIEM_TOKEN) headers["Authorization"] = `Splunk ${env.HHC_SIEM_TOKEN}`;
      body = JSON.stringify({ time: Math.floor(Date.parse(row.ts) / 1000), sourcetype: "hhc:audit", event: row });
    }
    await fetch(env.HHC_SIEM_URL, { method: "POST", headers, body, signal: controller.signal });
  } catch {
    // SIEM unreachable / TLS / timeout — auditing to the local DB already succeeded.
  } finally {
    clearTimeout(timer);
  }
}
