# BitNode Win Conditions

_Compiled 2026-07-24 via `/research`, cross-checked against the live game source (`bitburner-official/bitburner-src`, `dev` branch: `src/BitNode/BitNode.tsx`, `src/Terminal/commands/hack.ts`) and the official strategy docs. Source code is the authoritative reference; community guides (Steam/Reddit) were used only where they didn't conflict with it._

## The universal win condition (applies to every BitNode)

Money is a *means*, not the win condition — this is why $34T in BN1 alone doesn't destroy the node. The actual trigger is identical across all BitNodes:

1. Get invited to the **Daedalus** faction (requires $100b net worth, 30 augmentations owned, **and** either hacking skill ≥2500 **or** all combat stats ≥1500 — this is what large money totals are actually gating).
2. Earn enough Daedalus reputation to buy the **"The Red Pill"** augmentation (no money cost, reputation-gated), then install it.
3. Manually hack the server **`w0r1d_d43m0n`** (WorldDaemon). Base requirement: hacking level **3000** (scales with that BitNode's hacking-level multiplier — some BitNodes require far more, players report 15,000+ in harder nodes).
   - **Not visible before this point.** Confirmed in source: `w0r1d_d43m0n` has no `networkLayer` in `src/Server/data/servers.ts` — it isn't placed in the network graph at world generation and has zero connections. It only gets wired in inside `prestigeAugmentation()` (`src/Prestige.ts`), which checks `Player.hasAugmentation(AugmentationName.TheRedPill, true)` and, if true, connects it to `DaedalusServer` (bidirectionally). This runs during the augmentation-install reset, so `w0r1d_d43m0n` only becomes scannable *after* installing The Red Pill — not before, no matter how deep you scan. (Daedalus's own server is a normal deep server, `networkLayer: 15`, discoverable the ordinary way.)
4. A successful hack triggers `Router.toPage(BitVerse)` — the BitNode is destroyed, most progress resets, and you're awarded (or level up) that BitNode's **Source-File**, a permanent cross-BitNode buff.

**Alternate destroy method:** unlocked only after first destroying **BitNode 6 or 7** (Bladeburner) — completing the final Bladeburner Black Operation destroys the current BitNode instead of hacking WorldDaemon directly. Available as an option in any BitNode afterward if you have the relevant Source-File.

**Shortcut:** with Source-File 1, the dark net's "final lab" (BitNode 15's home turf) can grant The Red Pill directly, skipping Daedalus — except this shortcut is explicitly disabled in **BitNode 8**.

Only BitNodes **1–15** currently exist in the source (verified directly in `BitNode.tsx` — the constructor list and `getBitNodeMultipliers()` switch both stop at 15 with no `case 16+`). The "24+ BitNodes" premise from the original ask doesn't match current source; if the live game shows more, it's a newer build than what's on `dev`.

## Per-BitNode mechanics

Every row below still resolves via the universal condition above (hack `w0r1d_d43m0n`). What differs per node is the economy/mechanic reshaping the path there — not the destroy trigger itself, except where noted.

| # | Name | Unique mechanic | Notes |
|---|---|---|---|
| 1 | Source Genesis | None — baseline BitNode | No modifiers; SF1 gives a large flat multiplier buff, worth replaying first. |
| 2 | Rise of the Underworld | Unlocks **Gangs** | Karma requirement to start a gang elsewhere is waived here; your gang can hand you The Red Pill directly. |
| 3 | Corporatocracy | Unlocks **Corporation** | Can trivialize other BitNodes via corp income once automated; complex to learn blind. |
| 4 | The Singularity | Unlocks `ns.singularity.*` | RAM cost for singularity functions is 4×–16× outside BN4 without SF4. |
| 5 | Artificial Intelligence | Grants permanent **Intelligence** stat + free `Formulas.exe` | SF5 buffs hacking multipliers. |
| 6 | Bladeburners | Unlocks **Bladeburner** (no penalty mods) | Enables the alt-destroy method (final Black Op) for this and future BitNodes. |
| 7 | Bladeburners 2079 | Unlocks **Bladeburner** (with penalty mods) | SF7 level 3 grants "The Blade's Simulacrum" free, letting Bladeburner actions run alongside other actions. |
| 8 | Ghost of Wall Street | Stock-market-only economy | **Confirmed in source**: scripted *and* manual hacking money is zeroed (`ScriptHackMoney`/`ManualHackMoney: 0`), along with company work, crime, hacknet, corp, gang, and Bladeburner income. WorldDaemon hack is still the actual win trigger — stock trading just funds the path there. Starts with $250M + WSE/TIX API access; unlocks short-selling and limit/stop orders. The SF1 dark-net Red Pill shortcut is explicitly disabled here. |
| 9 | Hacktocracy | Unlocks **Hacknet Servers** (hash-generating) | Disables private/purchased servers; raises home RAM cost; nerfs hacking multipliers — a harsh BitNode. |
| 10 | Digital Carbon | Unlocks **Sleeves** + **Grafting** | Up to 5 purchasable sleeves (+1 per SF10 level); last one costs 100 quadrillion. |
| 11 | The Big Crash | No new mechanic | Company favor boosts both salary and rep; reduces augmentation price escalation. Generally considered a weak/"bad" BitNode. |
| 12 | The Recursion | **Infinitely repeatable, no win state** | Gets harder every time it's destroyed; SF12 is the only Source-File with no level cap. Designed as an endless late-game grind, not a one-and-done. |
| 13 | They're Lunatics | Unlocks **Stanek's Gift** | Must accept the Gift (find Stanek in Chongqing) before buying most augmentations; imposes a flat penalty removable via two Church-of-the-Machine-God augments. |
| 14 | IPvGO Subnet Takeover | Buffs **IPvGO** (available from game start regardless of BN) | Unlocks `ns.go.cheat` and higher per-faction favor caps from IPvGO wins. |
| 15 | The Secrets of the Dark Net | Expands the dark net | SF15 permanently unlocks the TOR router + full dark web access in *all* BitNodes; this is also where the SF1 Red Pill shortcut (see above) originates. |

## Sources

- `src/BitNode/BitNode.tsx` and `src/Terminal/commands/hack.ts` — [bitburner-official/bitburner-src](https://github.com/bitburner-official/bitburner-src) (`dev` branch) — primary/authoritative.
- [`bitnode_recommendation_comprehensive_guide.md`](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md) — official in-game strategy guide, per-node detail cross-check.
- [`bitnodes.rst`](https://github.com/bitburner-official/bitburner-beta/blob/master/doc/source/advancedgameplay/bitnodes.rst) — official docs, confirms the universal destroy mechanism (its per-BitNode section is an unfilled `TODO` upstream).
- Community (Steam discussions) — used only to corroborate BN8 behavior, not as a primary claim; the "$25b/$1b" figures floating around are community funding heuristics, not an actual in-code check.
