import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server";
import { openTestDb, type DB } from "../src/db/db";
import * as store from "../src/db/authStore";
import { hashPassword } from "../src/auth/passwords";
import { newSessionToken, absoluteExpiry } from "../src/auth/sessions";

beforeAll(() => {
  process.env.HHC_AUTH = "1";
});
afterAll(() => {
  delete process.env.HHC_AUTH;
});

function adminCookie(db: DB): string {
  const admin = store.insertUser(db, {
    email: "admin@hhc.local",
    passwordHash: hashPassword("Password12345"),
    role: "admin",
    mustChangePassword: false,
    mustEnrollMfa: false,
  });
  const { raw, hash } = newSessionToken();
  store.createSession(db, { userId: admin.user_id, tokenHash: hash, expiresAt: absoluteExpiry(), mfaSatisfied: true });
  return `hhc_session=${raw}`;
}

describe("invitation flow (admin adds user → emailed link → self setup)", () => {
  it("creates an invited user (no password), accepts the invite, then can log in", async () => {
    const db = openTestDb();
    const cookie = adminCookie(db);
    const app = buildServer({ db });

    // Admin "adds" the user — no initial password; we get an invite link back.
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie },
      payload: { email: "newbie@hhc.local", role: "user" },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.user.status).toBe("invited");
    expect(body.inviteLink).toContain("/invite/");
    expect(body.emailStatus).toBe("smtp_unavailable"); // no SMTP in tests → link shared manually
    const token = String(body.inviteLink).split("/invite/")[1]!;

    // The invited user cannot log in yet (no usable password).
    const earlyLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "newbie@hhc.local", password: "anything" } });
    expect(earlyLogin.statusCode).toBe(401);

    // The invite token is valid (public lookup).
    const info = await app.inject({ method: "GET", url: `/api/invite/${token}` });
    expect(info.statusCode).toBe(200);
    expect(info.json().email).toBe("newbie@hhc.local");

    // Accept: set a password → session issued, must enroll MFA next.
    const accept = await app.inject({ method: "POST", url: "/api/invite/accept", payload: { token, password: "NewbiePassw0rd!" } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().mustEnrollMfa).toBe(true);
    expect(accept.cookies.find((c) => c.name === "hhc_session")).toBeTruthy();

    // The token is single-use.
    const reuse = await app.inject({ method: "POST", url: "/api/invite/accept", payload: { token, password: "Another12345" } });
    expect(reuse.statusCode).toBe(401);

    // Now the account is active and the chosen password works.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "newbie@hhc.local", password: "NewbiePassw0rd!" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().mustEnrollMfa).toBe(true);
    await app.close();
  });

  it("rejects an invalid/expired token", async () => {
    const db = openTestDb();
    const app = buildServer({ db });
    expect((await app.inject({ method: "GET", url: "/api/invite/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/invite/accept", payload: { token: "nope", password: "Password12345" } })).statusCode).toBe(401);
    await app.close();
  });
});
