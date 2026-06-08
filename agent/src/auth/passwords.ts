// Password hashing with node:crypto scrypt — zero extra dependencies. Format:
//   scrypt$N$r$p$saltB64$hashB64
// Verification is constant-time. Plaintext passwords are never stored or logged.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384; // CPU/memory cost (~16MB at r=8); within scrypt's 32MB default
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || expected.length === 0) return false;
    const actual = scryptSync(plain, salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Minimal strength gate for new/changed passwords (UI enforces too). */
export function passwordTooWeak(plain: string): boolean {
  return typeof plain !== "string" || plain.length < 10;
}
