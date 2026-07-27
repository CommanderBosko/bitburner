# Hacking XP & Money Sources

_Compiled 2026-07-26 via `/research` (5 parallel agents against the live game source, `bitburner-official/bitburner-src`, `dev` branch). Numbers are transcribed directly from source files (`src/Company/data/CompanyPositionsMetadata.ts`, `CompanyPosition.ts`, `CompaniesMetadata.ts`, `JobTracks.ts`, `src/Crime/Crimes.ts`, `src/Work/ClassWork.tsx`, `src/Work/Formulas.ts`, `src/PersonObjects/formulas/reputation.ts`) — not approximated from community guides. The official readthedocs companies page is an unfilled TODO stub, so source code is the only authoritative reference here._

## TL;DR — best pick per goal

- **Best company job for hacking XP + money combined**: Software track → **Chief Technology Officer** (`software7`). Highest `hackingExpGain` (1.5) of any job in the game, second-highest salary (2640, behind only CEO's 3900). Requires hacking 751, charisma 501, 3.2M company reputation.
- **Best company for that track**: any of the 9 megacorporations (ECorp/MegaCorp offer the best multipliers, 3x salary/exp). See [Companies offering each track](#companies-offering-each-track).
- **Best faction work type for hacking XP + rep**: **Hacking Contracts** — 2x Field Work's hacking XP, 4x Security Work's, and the *only* one of the three whose reputation formula is dominated by hacking skill (compounds as you level).
- **Best crime for hacking XP**: **Heist** — 0.75 hacking XP/sec, the only crime with meaningful hacking XP (3 of 12 crimes give any hacking XP at all: Heist, Bond Forgery, Larceny, Rob Store).
- **Best university course for pure hacking XP/sec**: **Algorithms at ZB Institute of Technology** (Volhaven) — 16 hacking XP/sec, but costs $1,600/sec. Free option: Study Computer Science (any university) gives 1.0–2.0 hacking XP/sec at $0 cost.

---

## Company Jobs

Every `reqd*` stat requirement defaults to 0 if omitted from a table. `baseSalary`/`hackingExpGain` are per-200ms game cycle, before a company's `expMultiplier`/`salaryMultiplier` is applied (see company table below) and before player multipliers (augments, Source-Files) are applied.

### Software (`JobField.software`)
_(Req. Str/Def/Dex/Agi omitted — all 0 across this track)_

| Position | Req. Hacking | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|
| Software Engineering Intern | 1 | 0 | 0 | 33 | 0.05 | cha 0.02 |
| Junior Software Engineer | 51 | 0 | 8,000 | 80 | 0.1 | cha 0.05 |
| Senior Software Engineer | 251 | 51 | 40,000 | 165 | 0.4 | cha 0.08 |
| Lead Software Developer | 401 | 151 | 200,000 | 500 | 0.8 | cha 0.1 |
| Head of Software | 501 | 251 | 400,000 | 800 | 1.0 | cha 0.5 |
| Head of Engineering _(merge point)_ | 501 | 251 | 800,000 | 1650 | 1.1 | cha 0.5 |
| Vice President of Technology | 601 | 401 | 1,600,000 | 2310 | 1.2 | cha 0.6 |
| **Chief Technology Officer** (terminal) | 751 | 501 | 3,200,000 | 2640 | **1.5** | cha 1.0 |

IT, Security Engineer, and Network Engineer tracks all terminate by promoting into **Head of Engineering**, rejoining the Software ladder rather than having their own top rungs.

### IT (`JobField.it`)
_(Req. Str/Def/Dex/Agi omitted — all 0)_

| Position | Req. Hacking | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|
| IT Intern | 1 | 0 | 0 | 26 | 0.04 | cha 0.01 |
| IT Analyst | 26 | 0 | 7,000 | 66 | 0.08 | cha 0.02 |
| IT Manager | 151 | 51 | 35,000 | 132 | 0.3 | cha 0.1 |
| Systems Administrator | 251 | 76 | 175,000 | 410 | 0.5 | cha 0.2 |

→ promotes into Head of Engineering (Software ladder).

### Security Engineer (`JobField.securityEngineer`)
Single-rung starting job.

| Position | Req. Hacking | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|
| Security Engineer | 151 | 26 | 35,000 | 121 | 0.4 | cha 0.05 |

→ promotes into Head of Engineering (Software ladder).

### Network Engineer (`JobField.networkEngineer`)

| Position | Req. Hacking | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|
| Network Engineer | 151 | 26 | 35,000 | 121 | 0.4 | cha 0.05 |
| Network Administrator | 251 | 76 | 175,000 | 410 | 0.5 | cha 0.1 |

→ promotes into Head of Engineering (Software ladder).

### Business (`JobField.business`)
_(Req. Str/Def/Dex/Agi omitted — all 0)_

| Position | Req. Hacking | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|
| Business Intern | 1 | 1 | 0 | 46 | 0.01 | cha 0.08 |
| Business Analyst | 6 | 51 | 8,000 | 100 | 0.02 | cha 0.15 |
| Business Manager | 51 | 101 | 40,000 | 200 | 0.02 | cha 0.3 |
| Operations Manager | 51 | 226 | 200,000 | 660 | 0.02 | cha 0.4 |
| Chief Financial Officer | 76 | 501 | 800,000 | 1950 | 0.05 | cha 1.0 |
| **Chief Executive Officer** (terminal) | 101 | 751 | 3,200,000 | **3900** | 0.05 | cha 1.5 |

Highest salary in the game, but negligible hacking XP throughout — a charisma-driven track, not a hacking one.

### Security (`JobField.security`)
All six stats matter here.

| Position | Req. Hacking | Req. Str/Def/Dex/Agi | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|---|
| Security Guard | 0 | 51 | 1 | 0 | 50 | 0.01 | str/def/dex/agi 0.04, cha 0.02 |
| Security Officer | 26 | 151 | 51 | 8,000 | 195 | 0.02 | str/def/dex/agi 0.1, cha 0.05 |
| Security Supervisor | 26 | 251 | 101 | 36,000 | 660 | 0.02 | str/def/dex/agi 0.12, cha 0.1 |
| Head of Security (terminal) | 51 | 501 | 151 | 144,000 | 1320 | 0.05 | str/def/dex/agi 0.15, cha 0.15 |

### Agent (`JobField.agent`)

| Position | Req. Hacking | Req. Str/Def/Dex/Agi | Req. Cha | Req. Rep | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|---|---|
| Field Agent | 101 | 101 | 101 | 8,000 | 330 | 0.04 | str/def/dex/agi 0.08, cha 0.05 |
| Secret Agent | 201 | 251 | 201 | 32,000 | 990 | 0.1 | str/def/dex/agi 0.15, cha 0.1 |
| Special Operative (terminal) | 251 | 501 | 251 | 162,000 | 2000 | 0.15 | str/def/dex/agi 0.2, cha 0.15 |

### Software / Business Consultant (single-rep-requirement, 2-rung tracks)
_(Req. Str/Def/Dex/Agi omitted — all 0. No reputation requirement on either track.)_

| Position | Req. Hacking | Req. Cha | Salary | Hacking XP | Other stat XP |
|---|---|---|---|---|---|
| Software Consultant | 51 | 0 | 66 | 0.08 | cha 0.03 |
| Senior Software Consultant (terminal) | 251 | 51 | 132 | 0.25 | cha 0.06 |
| Business Consultant | 6 | 51 | 66 | 0.015 | cha 0.15 |
| Senior Business Consultant (terminal) | 51 | 226 | 525 | 0.015 | cha 0.3 |

### Employee / Waiter (walk-in jobs, no requirements)

| Position | Salary | Hacking XP | Other stat XP |
|---|---|---|---|
| Waiter | 22 | 0 | str/def/dex/agi 0.02, cha 0.05 |
| Employee | 22 | 0 | str/def/dex/agi 0.02, cha 0.04 |
| Part-time Waiter | 20 | 0 | str/def/dex/agi 0.0075, cha 0.04 |
| Part-time Employee | 20 | 0 | str/def/dex/agi 0.0075, cha 0.03 |

### Companies offering each track

Each company's `expMultiplier`/`salaryMultiplier` scales its jobs' hacking-XP and money rates directly — two companies both offering "CTO" pay/grant XP at very different effective rates. `relatedFaction` is only coded for the 9 megacorporations; smaller companies have no faction tie in source even where fiction implies one (CIA, NSA, VitaLife).

| Company | Ladder | expMult | salaryMult | Faction |
|---|---|---|---|---|
| **ECorp** | Full (all tracks) | **3** | **3** | ECorp |
| **MegaCorp** | Full (all tracks) | **3** | **3** | MegaCorp |
| Blade Industries | Full | 2.75 | 2.75 | Blade Industries |
| NWO | Full | 2.75 | 2.75 | NWO |
| Bachman & Associates | Full | 2.6 | 2.6 | Bachman & Associates |
| Four Sigma | Full | 2.5 | 2.5 | Four Sigma |
| Clarke Incorporated | Full | 2.25 | 2.25 | Clarke Incorporated |
| OmniTek Incorporated | Full | 2.25 | 2.25 | OmniTek Incorporated |
| KuaiGong International | Full | 2.2 | 2.2 | KuaiGong International |
| Fulcrum Technologies | Full (Tech + Business, no Security) | 2 | 2 | Fulcrum Secret Technologies |
| Universal Energy | Full (no Security track) | 2 | 2 | none |
| Storm Technologies | Full | 1.8 | 1.8 | none |
| Icarus Microsystems | Full (no Security) | 1.9 | 1.9 | none |
| Galactic Cybersystems | Full (no Security) | 1.9 | 1.9 | none |
| DefComm / Helios Labs | Tech full to CTO; Business = CEO rung only, no ladder beneath | 1.75 / 1.8 | 1.75 / 1.8 | none |
| VitaLife | Full (no Security) | 1.8 | 1.8 | none |
| Global Pharmaceuticals | Full (incl. Security) | 1.8 | 1.8 | none |
| Nova Medical | Full (incl. Security) | 1.75 | 1.75 | none |
| AeroCorp / Omnia Cybersystems / Solaris Space Systems | Tech/Security full; Business partial (only Ops Manager + CEO) | 1.7 | 1.7 | none |
| DeltaOne | Same shape as above | 1.6 | 1.6 | none |
| Central Intelligence Agency / National Security Agency | Software capped at Head of Engineering; Security & Agent full; no Business | 2 | 2 | none |
| Watchdog Security | Software capped; Security/Agent full; no Business | 1.5 | 1.5 | none |
| Carmichael Security | Tech/Security/Agent full; no Business | 1.2 | 1.2 | none |
| LexoCorp | Full (no Agent) | 1.4 | 1.4 | none |
| Alpha Enterprises | Software/Business both capped at low rungs | 1.5 | 1.5 | none |
| Aevum Police HQ | Security full; Software capped | 1.3 | 1.3 | none |
| Rho Construction | Software/Business both capped low | 1.3 | 1.3 | none |
| SysCore Securities / CompuTek / NetLink Technologies | Tech only, full | 1.3 / 1.2 / 1.2 | 1.3 / 1.2 / 1.2 | none |
| Omega Software | Software + IT full (no Business/Security) | 1.1 | 1.1 | none |
| FoodNStuff / Joe's Guns | Employee only, no ladder | 1 | 1 | none |
| Noodle Bar | Waiter only, no ladder | 1 | 1 | none |

---

## University Courses

Formula (`src/Work/Formulas.ts::calculateClassEarnings`), true steady-state per-second rate:

```
statExp/sec = baseStatExp × location.expMult × hashMult × person.mults.<stat>_exp
$Cost/sec   = baseMoneyCost × location.costMult × (backdoor installed on that server ? 0.9 : 1)
```

Player multipliers (augments etc.) scale XP the same way they do for company/faction work. **Intelligence XP is never multiplier-scaled**, for classes, gyms, company work, or faction work alike. Money cost is never multiplier-scaled either.

| Course | Rothman University | Summit University | ZB Institute of Technology |
|---|---|---|---|
| Study Computer Science | 1.0 hack XP/sec, $0 | 1.5 hack XP/sec, $0 | 2.0 hack XP/sec, $0 |
| Data Structures | 2 hack XP/sec, $120/sec | 3 hack XP/sec, $160/sec | 4 hack XP/sec, $200/sec |
| Networks | 4 hack XP/sec, $240/sec | 6 hack XP/sec, $320/sec | 8 hack XP/sec, $400/sec |
| **Algorithms** | 8 hack XP/sec, $960/sec | 12 hack XP/sec, $1,280/sec | **16 hack XP/sec, $1,600/sec** |
| Management | cha 4/sec, $480/sec | cha 6/sec, $640/sec | cha 8/sec, $800/sec |
| Leadership | cha 8/sec, $960/sec | cha 12/sec, $1,280/sec | cha 16/sec, $1,600/sec |

All courses also grant `int 0.02–0.04/sec` (unscaled by any multiplier), which increases with location tier the same way hacking XP does.

Gyms (str/def/dex/agi training, no hacking XP): Iron Gym ($120/sec, 1 stat XP/sec) → Crush Fitness ($360/sec, 2/sec) → Millenium Fitness ($840/sec, 4/sec) → Snap Fitness ($1,200/sec, 5/sec) → Powerhouse Gym ($2,400/sec, 10/sec, Sector-12).

**Note**: the `ClassGymExpGain` BitNode multiplier is defined in source (`BitNodeMultipliers.ts`) and documented in the UI, but as of this `dev`-branch snapshot `calculateClassEarnings()` never actually reads it — confirmed by grepping every call site. It currently has no effect on any number above; worth re-checking if this is patched upstream later.

---

## Crimes

Sorted by hacking XP/sec descending. Only 4 of 12 crimes grant any hacking XP at all.

| Crime | Money | Hacking XP | Other stat XP | Time (sec) | $/sec | Hacking XP/sec |
|---|---|---|---|---|---|---|
| **Heist** | $120,000,000 | 450 | str/def/dex/agi/cha 450 | 600 | $200,000 | **0.750** |
| Rob Store | $400,000 | 30 | dex/agi 45 | 60 | $6,667 | 0.500 |
| Larceny | $800,000 | 45 | dex/agi 60 | 90 | $8,889 | 0.500 |
| Bond Forgery | $4,500,000 | 100 | dex 150, cha 15 | 300 | $15,000 | 0.333 |
| Assassination | $12,000,000 | 0 | str/def/dex/agi 300 | 300 | $40,000 | 0 |
| Kidnap | $3,600,000 | 0 | str/def/dex/agi/cha 80 | 120 | $30,000 | 0 |
| Grand Theft Auto | $1,600,000 | 0 | str 20, def 20, dex 80, agi 20, cha 40 | 80 | $20,000 | 0 |
| Traffick Arms | $600,000 | 0 | str/def/dex/agi 20, cha 40 | 40 | $15,000 | 0 |
| Homicide | $45,000 | 0 | str/def/dex/agi 2 | 3 | $15,000 | 0 |
| Deal Drugs | $120,000 | 0 | dex/agi 5, cha 10 | 10 | $12,000 | 0 |
| Mug | $36,000 | 0 | str/def/dex/agi 3 | 4 | $9,000 | 0 |
| Shoplift | $15,000 | 0 | dex/agi 2 | 2 | $7,500 | 0 |

**Heist** is both the best money/sec ($200k, second only to Assassination... actually highest of all) and by far the best hacking-XP/sec crime — a clean win on both axes at high stats. Its steep requirements (difficulty 18, all six stats matter for success chance) make it a late-game-only crime.

---

## Faction Work

Three work types (`FactionWorkType` enum), recomputed live every 200ms game cycle — none of this is a flat constant, it scales with current stats/multipliers/favor in real time.

| Work type | Hacking XP rate | Reputation formula weight |
|---|---|---|
| **Hacking Contracts** | `2 × mults.hacking_exp` — pure hacking XP, no dilution | Reputation formula is **dominated by hacking skill** (+ minor intelligence term) — the only work type where rep compounds directly with hacking level |
| Field Work | `1 × mults.hacking_exp` (2x less than Hacking Contracts) | Averaged across all 6 stats + hacking — hacking is one component of many |
| Security Work | `0.5 × mults.hacking_exp` (4x less than Hacking Contracts) | Averaged across 4 combat stats + hacking — hacking barely moves this |

None of the three faction work types pay money — faction work is rep/XP only, never cash.

**Hacking Contracts is the unambiguous choice** for a hacking-focused build: highest hacking XP of the three, and the only formula where reputation gain itself scales with hacking skill rather than combat stats. `ns.share()` (RAM sharing) also boosts Hacking Contracts' reputation formula proportionally more than the other two work types.

---

## Sources

- `src/Company/data/CompanyPositionsMetadata.ts`, `CompanyPosition.ts`, `CompaniesMetadata.ts`, `JobTracks.ts`, `Company.ts`
- `src/Crime/Crimes.ts`, `Crime.ts`
- `src/Work/ClassWork.tsx`, `Formulas.ts`, `WorkStats.ts`, `Enums.ts`, `FactionWork.tsx`
- `src/PersonObjects/formulas/reputation.ts`, `intelligence.ts`
- `src/Locations/data/LocationsMetadata.ts`, `src/Hacknet/HashManager.ts`, `src/BitNode/BitNodeMultipliers.ts`
- `src/Faction/ui/FactionRoot.tsx` (confirms UI labels ↔ enum members)

All fetched via direct `curl` against `raw.githubusercontent.com/bitburner-official/bitburner-src/dev/...` rather than summarized — WebFetch's summarizing model was found to drop literal numeric constants during the earlier `bitnodes.md` and job-recommendation research.
