import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { authenticator } from "otplib";
import { buildServer } from "../src/server";
import { openTestDb, type DB } from "../src/db/db";
import * as store from "../src/db/authStore";
import { hashPassword } from "../src/auth/passwords";
import { newSessionToken, absoluteExpiry } from "../src/auth/sessions";

beforeAll(() => {
  process.env.HHC_AUTH = "1"; // isAuthEnabled() reads process.env live
});
afterAll(() => {
  delete process.env.HHC_AUTH;
});

function seedReady(db: DB, email: string, role: "admin" | "user", password = "Password12345") {
  return store.insertUser(db, {
    email,
    passwordHash: hashPassword(password),
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

describe("server auth: login, lockout, roles", () => {
  it("public /api/health works and reports auth on", async () => {
    const app = buildServer({ db: openTestDb() });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toBe(true);
    await app.close();
  });

  it("wrong password and unknown user both return generic invalid_credentials", async () => {
    const db = openTestDb();
    seedReady(db, "admin@hhc.local", "admin");
    const app = buildServer({ db });
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@hhc.local", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe("invalid_credentials");
    const ghost = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ghost@hhc.local", password: "nope" } });
    expect(ghost.statusCode).toBe(401);
    expect(ghost.json().error).toBe("invalid_credentials");
    await app.close();
  });

  it("locks out after too many failures", async () => {
    const db = openTestDb();
    seedReady(db, "admin@hhc.local", "admin");
    const app = buildServer({ db });
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@hhc.local", password: "bad" } });
    }
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@hhc.local", password: "Password12345" } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("locked");
    await app.close();
  });

  it("protected route: 401 without a session, 200 with one", async () => {
    const db = openTestDb();
    const u = seedReady(db, "u@hhc.local", "user");
    const app = buildServer({ db });
    expect((await app.inject({ method: "GET", url: "/api/stats" })).statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/api/stats", headers: { cookie: sessionCookie(db, u.user_id) } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("admin-only route: 403 for user, 200 for admin", async () => {
    const db = openTestDb();
    const admin = seedReady(db, "admin@hhc.local", "admin");
    const user = seedReady(db, "user@hhc.local", "user");
    const app = buildServer({ db });
    const asUser = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: sessionCookie(db, user.user_id) } });
    expect(asUser.statusCode).toBe(403);
    const asAdmin = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: sessionCookie(db, admin.user_id) } });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().users.length).toBe(2);
    await app.close();
  });
});

describe("server auth: onboarding + TOTP MFA end-to-end", () => {
  it("forces password change + MFA enrollment, then logs in with TOTP", async () => {
    const db = openTestDb();
    store.insertUser(db, {
      email: "boss@hhc.local",
      passwordHash: hashPassword("InitPassw0rd!"),
      role: "admin",
      mustChangePassword: true,
      mustEnrollMfa: true,
    });
    const app = buildServer({ db });

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@hhc.local", password: "InitPassw0rd!" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().mfaRequired).toBe(false);
    expect(login.json().mustChangePassword).toBe(true);
    const cookie = `hhc_session=${login.cookies.find((c) => c.name === "hhc_session")!.value}`;

    // Blocked until the password is changed.
    const blocked = await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("must_change_password");

    const cp = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: "InitPassw0rd!", newPassword: "BrandNewPassw0rd!" },
    });
    expect(cp.statusCode).toBe(200);
    expect(cp.json().mustEnrollMfa).toBe(true);

    // Still blocked: must enroll MFA.
    const blocked2 = await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } });
    expect(blocked2.statusCode).toBe(409);
    expect(blocked2.json().error).toBe("must_enroll_mfa");

    const enroll = await app.inject({ method: "POST", url: "/api/auth/mfa/enroll", headers: { cookie }, payload: { method: "totp" } });
    expect(enroll.statusCode).toBe(200);
    const secret = enroll.json().secret as string;
    expect(String(enroll.json().qrDataUrl).startsWith("data:image/png")).toBe(true);

    const confirm = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/confirm",
      headers: { cookie },
      payload: { method: "totp", code: authenticator.generate(secret) },
    });
    expect(confirm.statusCode).toBe(200);

    // Onboarding complete → protected route now works.
    expect((await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })).statusCode).toBe(200);

    // Logout, then a fresh login now requires the TOTP step.
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    const login2 = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@hhc.local", password: "BrandNewPassw0rd!" } });
    expect(login2.statusCode).toBe(200);
    expect(login2.json().mfaRequired).toBe(true);
    expect(login2.json().method).toBe("totp");
    const cookie2 = `hhc_session=${login2.cookies.find((c) => c.name === "hhc_session")!.value}`;
    const mfa = await app.inject({ method: "POST", url: "/api/auth/mfa", headers: { cookie: cookie2 }, payload: { code: authenticator.generate(secret) } });
    expect(mfa.statusCode).toBe(200);
    await app.close();
  });
});
