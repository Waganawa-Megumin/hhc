# HHC — Human Hunter Check

A **local-first, self-triage tool** to help you assess whether a job / headhunting
approach (often on LinkedIn) is actually a **foreign-intelligence recruitment
attempt** — and to corroborate it from **public, lawful** OSINT sources.

Built from the design spec (`HHC_design_v1.1.md`), aligned with the 2026 Five Eyes
joint warning, UK NPSA *Think Before You Link*, and Japan PSIA economic-security
guidance.

## What it is — and is NOT

- It **never** labels a person a "spy" and **never** renders a guilty/innocent
  verdict. Output is only a **risk band (low / medium / high)** plus a
  **recommended action**.
- It uses **public, lawful sources only** (no LinkedIn scraping, no login-gated
  access).
- **Nationality and ethnicity are never scored.** Demographic profiling is both
  discriminatory and a poor predictor (real tradecraft uses third-country fronts
  and fake Western identities). The "state / intelligence nexus" you actually care
  about is captured by **category F** — matching the entity, person, and
  **affiliated institution** (employer / university / research institute) against
  public danger lists (OFAC, BIS Entity List, OpenSanctions, PEP, METI, …).
  Education is judged by **verifiability (B3)** and **listed-institution match
  (F)**, not by where someone studied. A claimed nationality may be shown as
  **non-scored context** for your own judgement only.
- "No evidence" is **not** evidence of innocence. Absence from a list never lowers
  the score.

## Status

| Phase | Scope | State |
|------|-------|-------|
| **A** | Layer-1: A–F checklist, deterministic §3 scoring + critical-flag overrides, bands + 4R actions, JA/EN, offline | ✅ implemented |
| B | §6 AI interpret (pasted text / screenshots → checklist prefill) | ⏳ planned |
| C | §7 OSINT verification agent + tool registry (RDAP, crt.sh, OpenSanctions, Trade.gov CSL, …) | ⏳ planned |
| D | Encrypted local case DB, smart cache, diff, stats | ⏳ planned |
| E | Evidence snapshots, report drafts, calibration, CI | ⏳ planned |

## Architecture

A local-first monorepo (npm workspaces):

- **`shared/`** — the single source of truth: `indicators.json` (§2), the
  authoritative deterministic scoring + overrides (`scoring.ts`), schemas, and
  guardrails. Consumed as TypeScript source by both web and agent, so the score is
  identical everywhere and **always overrides** any AI/agent suggestion.
- **`web/`** — React + Vite Layer-1 UI (bilingual JA/EN). Keyless and
  offline-capable; calls the agent backend only on explicit action.
- **`agent/`** — *(Phase B+)* Node backend that holds your Anthropic API key and
  runs §6/§7 and the encrypted case DB. Never part of the static front end.
- **`data/`** — *(Phase D+)* gitignored encrypted case DB + OSINT cache.

## Quickstart (Layer-1)

Requires Node 20+ (tested on Node 22).

```bash
npm install
npm test            # 25 deterministic tests, no network, no API key
npm run typecheck
npm run dev:web     # open the printed localhost URL
npm run build       # production build of the Layer-1 UI
```

Layer-1 needs **no API key and no network**. Copy `.env.example` to `.env` only
when you start using the keyed agent backend in later phases (never commit `.env`).

## Privacy & security

- Layer-1 runs entirely on your device and sends nothing.
- API keys live only in `.env` (gitignored) and are used only by the agent backend.
- The case DB and OSINT cache live under `data/` (gitignored) and are encrypted.

## License

Personal, non-commercial use. See the design spec for scope.
