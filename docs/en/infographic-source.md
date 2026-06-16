# HHC (Human Hunter Check) — Infographic Source

> A one-page source to import into NotebookLM (or similar) to generate an overview infographic of HHC. Structured so numbers, categories, and contrasts are easy to visualize. Factual; no exaggeration or accusation.

## One-line summary
HHC is a **local-first self-defense tool** that helps you self-triage whether someone you find suspicious — a recruiter, an applicant/contractor, or a visitor — is an impostor or a **foreign-intelligence recruitment** front, and corroborate it from **public, lawful OSINT**. Output is only a **risk band (low/medium/high) + a recommended action**.

## What it is / isn't
- ✅ A self-defense **self-triage** (indicator checklist + score + corroboration).
- ✅ Output is only a **risk band + recommended action**.
- ❌ Never **labels** a person a "spy"; never decides guilt/innocence.
- ❌ Never **auto-scores or infers** nationality/ethnicity.
- ❌ No LinkedIn scraping, no login-gated access (public, lawful sources only).
- Principle: **"no evidence ≠ innocence"** (absence from a list never lowers the score).

## Use cases (three)
1. **You are the target**: a recruiter/headhunter front (fake consultancy/think tank → gauges your access → asks for info in exchange for pay).
2. **You are hiring/contracting**: a fraudulent applicant/freelancer (fake identity to gain access to systems, data, code — e.g. the DPRK IT-worker fraud).
3. **In-person / visitors**: vetting someone who approaches via a meeting, sales call, interview, or site visit.

## Context (frameworks)
- 2026 Five Eyes joint warning (recruiting access-holders via job sites)
- UK NPSA "Think Before You Link" / "Applicant Beware"
- Japan PSIA economic-security guidance
- Five Eyes / FBI advisories on fraudulent (e.g. DPRK) IT workers

## Seven indicator categories (A–G)
| Key | Category | What it looks at (examples) |
|---|---|---|
| **A** | Counterparty substance | thin web presence / newly registered domain / pay too high / contradicts corporate registration |
| **B** | Account authenticity | AI/reused photo / very new account / unverifiable history / unnatural manner of contact |
| **C** | Communication behavior | avoids video / pushes to encrypted/off-record early / escalates fast / external URLs + urgency |
| **D** | Requests / objectives | probes non-public info/access / asks for sensitive reports / **pays for information** / irregular payment |
| **E** | Target attributes (coefficients) | about you: access to classified/advanced tech; current/former gov/defense/research |
| **F** | Sanctions / export-control / watchlist | recruiter/person/**affiliated institution** matches a designation list (human-confirmed) |
| **G** | State nexus (human-set, optional) | stated/established nationality/origin/state affiliation matches your configured states of concern (human judgement; no auto inference) |

> Rendering note: **A–G are seven DISTINCT categories**. Each row's example signals are **specific to that category** — do **not** repeat the same bullets across cards (A=substance / B=account authenticity / C=behavior / D=requests / E=target coefficients / F=list match / G=state nexus).

## Scoring (easy to chart)
- **Formula**: `score = sum of matched weights × target coefficients` (**E1 ×1.3**, **E2 ×1.2**).
- **Bands**: **low 0–5 / mid 6–12 / high 13+**.
- **Critical indicators (force "high" regardless of score)**:
  - **D3**: pays in exchange for information (alone)
  - **C2 + D1**: push to encrypted channel + probing non-public info/access (together)
  - **F1**: designation-list match (**human-confirmed identity**)
- **F weights**: **F1 = +5 (human-confirmed, critical) / F2 = +3 / F3 = 0 (weak match, reference only)**.
- The deterministic score **always overrides** the AI's suggestion.

## OSINT sources (public)
Domain registration (RDAP) / certificate logs (crt.sh) / web search / JP companies (NTA houjin-bangou, gBizINFO) / global companies (GLEIF, OpenCorporates) / **sanctions·PEP·watchlist (OpenSanctions + METI end-user list)** / **US CSL (OFAC SDN, BIS Entity/Unverified/MEU, …)** / image reuse (reverse-image search links).
> Lists screened: OFAC SDN · BIS Entity/Unverified/MEU · UN · EU · UK OFSI · METI end-user list · PEP.

## Recommended actions (4R, by band)
- **Low**: business as usual; just record. Don't over-alarm.
- **Mid**: proceed carefully; verify / add lookups; preserve records.
- **High (Report & Remove)**: stop engaging, preserve evidence, report to your CSIRT / authorities.

## Platform & security
- **Local-first**: Layer-1 (checklist + score) needs no key, no network, runs on-device.
- **Encryption**: case history in an encrypted DB (SQLCipher); exports are age-encrypted; the API key always stays server-side.
- **Accounts/auth (optional)**: Admin/User roles, password (scrypt) + **MFA (TOTP/email)**, invite-link onboarding, login lockout.
- **Audit log & dashboard (admin-only)**: timestamp, User-Agent, **source IP + geolocation**, action, and the search query — with retention auto-delete, CSV/JSON export, and SIEM (e.g. Splunk) forwarding.

## HHC by the numbers (key facts)
- Risk bands: **3** (low 0–5 / mid 6–12 / high 13+)
- Indicator categories: **7** (A–G)
- Critical escalation triggers: **3** (D3 / C2+D1 / human-confirmed F1)
- Target coefficients: **E1 ×1.3**, **E2 ×1.2**
- F weights: **F1=5 / F2=3 / F3=0**
- Public OSINT sources: **~10** (keyless ones work out of the box)
- MFA methods: **2** (TOTP, email codes)
- Languages: **Japanese / English**

## Guardrails (what it does NOT do)
No "spy"-style labeling; no binary guilty verdict; nationality/ethnicity are neither auto-scored nor inferred; public/lawful sources only; list hits and cluster merges are **human-confirmed** before scoring; the deterministic score always overrides the AI; "no evidence ≠ innocence."

---

## Suggested infographic structure (prompt for NotebookLM)
> Give NotebookLM something like:
>
> "From this source, create a **one-page infographic that explains HHC at a glance**. Suggested layout: (1) hero — one-line summary + what it is / isn't; (2) the three use cases (target / hiring side / visitor); (3) **the seven indicator categories A–G, each DISTINCT — do not repeat the same example bullets across cards**; (4) how scoring works (bands low 0–5 / mid 6–12 / high 13+, coefficients E1×1.3 / E2×1.2, **all three critical triggers: D3 / C2+D1 / F1**); (5) the public OSINT sources; (6) recommended actions by band; (7) guardrails (what it does NOT do). Emphasize numbers and contrasts; keep a neutral, self-defense tone — avoid accusatory language or naming specific countries."

> Sources / frameworks: 2026 Five Eyes joint warning, UK NPSA "Think Before You Link", Japan PSIA economic-security guidance, Five Eyes/FBI fraudulent-IT-worker advisories.
