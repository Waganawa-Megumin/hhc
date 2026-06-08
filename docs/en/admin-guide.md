# HHC — Administrator Guide

> 🌐 **English** ｜ [日本語](../ja/admin-guide.md)

For administrators running HHC with authentication enabled (`HHC_AUTH=1`). Kept in sync with releases.

## 1. Enabling & prerequisites

`HHC_AUTH=1` makes the **whole app login-gated**. Required secrets (Codespaces or `.env`):

```
HHC_AUTH=1
HHC_DB_KEY=<strong passphrase>          # encrypted-DB key. Lost = unrecoverable; changed = old DB unreadable
HHC_SESSION_SECRET=<openssl rand -base64 48>
HHC_ADMIN_EMAIL=you@example.com         # the first admin
HHC_ADMIN_INITIAL_PASSWORD=<temp pw>    # must be changed at first login
# optional: SMTP_* (invite email / email MFA), HHC_AUDIT_RETENTION_DAYS, HHC_SIEM_*
```

> If any required value is missing the agent refuses to start (`auth_misconfigured`). Full list: [architecture](architecture.md) and `.env.example`.

## 2. First-time setup

1. Set the above and start (`npm run serve` recommended; the log shows `auth=true`).
2. The first admin is created on boot (log: `bootstrap admin created: <email>` — **the password is never logged**).
3. Open the public URL (port `8787` in served mode) → login screen.
4. Log in with `HHC_ADMIN_EMAIL` + the initial password → **change password** → **enroll MFA** (TOTP QR or email code).
5. Operate from `/admin` thereafter.

## 3. User management (`/admin` → Users)

- **Invite user**: enter email + role → **no initial password is issued**.
  - An invite link is shown on screen. With SMTP configured the **invitation email is sent automatically**; otherwise **share the link manually**.
  - The user opens the link to "set password → set up MFA" (acceptance activates the account). The link is **single-use, valid 72h**.
- **Resend invite**: re-issue a fresh link for an invited user (the old link is voided).
- **Change role**: Admin / User (you can't demote yourself or the last active admin).
- **Disable / Enable**: disabling immediately revokes sessions and blocks login.
- **Reset password**: issues a temporary password (shown once; the user changes it next login). Kept separate from the invite flow (to avoid MFA bypass).
- **Reset MFA**: clears MFA and forces re-enrollment (also revokes sessions).

### Role permissions
- **User**: normal features — interpret, OSINT, reports, case history.
- **Admin**: the above + user management + the audit dashboard.

## 4. MFA

- **TOTP** (Google Authenticator, etc.): set up from the QR / manual secret at enrollment. No SMTP, works offline — **recommended**.
- **Email codes**: a one-time code per login. **Requires SMTP.** The challenge screen has a **resend button (with cooldown)**.
- If SMTP is unavailable or sending fails it is shown clearly. Prefer TOTP in locked-down networks.

## 5. Audit log (`/admin` → Audit)

- **Category tabs**: All / **Auth** (login, MFA, logout, …) / **Operations** (OSINT, report, case save, …) / **Admin** (user ops, audit views).
- **Recorded fields**: timestamp, user, action, status, source IP, location (geo), User-Agent, **detail**.
  - Detail = the **processed search query sent to the APIs** (OSINT company/domain/name/title, etc.). **Pasted text, passwords, and MFA codes are never recorded.**
- **Filters**: date range, action, email. **Paginated.**
- **Retention**: rows older than `HHC_AUDIT_RETENTION_DAYS` (default 30) are **auto-deleted daily** (0 = keep forever). The active value is shown on screen.
- **Export**: download **CSV / JSON** honoring the current filters.
- **SIEM forwarding**: when `HHC_SIEM_URL` is set, each event is forwarded to **Splunk HEC** (`HHC_SIEM_FORMAT=splunk`, `HHC_SIEM_TOKEN`) or a **generic JSON webhook** (`=json`). Local recording is kept even if forwarding fails.

## 6. Operations, backup & recovery

- **Backup**: UI → Case history → **age-encrypted export (.age)** (decrypt with `HHC_DB_KEY`). Migrate by importing with the same key.
  - Note: accounts and audit are not in the `.age` export. To retain those, copy the (already-encrypted) `data/hhc-cases.db` and manage the key separately.
- **Stop/restart**: after changing secrets, restart (Codespaces: Rebuild / Stop→Start). `data/` is preserved.
- **Key handling**: losing `HHC_DB_KEY` makes all data unrecoverable. Store it safely; do not change it.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `auth_misconfigured` on start | Missing required secret(s) (`HHC_DB_KEY` / `HHC_SESSION_SECRET` / admin vars). Set and restart |
| No login screen (`auth=false`) | Secrets not injected. Rebuild / Stop→Start (see the [launch guide](launch-guide.md)) |
| Invitation email not received | SMTP unset/failed. Share the on-screen invite link, or configure `SMTP_*` |
| Location shows "unknown" | Loopback/internal IP, or `npm run dev` (real IP not visible). Real IP needs `npm run serve` + a TLS proxy |
| MFA code rejected | TOTP: check device clock drift. Email: resend. Last resort: an admin "Reset MFA" |
| Can't disable the last admin | By design (at least one admin is protected). Create another admin first |

---
See also: [README](../../README.md) · [Architecture](architecture.md) · [Launch guide (Codespaces)](launch-guide.md)
