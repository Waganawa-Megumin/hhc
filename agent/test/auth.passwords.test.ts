import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordTooWeak } from "../src/auth/passwords";

describe("auth/passwords (scrypt)", () => {
  it("hashes (not plaintext) and verifies the right password", () => {
    const h = hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(verifyPassword("wrong password here", h)).toBe(false);
  });

  it("uses a random salt (two hashes of the same password differ)", () => {
    expect(hashPassword("samePassw0rd!")).not.toBe(hashPassword("samePassw0rd!"));
  });

  it("rejects tampered / malformed encodings without throwing", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$bad$enc")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });

  it("weakness gate flags short passwords", () => {
    expect(passwordTooWeak("short")).toBe(true);
    expect(passwordTooWeak("longenough1")).toBe(false);
  });
});
