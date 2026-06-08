# HHC — Launch Guide (GitHub Codespaces)

> 🌐 **English** ｜ [日本語](../ja/launch-guide.md)

How to start, pull updates, troubleshoot, and stop — every time.

---

## ⚡ TL;DR (just this, each time)

1. Open your Codespace at <https://github.com/codespaces> (or the repo → **Code ▸ Codespaces**).
2. It auto-starts (a VS Code dev task). Wait a few tens of seconds.
3. Bottom **"PORTS" tab → `5173` → 🌐 (Open in Browser)**.

> If it didn't auto-start or has stopped, run `npm run dev` in a terminal, then open 5173.

---

## 1. Prerequisites (one-time setup)

Register Codespaces **secrets** (GitHub → repo → **Settings ▸ Secrets and variables ▸ Codespaces**). After adding/changing a secret, apply it with **Rebuild Container** (below).

Minimum:
- `HHC_KEY` … Anthropic API key (for §6 interpret / §7 OSINT). `ANTHROPIC_API_KEY` also works.

Optional (unlock more features):
- `HHC_DB_KEY` … passphrase for case history (the encrypted DB).
- `HHC_OPENSANCTIONS_API_KEY` / `HHC_TRADEGOV_API_KEY` / `HHC_GBIZ_INFO_API_KEY` … sanctions / corporate screening.

> **Layer-1 (checklist + score)** works even with no secrets.

---

## 2. Starting it (detailed)

1. **Open the Codespace**: <https://github.com/codespaces> → open it (or repo → Code ▸ Codespaces ▸ Create).
2. **Wait for auto-start**: the `HHC dev` task runs `npm run dev` (agent + web).
   - If asked "Allow automatic tasks?", choose **Allow**.
3. **Confirm startup**: success when the terminal shows **both**:
   - `VITE v5...  ready` and `➜ Local: http://localhost:5173/`
   - `[hhc-agent] http://127.0.0.1:8787  model=... key=true caseDb=true`
     - `key=false` → Anthropic key not injected (→ Rebuild); `caseDb=false` → `HHC_DB_KEY` not injected
4. **Open in browser**: bottom **PORTS tab → the `5173` row → 🌐 Open in Browser**.
   - "Open in Preview" (inside the editor) is fine too.
   - ⚠️ Typing `localhost:5173` on your own PC won't connect. **Always use the link in the PORTS tab.**

If it didn't auto-start, run it manually:
```bash
npm run dev
```

---

## 3. A second terminal (for commands)

`npm run dev` is a long-running foreground process, so that terminal stays busy (normal).
**Run other commands (`git pull`, etc.) in a second terminal**:

- The **`+` (New Terminal)** at the top-right of the terminal panel, or **Terminal ▸ New Terminal**.

---

## 4. Pulling updates / applying secrets

In the second terminal:
```bash
git pull
```
- Usually `tsx watch` (agent) and Vite HMR (web) **auto-reload** — just refresh the browser.
- If it seems stale, restart the dev terminal with **Ctrl+C → `npm run dev`**.

Special cases:
- **New dependencies** (`Cannot find module ...`) → `npm install`, then `npm run dev`.
- **Added/changed a secret** → **Rebuild Container** (F1 → "Codespaces: Rebuild Container"). The `data/` case DB is preserved.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `5173` not in PORTS | Server not running. `npm run dev`; check the output for errors |
| `Cannot find module ...` | `npm install` → `npm run dev` (a pull added a dependency) |
| Can't open in browser | Use the **🌐 in the PORTS tab**, not raw `localhost` |
| It's on `5174` etc. | 5173 was in use. Use the actual URL/port shown in the log |
| `key=false` persists | Anthropic key not injected → Rebuild Container (or Stop→Start) |
| `caseDb=false` persists | `HHC_DB_KEY` not injected → Rebuild |
| OSINT shows `unavailable` | That source's key is unset (`sanctions_opensanctions`=OpenSanctions, `screening_us_csl`=Trade.gov, …) |
| Stops connecting after a while | Codespaces auto-stops after ~30 min idle. Resume from <https://github.com/codespaces> → `npm run dev` |

---

## 6. Stopping & preserving case history

- **Stop the server**: click the dev terminal → **Ctrl+C**.
- **Stop the Codespace**: <https://github.com/codespaces> → your Codespace → Stop (saves compute time).
- ⚠️ **Case history (the encrypted DB under `data/`) is lost if you DELETE the Codespace** (preserved across Stop/Start and Rebuild).
  - For long-term storage, use the app's "Case history" panel → **encrypted export (.age)** → **import** into another Codespace (same `HHC_DB_KEY`).

---

## 7. Secrets quick reference

| Name | Purpose | Required |
|---|---|---|
| `HHC_KEY` (or `ANTHROPIC_API_KEY`) | §6 interpret / §7 OSINT (Anthropic API) | for §6/§7 |
| `HHC_DB_KEY` | encrypted case-history DB (and accounts when auth is on) | optional |
| `HHC_OPENSANCTIONS_API_KEY` | sanctions/PEP/METI screening (OpenSanctions) | optional |
| `HHC_TRADEGOV_API_KEY` | US CSL (OFAC/BIS Entity List, etc.) | optional |
| `HHC_GBIZ_INFO_API_KEY` | gBizINFO (JP companies, auxiliary) | optional |
| `HHC_HOUJIN_APP_ID` | NTA corporate number (JP companies, primary) | optional |
| `HHC_OPENCORPORATES_TOKEN` | OpenCorporates (global companies, optional) | optional |

