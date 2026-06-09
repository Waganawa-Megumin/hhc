import { describe, it, expect } from "vitest";
import { openTestDb } from "../src/db/db";
import * as store from "../src/db/authStore";
import { hashPassword } from "../src/auth/passwords";
import { newSessionToken, sha256hex, absoluteExpiry } from "../src/auth/sessions";

describe("auth/sessions store", () => {
  it("persists only the token hash, looks up by it, and revokes", () => {
    const db = openTestDb();
    const u = store.insertUser(db, { email: "a@b.co", passwordHash: hashPassword("xxxxxxxxxx"), role: "user" });
    const { raw, hash } = newSessionToken();
    const sid = store.createSession(db, {
      userId: u.user_id,
      tokenHash: hash,
      expiresAt: absoluteExpiry(),
      mfaSatisfied: true,
    });

    const row = db.prepare("SELECT token_hash FROM sessions WHERE session_id = ?").get(sid) as { token_hash: string };
    expect(row.token_hash).toBe(hash);
    expect(row.token_hash).not.toBe(raw); // the raw cookie token is never stored

    expect(store.findSessionByTokenHash(db, sha256hex(raw))?.user_id).toBe(u.user_id);
    store.deleteSession(db, sid);
    expect(store.findSessionByTokenHash(db, sha256hex(raw))).toBeUndefined();
    db.close();
  });

  it("counts recent PASSWORD failures split by email/ip (MFA fails excluded), and clears", () => {
    const db = openTestDb();
    const since = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 3; i++)
      store.recordLoginAttempt(db, { email: "x@y.co", ip: "1.2.3.4", success: false, reason: "invalid_credentials" });
    store.recordLoginAttempt(db, { email: "x@y.co", ip: "1.2.3.4", success: false, reason: "mfa_fail" }); // not counted
    expect(store.recentFailureCounts(db, "x@y.co", "9.9.9.9", since).byEmail).toBe(3);
    expect(store.recentFailureCounts(db, "other@y.co", "1.2.3.4", since).byIp).toBe(3);
    store.clearLoginFailures(db, "x@y.co");
    expect(store.recentFailureCounts(db, "x@y.co", "1.2.3.4", since).byEmail).toBe(0);
    db.close();
  });
});
