import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server";
import { openTestDb, type DB } from "../src/db/db";
import * as store from "../src/db/authStore";
import { queryAudit } from "../src/db/auditStore";
import { hashPassword } from "../src/auth/passwords";
import { newSessionToken, absoluteExpiry } from "../src/auth/sessions";

beforeAll(() => {
  process.env.HHC_AUTH = "1";
});
afterAll(() => {
  delete process.env.HHC_AUTH;
});

function seedReady(db: DB, email: string, role: "admin" | "user") {
  return store.insertUser(db, {
    email,
    passwordHash: hashPassword("Password12345"),
    role,
    mustChangePassword: false,
    mustEnrollMfa: false,
  });
}
function sessionCookie(db: DB, userId: string): string {
  const { raw, hash } = newSessionToken();
  store.createSession(db, { userId, tokenHash: hash, expiresAt: absoluteExpiry(), mfaSatisfied: true });
  return `hhc_session=${raw}`;
}
// onResponse runs after the reply is sent; give it a tick to flush the write.
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("audit log (onResponse hook)", () => {
  it("records an authed request with action / route / status / ip / user", async () => {
    const db = openTestDb();
    const u = seedReady(db, "u@hhc.local", "user");
    const app = buildServer({ db });
    await app.inject({ method: "GET", url: "/api/stats", headers: { cookie: sessionCookie(db, u.user_id) } });
    await flush();
    const { rows } = queryAudit(db, { action: "stats.view" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.route).toBe("/api/stats");
    expect(rows[0]!.method).toBe("GET");
    expect(rows[0]!.status).toBe(200);
    expect(rows[0]!.user_id).toBe(u.user_id);
    expect(rows[0]!.ip).toBeTruthy();
    await app.close();
  });

  it("records a failed (anonymous) login attempt — no body/password stored", async () => {
    const db = openTestDb();
    seedReady(db, "admin@hhc.local", "admin");
    const app = buildServer({ db });
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@hhc.local", password: "WRONGPASSWORD" } });
    await flush();
    const { rows } = queryAudit(db, { action: "login" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe(401);
    expect(rows[0]!.user_id).toBeNull();
    // The row carries only metadata columns — the password can't be anywhere in it.
    expect(JSON.stringify(rows[0]).includes("WRONGPASSWORD")).toBe(false);
    await app.close();
  });

  it("skips noisy routes (health is not audited)", async () => {
    const db = openTestDb();
    const app = buildServer({ db });
    await app.inject({ method: "GET", url: "/api/health" });
    await flush();
    const { rows } = queryAudit(db, {});
    expect(rows.some((r) => r.route === "/api/health")).toBe(false);
    await app.close();
  });
});
