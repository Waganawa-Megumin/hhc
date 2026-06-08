// AES-256-GCM "sealed box" for at-rest TOTP secrets — defense-in-depth on top of
// the SQLCipher-encrypted DB. The key is derived from HHC_SESSION_SECRET, so a
// plaintext-DB swap path can't leak live MFA seeds. Format: v1$ivB64$tagB64$ctB64.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../env";

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(env.HHC_SESSION_SECRET || "hhc-dev-only-secret", "hhc-secretbox-v1", 32);
  return cachedKey;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1$${iv.toString("base64")}$${tag.toString("base64")}$${enc.toString("base64")}`;
}

export function open(sealed: string): string {
  const [v, ivB, tagB, ctB] = sealed.split("$");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new Error("bad_sealed_format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
