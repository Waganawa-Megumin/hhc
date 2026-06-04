// §7.2 subject identity normalization. Pure + dependency-free. Hashing to a
// subject_id is done server-side (agent) over the STABLE identifiers only —
// registrable domain + verified email/phone — never the company name.

// A small public-suffix subset so common multi-part TLDs resolve to eTLD+1 while
// keeping shared/ offline and dep-free. Not exhaustive; good enough for triage.
const MULTI_PART_SUFFIXES = new Set([
  "co.jp", "or.jp", "ne.jp", "go.jp", "ac.jp", "ad.jp", "ed.jp", "gr.jp", "lg.jp",
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "com.hk", "com.tw", "com.sg", "com.au", "net.au", "org.au",
  "com.br", "com.mx", "co.kr", "or.kr", "co.in", "co.za",
]);

// ASCII legal-entity suffix TOKENS (matched after dots are removed, so "k.k." → "kk").
const ASCII_SUFFIXES = new Set([
  "incorporated", "inc", "ltd", "limited", "llc", "llp", "corp", "corporation",
  "co", "company", "gmbh", "ag", "plc", "kk", "pte", "pty", "sarl", "bv", "nv", "spa", "srl",
]);

// Japanese legal-entity words removed as substrings.
const JP_SUFFIXES = ["株式会社", "有限会社", "合同会社", "合資会社", "合名会社"];

function stripScheme(s: string): string {
  return s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

/** Registrable domain (eTLD+1), lowercased. Accepts URLs, hosts, or emails. */
export function registrableDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) s = s.slice(s.indexOf("@") + 1);
  s = stripScheme(s);
  s = s.split("/")[0]!.split("?")[0]!.split("#")[0]!;
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  const parts = s.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** Normalize a company name: lowercase, strip legal suffixes + punctuation, collapse spaces. */
export function normalizeCompany(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/\./g, ""); // remove dots so "k.k." → "kk", "ltd." → "ltd"
  s = s.replace(/[,，、。()（）/|]/g, " "); // separators → space
  let tokens = s.split(/\s+/).filter(Boolean);
  tokens = tokens.filter((tok) => !ASCII_SUFFIXES.has(tok));
  let joined = tokens.join(" ");
  for (const suf of JP_SUFFIXES) joined = joined.split(suf).join("");
  return joined.replace(/\s+/g, " ").trim();
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Loose E.164-ish normalization: keep leading +, strip non-digits. */
export function normalizePhone(input: string): string {
  const s = input.trim();
  const plus = s.startsWith("+") ? "+" : "";
  return plus + s.replace(/\D/g, "");
}

/** Normalize a profile URL/handle to host+path (lowercased, no trailing slash). */
export function normalizeHandle(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  s = stripScheme(s).replace(/^www\./, "");
  return s.replace(/\/+$/, "");
}

export interface RawIdentifiers {
  company?: string;
  domain?: string;
  person?: string;
  handle?: string;
  email?: string;
  phone?: string;
}

export interface NormalizedIdentifiers {
  company: string;
  domain: string;
  handle: string;
  email: string;
  phone: string;
}

export function normalizeIdentifiers(raw: RawIdentifiers): NormalizedIdentifiers {
  return {
    company: normalizeCompany(raw.company ?? ""),
    domain: registrableDomain(raw.domain ?? raw.email ?? ""),
    handle: normalizeHandle(raw.handle ?? ""),
    email: normalizeEmail(raw.email ?? ""),
    phone: normalizePhone(raw.phone ?? ""),
  };
}

/**
 * Canonical string over STABLE identifiers only (registrable domain + verified
 * email/phone). The agent hashes this to subject_id. Company name is intentionally
 * excluded — name similarity is a human-confirmed suggestion, not an identity.
 */
export function stableIdentifierString(n: NormalizedIdentifiers): string {
  const parts = [
    n.domain ? `domain:${n.domain}` : "",
    n.email ? `email:${n.email}` : "",
    n.phone ? `phone:${n.phone}` : "",
  ].filter(Boolean);
  return parts.sort().join("|");
}
