# HHC — Architecture & Deployment Requirements

> 🌐 **English** ｜ [日本語](../ja/architecture.md)

What you need to build and run HHC **in general** (not only in Codespaces).

## 1. Structure (monorepo)

Three npm workspaces:

- **`shared/`** — indicator KB, deterministic scoring, schemas, guardrails (dependency-free "single source of truth").
- **`web/`** — React + Vite UI (JA/EN). Layer-1 (checklist + score) needs no key and no network.
- **`agent/`** — Node 22 + Fastify. Holds the Anthropic key, the encrypted DB, auth, and audit. **The API key always stays server-side.**

### Run modes
| Mode | Start | Public edge | Use |
|---|---|---|---|
| Dev | `npm run dev` | Vite `5173` (proxies `/api` → agent `8787`) | development / HMR |
| Served | `npm run serve` | Fastify `8787` (serves the SPA + API directly, `0.0.0.0`, `trustProxy`) | production · **when the real client IP is needed** |

`npm run serve` sets `HHC_SERVE_WEB=1 HHC_AUTH=1`, builds `web`, and Fastify serves the built assets.

## 2. What to provide (minimum → optional)

| Area | Item | Required? | Notes |
|---|---|---|---|
| Runtime | Node.js 20+ (22 recommended), npm | Yes | `npm install` builds the native SQLCipher driver (a C/C++ toolchain may be needed; usually a prebuild avoids it) |
| Auth | `HHC_AUTH=1` | For login mode | Requires login for the whole app |
| Auth | `HHC_DB_KEY` | Yes (with auth) | Key for the encrypted DB (accounts, sessions, audit, case history). **Lost = unrecoverable; changed = existing DB unreadable** |
| Auth | `HHC_SESSION_SECRET` | Yes (with auth) | Signs sessions + seals the TOTP secret. `openssl rand -base64 48` |
| Auth | `HHC_ADMIN_EMAIL` / `HHC_ADMIN_INITIAL_PASSWORD` | First run only | Creates the first admin on first boot (forced password change + MFA enrollment at first login) |
| DB | (no external DB) | — | **Embedded SQLite (SQLCipher) file** `data/hhc-cases.db`. No DB server to run. **Persist `data/`** |
| AI | `ANTHROPIC_API_KEY` (or `HHC_KEY`) | Optional | §6 interpret / §7 OSINT. Layer-1 works without it |
| Email | `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Optional | **Invitation emails** and **email MFA**. Unset → invites are shared via the on-screen link and MFA uses TOTP |
| OSINT | `HHC_HOUJIN_APP_ID` / `HHC_GBIZ_INFO_API_KEY` / `HHC_OPENCORPORATES_TOKEN` / `HHC_OPENSANCTIONS_API_KEY` / `HHC_TRADEGOV_API_KEY` | Optional | External sources; unset = that source reports "not queried" |
| Audit | `HHC_AUDIT_RETENTION_DAYS` (default 30) | Optional | Auto-delete window for audit rows (0 = keep forever) |
| Audit | `HHC_GEO_ENABLED` / `HHC_GEO_BASE_URL` | Optional | Geolocate the client IP (keyless; degrades gracefully) |
| Audit | `HHC_SIEM_URL` / `HHC_SIEM_TOKEN` / `HHC_SIEM_FORMAT` | Optional | Forward audit events to Splunk HEC / a generic webhook |
| Serving | TLS reverse proxy | Recommended in prod | See below |

All variables are documented in [`.env.example`](../../.env.example).

## 3. General production deployment

```bash
npm ci                 # install deps (builds SQLCipher)
npm test               # optional: network-free, key-free tests
# Provide .env (required + optional from the table) or inject env vars.
npm run serve          # build → Fastify serves SPA + API on 8787 (HHC_AUTH=1)
```

- **TLS / reverse proxy**: in production put nginx / Caddy / a cloud LB in front, terminate TLS, forward to `8787`.
  - For the real client IP, set **`X-Forwarded-For` / `X-Forwarded-Proto`** (Fastify `trustProxy` reads them).
  - Over HTTPS, cookies are `Secure` (set automatically in served mode).
- **Process management**: run under systemd / pm2 / a container with auto-restart.
- **Persistence**: put `data/` (the encrypted DB) on a durable volume (mount it in containers).
- **Backup**: in the UI, Case history → **age-encrypted export (.age)**. Accounts/audit can be backed up by copying the (encrypted) DB file; keep the key separately.

### Docker (essentials)
- Base on `mcr.microsoft.com/devcontainers/typescript-node:22` (or similar); `npm ci && npm run build`.
- `CMD HHC_SERVE_WEB=1 HHC_AUTH=1 node --import tsx agent/src/server.ts` (or `npm run serve`).
- Mount `data/` as a volume; inject secrets from your secret store; expose only `8787` behind a TLS proxy.

## 4. Data & persistence

- Everything lives in **one SQLCipher file** `data/hhc-cases.db` (`subjects`/`inquiries`/`evidence_cache`/`users`/`mfa`/`sessions`/`login_attempts`/`invitations`/`audit_logs`), encrypted at rest.
- **Export/import**: case data is portable via age encryption (`.age`). **Credentials and audit are NOT included in the .age export** (to prevent credential exfiltration).
- The schema is applied idempotently at startup (`CREATE TABLE IF NOT EXISTS` + additive column migrations).

## 5. Network / ports

- Inbound: expose only the serving port (default `8787`).
- Outbound (only when configured): Anthropic API, OSINT sources, SMTP, SIEM, geo API. In a locked-down network these degrade gracefully (Layer-1 is fully offline-capable; `HHC_OFFLINE=1`).

## 6. Security notes

- Passwords = scrypt; TOTP secret = AES-GCM sealed; session token = sha256 at rest (raw token only in the cookie).
- Passwords / codes / keys / pasted text are **never logged**. Audit rows carry no demographic data.
- Login lockout, anti-enumeration, MFA (TOTP/email), role authorization (Admin/User).
- Audit auto-deletes by retention, forwards to SIEM, and exports as CSV/JSON.

## 7. Scaling & limits (important)

- Currently **single-node**: OSINT jobs live **in process memory**, and the DB is a **local SQLite file**.
- So **horizontal scaling (multiple instances) is not supported** as-is (sessions/jobs/DB aren't shared). For availability, run a single instance with auto-restart + backups. To scale later you'd swap in a shared DB (e.g. Postgres) and an external session store — the driver is isolated in `agent/src/db/db.ts` with `authStore`/`auditStore` as the seams.

---
See also: [README](../../README.md) · [Launch guide (Codespaces)](launch-guide.md) · [Admin guide](admin-guide.md)