> Global company existence works keyless via **GLEIF (`corp_gleif`)**, so OpenCorporates is not required.

---

## Authentication, accounts & MFA (optional)

By default (`HHC_AUTH=0`) it stays login-free. Set **`HHC_AUTH=1`** to require login for the whole app (email-ID accounts, **Admin/User** roles, password + **MFA (TOTP / email)**, admin user management). Accounts live in the encrypted DB, so `HHC_DB_KEY` and `HHC_SESSION_SECRET` are **required**.

**Enable** (Codespaces secrets or `.env`):
```
HHC_AUTH=1
HHC_DB_KEY=<strong passphrase>
HHC_SESSION_SECRET=<e.g. openssl rand -base64 48>
HHC_ADMIN_EMAIL=you@example.com
HHC_ADMIN_INITIAL_PASSWORD=<temp password>
# only for email MFA: SMTP_HOST/PORT/SECURE/USER/PASS/FROM (else TOTP)
```

- **First run**: the first admin is created from `HHC_ADMIN_*` → first login **forces a password change → MFA enrollment** (TOTP shows a QR; email has a resend button). Then manage users at **`/admin`**.
- **Dev (HMR)**: `npm run dev` — the SPA (5173) proxies `/api` to the authed agent (8787); the cookie is same-origin.
- **Served edge (real client IP for the audit log)**: `npm run serve` — Fastify serves the SPA + API directly on **8787** (`0.0.0.0` / `trustProxy`). Make **port 8787 public** to share in this mode.
- MFA email / geo degrade gracefully if unavailable (TOTP recommended). Passwords, codes, and keys are never logged.

> ⚠️ With `HHC_AUTH=1`, if any of the four (DB key, session secret, admin email, initial password) is unset, the agent refuses to start (so misconfiguration is caught early).

See the [admin guide](admin-guide.md) for full operations.

---

## Limited demo sharing (login-free, public port)

> ⚠️ This applies **only when `HHC_AUTH=0`** (login-free). With `HHC_AUTH=1` the whole app requires login and this login-free sharing no longer applies.

A way to show a few people, **login-free**, via a URL. The Codespace runs **only while you have it running**, so API spend stays under your control.

> You only need to make **5173 (web)** public. The backend (8787) is proxied internally by Vite, so keep it private.

**Option A: via the PORTS tab (GUI)**
1. Bottom **PORTS tab** → right-click the `5173` row.
2. Select **Port Visibility → Public**.
3. Copy the `5173` **Forwarded Address** (`https://…-5173.app.github.dev`) and share it.

**Option B: via the terminal (CLI, faster)**
```bash
gh codespace ports visibility 5173:public -c "$CODESPACE_NAME"
```
Check the URL in the PORTS tab or via `gh codespace ports -c "$CODESPACE_NAME"`.

> If you get `gh: command not found`, this devcontainer image just lacks the GitHub CLI. **Use Option A (GUI)** — no rebuild, reliable.

**After the demo (recommended)**
- Set it back to private: `gh codespace ports visibility 5173:private -c "$CODESPACE_NAME"`
- Or **Stop** the Codespace (<https://github.com/codespaces>).

**Notes**
- **Public = anyone with the URL can access without auth.** §6/§7 use your Anthropic key (billed). Don't post the URL publicly.
- The case-DB endpoints (recall/stats/export) are reachable too. For demos, **don't enter sensitive case data**, or **start without `HHC_DB_KEY`** (case history off).
- If org policy forbids public ports, **Public is greyed out** (usually fine on a personal repo).
- Codespaces auto-stops after ~30 min idle; keep interacting during a demo or resume afterward.

### The "reverts to Private every time" problem

By GitHub's design, **port visibility resets to Private on every restart/Rebuild** (there's no official "default public" for a devcontainer). Three options:

1. **Auto-publish (best-effort, implemented)**: on start it tries to make `5173` public (`.devcontainer/publish-port.sh` via `postStartCommand`). It needs permissions:
   - The GitHub CLI (installed via a devcontainer feature → **first time needs a Rebuild**).
   - A token with the `codespace` scope. **The default Codespace token often lacks it**; if so, add a **PAT (classic, scopes: `codespace` and `repo`) as the Codespaces secret `GH_TOKEN`** → Rebuild.
   - Check `cat /tmp/hhc-publish-port.log` (`port 5173 set to PUBLIC` = success).
2. **Manual (reliable, one click)**: PORTS tab → right-click `5173` → **Public**.
3. **Restart less**: raise the **Default idle timeout** at <https://github.com/settings/codespaces> (up to 240 min). Less auto-stop = fewer resets. Don't Stop during a demo.

---
See also: [README](../../README.md) · [Architecture](architecture.md) · [Admin guide](admin-guide.md)
