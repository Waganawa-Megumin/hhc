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

All phases implemented (≈80 tests, all run with no network and no API key).

| Phase | Scope | State |
|------|-------|-------|
| **A** | Layer-1: A–F checklist, deterministic §3 scoring + critical-flag overrides, bands + 4R actions, JA/EN, offline | ✅ |
| **B** | §6 AI interpret (pasted text / screenshots → human-confirmed checklist prefill) | ✅ |
| **C** | §7 OSINT verification agent + tool registry (RDAP, crt.sh, OpenSanctions incl. METI, Trade.gov CSL, NTA 法人番号, gBizINFO, OpenCorporates, reverse-image links, web search) | ✅ |
| **D** | Encrypted local case DB (SQLCipher), identity/clustering, volatility cache, diff, threat stats incl. coordinated-targeting | ✅ |
| **E** | Evidence snapshots (timestamp+SHA-256), CSIRT/authority report drafts, calibration + acceptance tests, CI | ✅ |

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

## Quickstart (Layer-1, keyless)

Requires Node 20+ (tested on Node 22).

```bash
npm install
npm test            # ~80 deterministic tests, no network, no API key
npm run typecheck
npm run dev:web     # open the printed localhost URL
npm run build       # production build of the Layer-1 UI
```

Layer-1 needs **no API key and no network**: tick the checklist, get a band +
recommended action, copy a report draft, and freeze a SHA-256 evidence snapshot.

## Full local run (§6 interpret, §7 OSINT, case history)

```bash
cp .env.example .env          # then set ANTHROPIC_API_KEY and HHC_DB_KEY
npm run seed                  # (optional) seed sample case history for the demo
npm run dev:agent             # local backend on 127.0.0.1:8787 (holds your key)
npm run dev:web               # the UI proxies /api → the agent
```

- **§6** turns a pasted DM / screenshot into *suggested* checklist ticks (you
  confirm each). Consent-gated; nothing is persisted server-side.
- **§7** corroborates a subject from public sources and screens the recruiter
  **and the affiliated employer/university/institute** against danger lists;
  matches are candidates that score **only after you confirm identity**.
- **Case history** (needs `HHC_DB_KEY`) gives instant recall of repeat
  approaches, diffs on re-checks, and a personal threat-landscape view including
  coordinated-targeting alerts. Stored encrypted under `data/` (gitignored).

Every OSINT source degrades gracefully: if a credential is missing or
`HHC_OFFLINE=1`, that tool reports *unavailable* (and "absence ≠ innocence")
instead of failing the run. Free source registrations (NTA app ID, Trade.gov,
OpenSanctions/OpenCorporates) are listed in `.env.example`; the keyless paths
(RDAP, crt.sh, self-hosted OpenSanctions, reverse-image links) work immediately.

## Privacy & security

- Layer-1 runs entirely on your device and sends nothing.
- API keys live only in `.env` (gitignored) and are used only by the agent backend,
  which binds `127.0.0.1`.
- The case DB and OSINT cache live under `data/` (gitignored) and are encrypted
  (SQLCipher; wrong key is rejected, file is opaque at rest).
- Guardrails are enforced in code and covered by tests: no nationality/ethnicity in
  scoring or storage, no "spy" labelling, deterministic score always overrides AI,
  sanctions/watchlist hits are human-confirmed candidates, "no evidence ≠ innocence".

### Known dev-dependency advisories

`npm audit` reports advisories in the **dev** toolchain (esbuild/vite dev server,
and a critical in `vitest` that applies **only when the Vitest UI server is
running** — `vitest --ui`, which this project never uses; CI runs `vitest run`).
None affect the shipped web bundle or the agent backend. Clearing them requires a
vite 8 + vitest 4 major upgrade; tracked separately to avoid destabilising the
build.

## License

Personal, non-commercial use. See the design spec for scope.
