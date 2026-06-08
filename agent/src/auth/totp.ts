// TOTP (RFC 6238) via otplib + a server-rendered QR (qrcode) so the web bundle
// needs no QR/crypto deps. The secret is base32; callers store it sealed (secretBox).
import { authenticator } from "otplib";
import QRCode from "qrcode";

// Accept the current step plus ±1 (clock skew tolerance).
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret(); // base32
}

/** otpauth://totp/HHC:<email>?secret=...&issuer=HHC — what an authenticator app scans. */
export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, "HHC", secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: String(token).replace(/\s+/g, ""), secret });
  } catch {
    return false;
  }
}

export async function totpQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 });
}
