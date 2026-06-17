# HHC (Human Hunter Check) — Infographic Source

> A one-page source to import into NotebookLM (or similar) and generate an HHC overview infographic. Factual; no exaggeration or accusation. Each heading is written to become one infographic block, using short labels and numbers.

## What HHC is
HHC is a **local-first self-defense tool** to self-triage whether someone you find suspicious — a recruiter, an applicant/contractor, or a visitor — is an impostor or a **foreign-intelligence recruitment** front, and to corroborate it from **public, lawful OSINT**. Output is only a **risk band (low/medium/high) + a recommended action**.

- ✅ Self-triage (indicator checklist + score + corroboration)
- ✅ Output is only a risk band + recommended action
- ❌ Never labels a person a "spy"; never decides guilt/innocence
- ❌ Never auto-scores or infers nationality/ethnicity
- ❌ No social-network scraping, no login-gated access
- Principle: **no evidence ≠ innocence** (absence from a list never lowers the score)

## Three scenarios
1. **You are the target**: a recruiter/headhunter front (fake consultancy → gauges your access → asks for info in exchange for pay)
2. **You are hiring/contracting**: a fraudulent applicant/contractor (fake identity to reach systems, data, code — e.g. the DPRK IT-worker fraud)
3. **In-person / visitor**: vetting someone who approaches via a meeting, sales call, interview, or site visit

## Seven indicator categories (A–G) — each distinct, no repeated examples
| Key | Category | What it looks at |
|---|---|---|
| **A** | Counterparty substance | thin web presence / new domain / pay too high / contradicts registration |
| **B** | Account authenticity | AI/reused photo / very new account / unverifiable history |
| **C** | Communication behavior | avoids video / pushes to encrypted app early / urgency + external URLs |
| **D** | Requests / objectives | probes non-public info/access / asks for sensitive reports / pays for information |
| **E** | Target attributes (coefficients) | about you: access to classified/advanced tech; current/former gov/defense/research |
| **F** | Sanctions / export-control list match | recruiter/person/affiliation matches a designation list (human-confirmed) |
| **G** | State nexus (optional, human-set) | stated/established nationality/affiliation matches a configured state of concern (no auto inference) |

## Scoring
- **Formula**: sum of matched weights × target coefficient (**E1 ×1.3, E2 ×1.2**)
- **Risk bands**: **low 0–5 / mid 6–12 / high 13+**
- **Critical escalation (forces "high" regardless of score) — 3 triggers**
  - **D3**: pays in exchange for information (alone)
  - **C2 + D1**: push to an encrypted channel + probing non-public info/access (together)
  - **F1**: designation-list match (human-confirmed identity)
- **F weights**: F1=5 (human-confirmed, critical) / F2=3 / F3=0 (weak match, not scored)
- The deterministic score **always overrides** the AI's suggestion

## OSINT sources (public, lawful)
Domain registration (RDAP) / certificate logs (crt.sh) / web search / JP companies (NTA houjin-bangou, gBizINFO) / global companies (GLEIF, OpenCorporates) / sanctions·PEP·watchlist (OpenSanctions + METI end-user list) / US CSL (OFAC SDN, BIS Entity/Unverified/MEU) / image reuse (reverse-image search)
- **Lists screened**: OFAC SDN · BIS Entity/Unverified/MEU · UN · EU · UK OFSI · METI end-user list · PEP
- **Not used**: social-network scraping / login-gated access / academic-paper · patent databases

## Recommended actions (by band)
- **Low**: business as usual; record only; don't over-alarm
- **Mid**: proceed carefully; add lookups; verify identity; preserve records
- **High**: stop engaging; preserve evidence; report to your CSIRT / authorities (Report & Remove)

## Platform & security
- **Local-first**: Layer-1 (checklist + score) needs no key, no network, runs on-device
- **Encryption**: case history in SQLCipher / age-encrypted exports / API key always server-side
- **Auth (optional)**: Admin/User roles, password (scrypt) + MFA (TOTP/email), invite-link onboarding, login lockout
- **Audit (admin-only)**: timestamp, User-Agent, source IP + geolocation, action, search key / retention auto-delete / CSV·JSON export / SIEM (e.g. Splunk) forwarding

## HHC by the numbers
- Risk bands: **3** (low 0–5 / mid 6–12 / high 13+)
- Indicator categories: **7** (A–G)
- Critical escalation triggers: **3** (D3 / C2+D1 / F1)
- Target coefficients: **E1 ×1.3, E2 ×1.2**
- F weights: **5 / 3 / 0**
- Public OSINT sources: **~10**
- MFA methods: **2** (TOTP, email codes)
- Languages: **Japanese / English**

## Guardrails (what it does NOT do)
No "spy"-style labeling; no binary guilty verdict; nationality/ethnicity neither auto-scored nor inferred; public/lawful sources only; list hits and cluster merges are human-confirmed before scoring; the deterministic score always overrides the AI; "no evidence ≠ innocence."

## Frameworks
2026 Five Eyes joint warning / UK NPSA "Think Before You Link" & "Applicant Beware" / Japan PSIA economic-security guidance / Five Eyes & FBI fraudulent-IT-worker advisories
