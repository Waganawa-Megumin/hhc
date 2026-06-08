import { describe, it, expect } from "vitest";
import { authenticator } from "otplib";
import { generateTotpSecret, totpKeyUri, verifyTotp, totpQrDataUrl } from "../src/auth/totp";

describe("auth/totp", () => {
  it("verifies a freshly generated code and rejects garbage", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(authenticator.generate(secret), secret)).toBe(true);
    expect(verifyTotp("abcdef", secret)).toBe(false); // non-numeric → false, deterministic
  });

  it("builds an otpauth URI and a PNG QR data URL", async () => {
    const secret = generateTotpSecret();
    const uri = totpKeyUri("user@example.com", secret);
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("issuer=HHC");
    const qr = await totpQrDataUrl(uri);
    expect(qr.startsWith("data:image/png;base64,")).toBe(true);
  });
});
