// §7.4 volatility-based cache TTL. Re-investigation re-queries only stale sources.

export type Volatility = "low" | "high" | "short";

/** Days before a cached result of each volatility class is considered stale. */
export const TTL_DAYS: Record<Volatility, number> = {
  low: 90, // WHOIS/RDAP, corporate registry — rarely changes
  high: 3, // reputation / news / sanctions refresh — re-check often (1–7d)
  short: 1, // SNS activity / connections
};

export function ttlMs(v: Volatility): number {
  return TTL_DAYS[v] * 86_400_000;
}

/** Map an OSINT tool name to a volatility class. */
export function volatilityForSource(tool: string): Volatility {
  switch (tool) {
    case "domain_rdap":
    case "cert_ct":
    case "corp_jp":
    case "corp_jp_aux":
    case "corp_global":
      return "low";
    case "sanctions_opensanctions":
    case "enduser_jp_meti":
    case "screening_us_csl":
    case "web_search":
      return "high";
    case "reverse_image":
      return "short";
    default:
      return "high";
  }
}

export function isStale(fetchedAtIso: string, v: Volatility, now: number = Date.now()): boolean {
  const fetched = new Date(fetchedAtIso).getTime();
  if (Number.isNaN(fetched)) return true;
  return now - fetched > ttlMs(v);
}
