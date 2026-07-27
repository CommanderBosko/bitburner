# Singularity Automation Roadmap

Priority order for automating `ns.singularity.*` features in BN4, ranked by what's actually
reachable given the current save state (hacking 15, $400, 32GB home RAM, fresh into BN4) and what
each item depends on. Built via `/interview` on 2026-07-26; see conversation for full brief.

## Already done

- **Backdoor automation** — `backdoor-loop.ts` / `connect-to.ts` already drive
  `ns.singularity.connect` / `installBackdoor`. Not re-ranked here.
- **Program acquisition** — handled by the existing darknet system (`darknet-manager.ts` and
  friends, via `ns.dnet`), independent of `ns.singularity.createProgram`. `createProgram` also
  gates on hacking-level thresholds per program that aren't met yet, so it stays out of scope
  until darknet coverage proves insufficient.

## Dependency graph

```
Tier 1 (no prerequisites)
  └── Company/career work loop  ──┐
                                   │ (money, hacking XP)
Tier 2 (needs Tier 1 output)      │
  ├── Home RAM/Core upgrades  <───┘ (needs money)
  └── Faction work loop       <─── (needs hacking level past faction invite
                                    threshold + backdoor-loop's CSEC grab,
                                    already running)
Tier 3 (needs Tier 2 output)
  └── Augmentation buy/install  <─── (needs faction rep + money)
Tier 4 (needs 2+ Tier 1-3 primitives to exist)
  └── Meta-loop scheduler
```

## Ranked list

1. **Company/career work loop** (`applyToCompany`, `workForCompany`) — **build first.**
   No prerequisites: Software Engineering Intern requires hacking 1 (per `jobs.md`). Produces
   both salary (the current bottleneck — $400 on hand) and hacking XP simultaneously. Strictly
   better than pure training right now because training-only (`universityCourse`) earns XP but
   $0 income, and money is needed to unlock every downstream tier (home RAM, later augments).

2. **Home RAM/Core upgrade loop** (`upgradeHomeRam`, `upgradeHomeCores`) — auto-buy when
   affordable. Depends on #1's income. Directly relieves the flagged RAM-budget risk (32GB total,
   shared with the existing hack/grow/weaken batch loop).

3. **Faction work loop** (`workForFaction` on Hacking Contracts per `jobs.md`,
   `checkFactionInvitations`, `joinFaction`, `donateToFaction`) — depends on hacking level from
   #1 crossing the relevant faction's invite threshold (e.g. CyberSec), and on `backdoor-loop.ts`
   (already running) having grabbed the qualifying backdoor. No money output — rep/XP only — so
   it doesn't replace #1, it runs alongside once eligible.

4. **Augmentation buy/install loop** (`purchaseAugmentation`, `installAugmentations`) — needs
   both faction rep (#3) and substantial money (#1/#2 leftover). Furthest downstream; also the
   highest-blast-radius item since installs wipe home `.exe` programs (per project memory) —
   needs re-bootstrap handling before it's safe to automate unattended.

5. **Meta-loop scheduler** — deferred until 2+ of the above exist as real, working primitives.
   Building it earlier has nothing meaningful to orchestrate (see interview brief).

## Deliberately deprioritized

- **Crime loop** (`commitCrime`) — company work loop already covers money + hacking XP better at
  current stats; revisit only if company income proves too slow.
- **Training loop** (`universityCourse`, `gymWorkout`) as a standalone primitive — folded into
  the company work loop's rationale (XP without money loses to XP + money); may still be worth a
  thin wrapper later to fill idle time between company promotions requiring a rep threshold, but
  not the first build.
- **Program creation** (`createProgram`) — superseded by the existing darknet program-acquisition
  path.

## Risks carried over from the interview brief

- `ns.*` concurrency limit: no two `ns.*` calls in flight per script — any looped primitive must
  be single-threaded/due-time-scheduled, not concurrent.
- 32GB total home RAM is tight for a new primitive script running alongside the existing batch
  loop — check static RAM cost against free RAM before calling any primitive done.
- Augment-install resets wipe home `.exe` programs — primitives must tolerate that, not assume
  persistent state.
