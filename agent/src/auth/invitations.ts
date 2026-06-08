// Invitation tokens for admin-initiated account setup. The admin "adds" a user; we
// create a single-use, expiring token and email a setup link. The user sets their
// own password (no initial password) and then enrolls MFA. The raw token lives only
// in the link; the DB stores sha256(token).
import { randomBytes } from "node:crypto";
import type { DB } from "../db/db";
import * as store from "../db/authStore";
import { sha256hex } from "./sessions";
import { hashPassword, passwordTooWeak } from "./passwords";

const INVITE_TTL_MS = 72 * 3600 * 1000; // 72h

export function createInvite(db: DB, userId: string, email: string): { rawToken: string; expiresAt: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  store.createInvitation(db, { userId, email, tokenHash: sha256hex(rawToken), expiresAt });
  return { rawToken, expiresAt };
}

export interface InviteInfo {
  ok: boolean;
  email?: string;
}
export function inspectInvite(db: DB, rawToken: string): InviteInfo {
  const inv = store.findInvitationByTokenHash(db, sha256hex(rawToken));
  if (!inv || inv.used_at || Date.now() >= Date.parse(inv.expires_at)) return { ok: false };
  return { ok: true, email: inv.email };
}

export type AcceptResult = { ok: true; userId: string } | { ok: false; error: string };

/** Validate the token, set the user's chosen password, activate the account, and
 * consume the invite. Used only for brand-new (invited) accounts setting up. */
export function acceptInvite(db: DB, rawToken: string, password: string): AcceptResult {
  const tokenHash = sha256hex(rawToken);
  const inv = store.findInvitationByTokenHash(db, tokenHash);
  if (!inv || inv.used_at || Date.now() >= Date.parse(inv.expires_at)) return { ok: false, error: "invite_invalid" };
  if (passwordTooWeak(password)) return { ok: false, error: "weak_password" };
  const user = store.getUserById(db, inv.user_id);
  if (!user) return { ok: false, error: "invite_invalid" };
  store.setPasswordHash(db, user.user_id, hashPassword(password), false); // fresh password, not a "change"
  store.setStatus(db, user.user_id, "active"); // from "invited"
  store.markInvitationUsed(db, tokenHash);
  return { ok: true, userId: user.user_id };
}
