// Email one-time codes for MFA. The plaintext code is emailed and never stored or
// returned over HTTP; only sha256(code) is persisted. Sending returns a clear status
// (so the UI can show "sent" / "couldn't send"), supports a resend cooldown, and is
// a graceful no-op when SMTP is unconfigured.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { env } from "../env";

export type EmailSendStatus = "sent" | "smtp_unavailable" | "send_failed";

export const EMAIL_CODE_TTL_MS = 5 * 60_000;
export const EMAIL_RESEND_COOLDOWN_MS = 45_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(String(code).trim()).digest("hex");
}

export function verifyCodeHash(code: string, storedHash: string): boolean {
  try {
    const a = Buffer.from(hashCode(code), "hex");
    const b = Buffer.from(storedHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function smtpConfigured(): boolean {
  return env.SMTP_HOST.trim().length > 0;
}

let transporter: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === "1",
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// Test seam: inject a fake sender so tests never touch SMTP.
type Sender = (to: string, code: string) => Promise<EmailSendStatus>;
let testSender: Sender | null = null;
export function setEmailSenderForTest(fn: Sender | null): void {
  testSender = fn;
}

export async function sendEmailCode(to: string, code: string): Promise<EmailSendStatus> {
  if (testSender) return testSender(to, code);
  if (!smtpConfigured()) return "smtp_unavailable";
  try {
    await getTransport().sendMail({
      from: env.SMTP_FROM || env.SMTP_USER || "hhc@localhost",
      to,
      subject: "HHC ログイン認証コード / verification code",
      text: `あなたのHHCログイン認証コード: ${code}\n（5分間有効。心当たりがなければ無視してください）\n\nYour HHC login verification code: ${code}\n(valid for 5 minutes; ignore if you did not request it)`,
    });
    return "sent";
  } catch {
    return "send_failed";
  }
}

/** Send an account-setup invitation link (no password). Graceful no-op if SMTP unset
 * — the caller still surfaces the link so the admin can share it manually. */
export async function sendInviteEmail(to: string, link: string): Promise<EmailSendStatus> {
  if (!smtpConfigured()) return "smtp_unavailable";
  try {
    await getTransport().sendMail({
      from: env.SMTP_FROM || env.SMTP_USER || "hhc@localhost",
      to,
      subject: "HHC アカウント設定の招待 / account setup invitation",
      text: `HHC のアカウントが作成されました。以下のリンクからパスワードと多要素認証(MFA)を設定してください（72時間有効）:\n${link}\n\nAn HHC account was created for you. Set your password and MFA via this link (valid 72 hours):\n${link}`,
    });
    return "sent";
  } catch {
    return "send_failed";
  }
}
