// Keyless IP geolocation for the audit log. Mirrors the OSINT tool pattern: never
// throws, short timeout, graceful degradation. Private/loopback IPs and offline mode
// skip the lookup; results are cached in-memory (ip-api keyless is rate-limited).
import { fetchJson } from "../tools/http";
import { env, isOffline } from "../env";

export interface GeoResult {
  status: "ok" | "unavailable" | "error";
  country?: string;
  region?: string;
  city?: string;
}

const cache = new Map<string, { value: GeoResult; at: number }>();
const TTL_MS = 24 * 3600 * 1000;

/** RFC1918 / loopback / link-local / ULA — not publicly geolocatable. */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/i, ""); // IPv4-mapped IPv6
  if (v === "127.0.0.1" || v === "::1" || v === "0.0.0.0") return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true; // link-local
  if (/^(fc|fd)/i.test(v)) return true; // IPv6 ULA
  if (/^fe80:/i.test(v)) return true; // IPv6 link-local
  return false;
}

export async function geoLookup(ip: string | null | undefined): Promise<GeoResult> {
  if (!ip || env.HHC_GEO_ENABLED !== "1" || isOffline() || isPrivateIp(ip)) {
    return { status: "unavailable" };
  }
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const base = env.HHC_GEO_BASE_URL.replace(/\/$/, "");
  const url = `${base}/${encodeURIComponent(ip)}?fields=status,country,regionName,city`;
  const res = await fetchJson(url, {}, 2500);
  let value: GeoResult;
  if (res.error || !res.ok || typeof res.data !== "object" || res.data === null) {
    value = { status: "error" };
  } else {
    const d = res.data as { status?: string; country?: string; regionName?: string; city?: string };
    value =
      d.status === "success"
        ? { status: "ok", country: d.country, region: d.regionName, city: d.city }
        : { status: "error" };
  }
  cache.set(ip, { value, at: Date.now() });
  return value;
}
