// Session token + cookie helpers. The raw opaque token lives only in the client's
// httpOnly cookie; the DB stores only sha256(token), so a DB leak can't be replayed.
import { createHash, randomBytes } from "node:crypto";
import { env, isServeWeb } from "../env";

export const SESSION_COOKIE = "hhc_session";

export function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function newSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256hex(raw) };
}

export function absoluteExpiry(from = new Date()): string {
  return new Date(from.getTime() + env.HHC_SESSION_TTL_HOURS * 3600_000).toISOString();
}

/** A short window to complete the MFA challenge after a correct password. */
export function challengeExpiry(from = new Date()): string {
  return new Date(from.getTime() + 5 * 60_000).toISOString();
}

/** True if the session is past its absolute expiry or has been idle too long. */
export function isSessionStale(expiresAtIso: string, lastSeenAtIso: string, now = Date.now()): boolean {
  if (now >= Date.parse(expiresAtIso)) return true;
  const idleMs = env.HHC_SESSION_IDLE_MIN * 60_000;
  return now - Date.parse(lastSeenAtIso) > idleMs;
}

export interface CookieOpts {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(maxAgeSec: number): CookieOpts {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Secure only makes sense when Fastify is the HTTPS edge (served mode);
    // in local dev over http the cookie must not be Secure or it won't be set.
    secure: isServeWeb(),
    path: "/",
    maxAge: maxAgeSec,
  };
}

export const SESSION_TTL_SEC = (): number => Math.floor(env.HHC_SESSION_TTL_HOURS * 3600);
