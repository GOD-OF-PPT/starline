# Project: 《星际拆解站：星门远征》 (`starline` V3 Full-Game Upgrade)

> **User Request**: `"游戏主线不明确，玩法不完整；整个游戏比较像demo，请规划分析全方位完善游戏"` (`.agents/teamwork/ORIGINAL_REQUEST.md`)
> **Baseline**: `main@084e781` (TypeScript 5.8 + Vite 6 + Phaser 3.90 + Vitest 3.2; 35,107 LOC across 62 files; 56 hand-painted WebP assets; V2 vertical slice + V1 `?mode=v1` preserved).
> **Companion (experience quality)**: [docs/PROJECT-体验重铸.md](docs/PROJECT-体验重铸.md) — playtest-driven plan addressing "not fun / art not refined / UI feels like a workbench" (first-voyage slice, interaction & art polish, playtest gates). Based on 2026-11-24 review in `output/design-review-20261124/`.

---

## Architecture

### Core Architectural Principles
1. **Pure Deterministic Domain Core (`src/v2/domain/`)**: All game rules, campaign state transitions, sector modifiers, multi-phase combat simulations, derelict dissection math, dismantling/refining, faction contracts, endings, and save migrations MUST remain 100% pure, immutable TypeScript with ZERO DOM/Phaser imports and deterministic salted PRNG streams (`rngStreams.ts`).
2. **Single Source of Truth**: Pre-combat preview (`simulateV2Combat`), tactical delta (`tacticalDelta.ts`), live Phaser playback (`V2CombatScene.ts`), and settlement MUST execute the exact same pure simulation function — zero divergence between preview and actual execution.
3. **Decoupled Modular UI (`src/v2/ui/screens/`, `src/v2/ui/modals/`, `src/v2/ui/styles/`)**: Decompose the 3,801-line `V2AppController.ts` God Controller into a thin state/lifecycle coordinator delegating rendering to screen modules, and split new V3 styling into `src/v2/ui/styles/*.css` imported by `src/main.ts` so parallel milestones have disjoint write ownership.
4. **Asset Reuse & Visual Cohesion**: Maximize existing 56 hand-painted WebP assets (`sector_1..6.webp`, `event_*.webp`, unused `enemy_hulk.webp`, `boss_dreadnought.webp`, `boss_leviathan.webp`, 31 item icons, 5 modular ship hardpoints, 5 station layers) augmented with crisp inline SVG portraits/icons and procedural Phaser lighting/VFX/tints.
5. **Backward Compatibility & Safety**:
   - Preserve legacy V1 (`?mode=v1`) and V1 tests (`tests/rules.test.ts`, `tests/simulation.test.ts`) untouched.
   - Automatic, non-destructive `V2 (schemaVersion: 2) -> V3 (schemaVersion: 3)` save migration keeping backup copies (`starline_save_backup_v2`) and mapping existing V2 progress to corresponding Campaign Acts.
   - Preserve bankruptcy-proof free launch guarantee (free fallback loan + free fuel + Sector 1 contract always launchable at `0¤`).
   - Git hygiene: `.agents/` MUST be added to `.gitignore` and NEVER committed to git.

### High-Level Data Flow
```
User Input (DOM / Canvas / Keyboard)
  │
  ▼
V2AppController (thin coordinator + persistence + soundEngine + PhaserHost + __STARLINE_INSPECT__)
  ├── UI Screens (src/v2/ui/screens/*) & Modals (src/v2/ui/modals/*) & CargoGridV2
  ├── PhaserHost ──► BaseScene (V2 diorama state) & V2CombatScene (multi-phase combat & hardpoints)
  └── Pure Domain Engine (src/v2/domain/*) + Static Data (src/v2/data/*)
        ├── campaign.ts (4-Act spine, chapters, endings, endless abyss)
        ├── sectors.ts (3 sectors + environmental rules + pity relic signals)
        ├── combatV2.ts (tactical commands, enemy intent cycles, 3 multi-phase bosses)
        ├── routeGenerator.ts (sector-aware 6-layer DAG + pluggable enemy/event registries)
        ├── encounter.ts + events.ts + dismantle.ts (multi-cut derelicts, 16+ event deck, scrap)
        ├── factions.ts + contracts.ts (3 factions, rep ranks, 5 contract types + bonus goals)
        ├── buildStatsV2.ts + inventoryV2.ts + loadout.ts (16 equipment, 4 gadgets, 4 ships, power cells)
        ├── progressionV2.ts + settlementV2.ts (T1–T3 facilities, Stargate Relay, relic passives, career)
        └── achievements.ts + persistenceV2.ts (18 achievements, 30-run ledger, V2->V3 migration)
```

---

## Code Layout

- **Root & Config**:
  - `.gitignore` — MUST include `.agents/` alongside `node_modules/`, `dist/`, `.DS_Store`, `*.log`, `coverage/`.
  - `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts` (E2E Track).
  - `PROJECT.md`, `TEST_INFRA.md` (E2E Track), `TEST_READY.md` (E2E Track).
- **Shared Infrastructure (preserve V1 compatibility)**:
  - `src/main.ts` — Mode router (`?mode=v1` vs default `v2`), imports V3 modular CSS.
  - `src/assets/{itemArt,manifest}.ts`, `src/audio/soundEngine.ts`, `src/domain/{rng,tabLock,progression}.ts`, `src/data/buildings.ts`.
  - `src/scenes/{PhaserHost,BaseScene}.ts`, `src/ui/{Modals,styles}.css|ts`.
- **Legacy V1 (DO NOT BREAK)**:
  - `src/data/{items,nodes,shapes,tutorial}.ts`, `src/domain/{buildStats,combat,economy,expedition,inventory,persistence}.ts`, `src/scenes/CombatScene.ts`, `src/ui/{AppController,CargoGrid}.ts`.
- **V2/V3 Active Game**:
  - `src/v2/data/`: `shapes.ts`, `ships.ts`, `crew.ts`, `equipment.ts`, `cargo.ts`, `contracts.ts`, `enemies.ts`, `facilities.ts`, `trialBuilds.ts`, `tutorialV2.ts`, `showcaseRun.ts`, plus new V3 modules: `campaign.ts`, `sectors.ts`, `bosses.ts`, `events.ts`, `factions.ts`, `gadgets.ts`, `achievements.ts`, `lore.ts`.
  - `src/v2/domain/`: existing 16 pure modules + new V3 modules: `campaign.ts`, `dismantle.ts`, `events.ts`, `factions.ts`, `achievements.ts`.
  - `src/v2/scenes/`: `V2CombatScene.ts`.
  - `src/v2/ui/`: `V2AppController.ts` (thin coordinator), `CargoGridV2.ts`, `V2Modals.ts`, `icons.ts`, `screens/` (`TitleView.ts`, `BaseView.ts`, `PrepareView.ts`, `MapView.ts`, `CombatView.ts`, `WreckView.ts`, `EventView.ts`, `ShopView.ts`, `RewardView.ts`, `ArrangeView.ts`, `SettlementView.ts`, `EndingView.ts`), `modals/` (`CampaignModal.ts`, `ContractsModal.ts`, `WorkshopModal.ts`, `CareerModal.ts`), `styles/` (`v3-layout.css`, `v3-campaign.css`, `v3-combat.css`, `v3-dismantle.css`, `v3-endgame.css`).
- **Tests**:
  - Unit & Simulation (Vitest, `npm run test`): `tests/rules.test.ts`, `tests/simulation.test.ts`, `tests/v2-rules.test.ts`, `tests/v2-simulation.test.ts`, `tests/v2-polish.test.ts`, plus new suites `tests/v2-foundation.test.ts`, `tests/v2-campaign.test.ts`, `tests/v2-combat-boss.test.ts`, `tests/v2-dismantle-events.test.ts`, `tests/v2-station-buildcraft.test.ts`, `tests/v2-endgame.test.ts`.
  - Opaque-Box E2E (Playwright + auto-detected Chromium, owned by E2E Testing Track): `playwright.config.ts`, `tests/e2e/**`.
- **Build & Test Commands**:
  - Install: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`
  - Unit/Sim tests: `npm run test` (`vitest run`)
  - Typecheck & Build: `npm run build` (`tsc --noEmit && vite build`)
  - E2E tests: `npm run test:e2e` (defined by E2E Testing Track / `TEST_READY.md`)

---

## Feature Inventory

Every feature discovered across all 3 Survey reports (Spec Miner + Explorer #1 + Explorer #2) is listed below and explicitly assigned to a milestone (0 unassigned):

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Repo Hygiene & Tooling Baseline | Add `.agents/` to `.gitignore`, run `npm install` + install `@playwright/test` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), verify baseline `42/42` Vitest + `tsc && vite build`. | M1 | Explorer #1 |
| F02 | Save Schema V3 & Non-Destructive V2→V3 Migration | Bump `V2_SCHEMA_VERSION` to `3` with automatic backward-compatible `2 -> 3` upgrade in `persistenceV2.ts` (preserving backup & mapping existing progress to Campaign Acts), adding typed fields for campaign, sectors, crew mastery, factions, salvageParts, facility tiers, gadgets, career stats, run history, achievements, endings, and endless threat level. | M1 | Spec Miner, Explorer #1 |
| F03 | Modular Screen/CSS Split & E2E Testability Contracts | Extract screen views (`src/v2/ui/screens/*`) and modular styles (`src/v2/ui/styles/*`) from `V2AppController.ts`/`styles.css`; add `?seed=<uint32>` deterministic seed forwarding, stable `data-testid`/`data-phase`/`data-screen`/`data-act` attributes, and strictly read-only `window.__STARLINE_INSPECT__()` getter. | M1 | Explorer #1, Explorer #2 |
| F04 | V2 Bug Remediation & De-Demo Presentation | Wire `soundEngine.setTrack('base' \| 'expedition' \| 'boss')` + add `'boss'` BGM track; fix `restoreV2Relic` SFX (`'relicRestore'`); fix Codex `29/31` cap (100% attainable) + real `seenItems` ("见闻") tracking; fix empty locked deep contracts preview; wire `recentEquipmentKinds` anti-repeat guard; show Engineer Swap in `SHOP`; de-demo Title Screen (move "4 站精华试玩" & "经典模式" to secondary drawer); fix 1366×768 fold clipping (sticky Prepare/Settlement CTAs, collapsed loan rows, left-panel Arrange inspector, crisp high-contrast Star Map DAG arrows). | M1 | Spec Miner, Explorer #2 |
| F05 | 4-Act Main Campaign (`星门重启计划`) & Quest Tracker | Implement Prologue + Acts I–III + Post-Game campaign state machine (`campaign.ts`), persistent collapsible Base HUD Mission Banner, full Campaign Roadmap / Story Comms modal, Act transition briefings, milestone reveal banners, and pity/guaranteed relic signal progression so players are never RNG-locked. | M2 | Spec Miner, Explorer #1, Explorer #2 |
| F06 | 3 Distinct Star Sectors & Environmental Modifiers | Implement Sector 1 (`近轨残骸带`, `sector_1/2/4`), Sector 2 (`冰晶舰冢带`, `sector_4/5/3`, cryo/ion rule), and Sector 3 (`古代星门禁区`, `sector_3/5/6`, gravity tide rule) with sector selection, unlock gates, sector-specific loot/enemy/event weights, and deterministic environmental modifiers reflected in combat preview & execution. | M2 | Spec Miner, Explorer #1, Explorer #2 |
| F07 | Named Crew Roster, SVG Portraits, Comms & Mastery | Upgrade 3 crew into named specialists (**林工**, **陆衡**, **苏岚**) with inline SVG portraits, reactive 1–2 line radio comms on boss/relic/chapter events (resolving "营救工程师" clash), and 3-tier Crew Mastery perks earned via expedition feats. | M2 | Spec Miner, Explorer #2 |
| F08 | Active Tactical Command System (Default-ON) | Promote mid-combat tactical decisions out of hidden Settings into default-ON core gameplay with Command Charge (1 in regular/elite, 2 in Act Bosses): 3 universal orders (`火力过载`, `紧急护盾`, `聚焦校准`) + per-hull Signature Command; 100% deterministic preview/re-sim, reload-safe idempotency, Pure-Auto toggle preserved in Settings. | M3 | Spec Miner, Explorer #1, Explorer #2 |
| F09 | Expanded Enemy Roster (8+ Regular) & Telegraphed Intents | Activate unused `enemy_hulk.webp` and expand regular/elite enemies to 8+ distinct types (Charging Artillery, Shield Regenerator, Drone Carrier, EMP Disruptor, Hull Rammer, etc.) with publicly telegraphed round-by-round intent cycles rendered in preview and combat HUD. | M3 | Spec Miner, Explorer #1, Explorer #2 |
| F10 | 3 Multi-Phase Act Bosses | Replace the single cloned elite stat block with 3 mechanically unique multi-phase Act Bosses: Act I **铁砧号** (`enemy_hulk`, drone summons + heavy armor), Act II **铁壁无畏** (`boss_dreadnought`, shield overload + piercing charge beam), Act III **黑曜利维坦** (`boss_leviathan`, 3 phases: escorts → reactor exposure → final volley), with phase VFX/SFX and accurate deterministic preview. | M3 | Spec Miner, Explorer #1, Explorer #2 |
| F11 | True "Dismantling (拆解)" Loop: Multi-Cut Derelicts & Scrap Refining | Upgrade Wrecks into press-your-luck **Derelict Dissection** with Structural Stability / Alarm Meter (safe 1st cut; optional greedy 2nd/3rd cuts with disclosed hull/fuel/ambush risk & lethal-cut guard); add **Dismantle → Salvage Parts (`精密零件`)** at Settlement & Workbench to **Upgrade Common → Improved**, craft modules, and tune hulls (protecting loan/mission items). | M4 | Spec Miner, Explorer #1, Explorer #2 |
| F12 | 16+ Narrative & Tactical Sector Event Deck | Replace single-template Anomaly & Distress nodes with ≥16 distinct sci-fi salvage/dilemma events (black-box decode, black-market smuggler, drifting convoy, unstable reactor, rival scavengers, automated drydock, stargate echo, puzzle cache, etc.), crew-specific bonus options, non-repeating draw per run, and safe unaffordable fallbacks. | M4 | Spec Miner, Explorer #1, Explorer #2 |
| F13 | 3 Orbital Factions, Reputation & Expanded Contracts | Introduce **星港行会**, **深空研究院**, and **自由拾荒团** with Rep Levels 1–3 & perks; add 2 new contract types (**清剿悬赏 / Bounty Hunt**, **黑匣打捞 / Derelict Extraction**) and **Optional Bonus Objectives** on contracts (e.g., HP ≥ 60% or 0 discards for +30% bonus). | M4 | Spec Miner, Explorer #1 |
| F14 | Deepened Buildcraft: 6 New Modules, 4 Gadgets, 4th Flagship & Power Cells | Add 6 cross-archetype equipment modules (10 → 16: `coolant_vent`, `cargo_amp`, `emp_jammer`, `overdrive_core`, `salvage_grapple`, `salvo_pod`), 4 `1×1` consumable tactical gadgets (`repair_kit`, `overcharge_cell`, `jump_canister`, `cut_stabilizer`), 4th unlockable Flagship (`stargate_cruiser`, 5×5 irregular / 20 cells, budget 8), and highlighted **Hull Power Cells** on every ship grid. | M5 | Spec Miner, Explorer #1, Explorer #2 |
| F15 | Upgradable Station Departments (T1–T3), Stargate Relay, Relic Passives & Economy Runway | Expand facilities to T1–T3 upgrades + new **星门通讯塔 (`stargate_relay`)**; grant all 4 restored Relics active station passives (`ancient_navigator` +1 fuel & full map reveal, `cryo_amber` +4 max HP, `quantum_core` +1 budget, `obsidian_crown` +1 boss tactical charge); expand meaningful progression sinks to ~4,500–6,000¤ + Salvage Parts; reconcile Trial Kits into in-universe Holodeck/Tactical Templates without cannibalizing Act I blueprint unlocks. | M5 | Spec Miner, Explorer #1, Explorer #2 |
| F16 | Full V2 `BaseScene.ts` Orbital Station Diorama Parity | Decouple V2 station rendering from V1 `BaseProgression` adapter; render active berthed player ship on the landing pad; display visible diegetic upgrades/lighting for `contract_hub`, `research_lab`, `drydock_tier2`, facility tier progression, relic aura, and `stargate_relay`. | M5 | Spec Miner, Explorer #1, Explorer #2 |
| F17 | Act III Climax Mission, 3 Campaign Endings & Victory Ceremony | Implement dedicated Act III final mission (`星门重启远征` culminating in 3-phase `黑曜利维坦`), climax narrative choice, Victory Ceremony & Epilogue screen with 3 distinct endings (`星门重燃`, `自由港湾`, `旧舰队继承者`), Ending Gallery, and non-destructive return to Base. | M6 | Spec Miner, Explorer #1, Explorer #2 |
| F18 | Endless Abyss (`威压 1–10`), Career Ledger, Bestiary, Lore, 18 Achievements & Balance Matrix | Implement Post-Game Endless Abyss (`威压 1–10` + run mutators + seeded challenge), 30-run Career Ledger with real career stats, Enemy Bestiary & Boss Dossier, Story/Comms Archive, 18 Achievements/Medals with rewards, and full-game Vitest + Monte Carlo balance verification. | M6 | Spec Miner, Explorer #1 |
| F19 | Independent Opaque-Box E2E Suite (Tiers 1–4) & Adversarial Hardening (Tier 5) | Build requirement-driven Playwright E2E infrastructure (`TEST_INFRA.md`, `playwright.config.ts`, `tests/e2e/**`, `TEST_READY.md`) covering Tiers 1–4 across desktop (`1366×768`) & mobile (`390×844`), pass 100% of E2E tests, then run Tier-5 white-box adversarial coverage hardening. | E2E Track + M7 | Project Pattern, Explorer #2 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|--------------|--------|
| E2E | E2E Testing Track | Opaque-box requirement-driven E2E test infrastructure (`TEST_INFRA.md`, `playwright.config.ts`, `tests/e2e/` Tiers 1–4) using auto-detected Chromium, publishing `TEST_READY.md`. | none (uses `@playwright/test` installed by M1) | DONE (`TEST_READY.md`, 33 files / 135 tests, 5/5 unanimous + Auditor CLEAN) |
| M1 | Foundation, Schema V3, Screen Split & V2 Bug Fixes | F01, F02, F03, F04 — `.gitignore`, `npm install`, `@playwright/test`, `schemaVersion: 3` migration, screen/CSS split, E2E testability hooks, all V2 bug & layout fixes. | none | DONE (`tsc` 0 errors, Vitest 64/64, `vite build` pass, 5/5 unanimous + Auditor CLEAN) |
| M2 | Mainline Campaign, 3 Star Sectors & Named Crew | F05, F06, F07 — 4-Act campaign engine, HUD tracker & modal, 3 sectors + env modifiers, pity-protected relic signals, named crew portraits/comms/mastery, pluggable `routeGenerator` registries. | M1 | DONE (`tsc` 0 errors, Vitest 88/88, `vite build` pass, 5/5 unanimous + Auditor CLEAN) |
| M3 | Active Tactical Combat, Expanded Enemies & 3 Multi-Phase Bosses | F08, F09, F10 — Default-ON tactical command system + ship signatures, 8+ enemies with telegraphed round intents, 3 multi-phase Act Bosses (`铁砧号`, `铁壁无畏`, `黑曜利维坦`), VFX/SFX. | M1, M2 | DONE (`tsc` 0 errors, `vite build` 87 modules, Reviewer APPROVE + Auditor CLEAN; tests deferred to M7) |
| M4 | True Dismantling Loop, 16+ Event Deck & Faction Contracts | F11, F12, F13 — Multi-cut press-your-luck derelict dissection, Salvage Parts dismantling & Common→Improved upgrades, 16+ crew-reactive event deck, 3 factions + rep + Bounty/Derelict contracts + bonus objectives. | M1, M2 | DONE (`tsc` 0 errors, `vite build` 94 modules, Reviewer APPROVE + Auditor CLEAN; tests deferred to M7) |
| M5 | Buildcraft Expansion, Upgradable Station, Relic Passives & Diorama Parity | F14, F15, F16 — 6 new modules (16 total), 4 consumable gadgets, 4th Flagship (`星门巡洋舰`) + hull power cells, T1–T3 facilities + Stargate Relay + 4 active relic passives, Holodeck trial reconciliation, full V2 `BaseScene` diorama. | M1, M2, M4 | DONE (`tsc` 0 errors, `vite build` 96 modules, Reviewer APPROVE + Auditor CLEAN; tests deferred to M7) |
| M6 | Climax Mission, 3 Endings, Endless Abyss, Career/Achievements & Balance | F17, F18 — Final `星门重启远征` mission, 3 endings + Victory Ceremony, Endless Abyss (`威压 1–10` + mutators + seed challenge), 30-run Career Ledger, Bestiary, Lore Archive, 18 Achievements, full balance matrix. | M2, M3, M4, M5 | DONE (`tsc` 0 errors, `vite build` 102 modules, Reviewer APPROVE + Auditor CLEAN; tests deferred to M7) |
| M7 | Final Milestone: E2E Tiers 1–4 Pass & Tier 5 Adversarial Hardening | F19 — Phase 0: complete M3–M6 Vitest + balance sim; Phase 1: pass 100% of E2E Tiers 1–4 sequentially (dev + `E2E_USE_PREVIEW=1`); Phase 2: white-box adversarial Tier-5 Challenger loop until zero remaining gaps; final whole-project Forensic Audit CLEAN. | M6, E2E (`TEST_READY.md`) | DONE (`tsc` 0 errors, Vitest 12/12 files / 121/121 PASS incl. V1 20/20, `vite build` 102 modules, Playwright `E2E_USE_PREVIEW=1` 34 files / 139/139 PASS [Tiers 1–4 135/135 + Tier 5 4/4, 0 console/page/asset errors], Forensic Audit CLEAN) |

---

## Interface Contracts

### 1. Save Schema V3 & Migration (`src/v2/domain/types.ts` ↔ `persistenceV2.ts`)
- `V2_SCHEMA_VERSION = 3`, `V2_RULES_VERSION = '3.0.0'`.
- `loadV2Save()` MUST accept both `schemaVersion === 2` and `schemaVersion === 3`:
  - On loading `schemaVersion === 2`, save a backup under `starline_save_backup_v2` (if not already backed up) and migrate non-destructively to `schemaVersion: 3`, preserving all V2 fields (`credits`, `buildings`, `unlockedShips`, `unlockedCrew`, `unlockedFamilies`, `blueprints`, `equipmentWarehouse`, `relics`, `discoveredItems`, `loadoutPresets`, `completedContractIds`, `totalRuns`, `tutorialCompleted`) and initializing V3 fields cleanly (inferring Campaign Act progress from existing facilities/contracts/relics).
- Additive V3 fields on `V2ProfileState`:
  ```ts
  export type CampaignActId = 'prologue' | 'act1' | 'act2' | 'act3' | 'endless';
  export type SectorId = 'near_orbit' | 'frozen_graveyard' | 'stargate_abyss';
  export type FactionId = 'starport_guild' | 'deep_institute' | 'free_salvagers';
  export type EndingId = 'stargate_reignited' | 'free_haven' | 'fleet_heir';

  export interface V3CampaignState {
    currentAct: CampaignActId;
    unlockedSectors: SectorId[];
    completedMilestones: string[];
    defeatedBossIds: string[];
    readCommsIds: string[];
    relicPityCounters: Record<string, number>;
    endingsUnlocked: EndingId[];
    finalMissionUnlocked: boolean;
    endlessUnlocked: boolean;
    maxEndlessThreat: number; // 0..10
  }

  export interface V3CareerStats {
    totalWins: number;
    totalDefeats: number;
    totalSafeReturns: number;
    totalCreditsEarned: number;
    totalSalvagePartsEarned: number;
    totalBossesDefeated: number;
    totalWrecksDissected: number;
    totalItemsDismantled: number;
    deepestEndlessCleared: number;
  }
  ```
  Plus on `V2ProfileState`:
  - `salvageParts: number` (default `0`)
  - `facilityTiers: Record<string, number>` (default derived from `buildings`: `0 | 1 | 2 | 3`, includes `'stargate_relay'`)
  - `campaign: V3CampaignState`
  - `factionRep: Record<FactionId, number>` (0..300; Lv1=0, Lv2=100, Lv3=220)
  - `crewMastery: Record<V2CrewId, number>` (tier `0 | 1 | 2`)
  - `achievementsUnlocked: string[]`
  - `defeatedEnemyKinds: string[]` (for Bestiary)
  - `runHistory: V3RunHistoryEntry[]` (capped ring buffer max 30 entries)
  - `career: V3CareerStats`
- Additive V3 fields on `V2RunState`:
  - `sectorId: SectorId` (default `'near_orbit'`)
  - `endlessThreat?: number` (0 for campaign, 1..10 for Endless Abyss)
  - `endlessMutatorIds?: string[]`
  - `recentEquipmentKinds: string[]` (for L1–L3 anti-repeat guard)
  - `usedEventIds: string[]` (non-repeating event deck per run)
  - `bonusObjective?: { id: string; label: string; completed: boolean; rewardCredits: number }`
  - `tacticalChargesMax: number` / `tacticalChargesUsed: number`
  - `salvagePartsEarned: number`
  - `isFinalCampaignRun?: boolean`

### 2. E2E Testability & Observability Contract (`src/v2/ui/V2AppController.ts` ↔ `tests/e2e/**`)
- **Deterministic Seed URL Parameter**:
  - `?seed=<uint32>` parsed at startup; forwarded deterministically into `launchV2Expedition` (subsequent launches in the same browser session increment `seed + runIndex`).
- **Strictly Read-Only Telemetry Getter** (ZERO mutator methods!):
  ```ts
  // Exposed on window.__STARLINE_INSPECT__ (read-only snapshot)
  export interface StarlineInspectSnapshot {
    mode: 'v1' | 'v2';
    schemaVersion: number;
    screen: 'title' | 'base' | 'prepare' | 'run' | 'ending';
    phase: string | null; // 'MAP' | 'ENCOUNTER' | 'REWARD' | 'SHOP' | 'ARRANGE' | 'SETTLEMENT' | null
    phaserScene: string | null; // 'BaseScene' | 'V2CombatScene' | 'CombatScene' | null
    bgmTrack: string; // 'base' | 'expedition' | 'boss' | 'none'
    campaignAct: string;
    unlockedSectors: string[];
    endingsUnlocked: string[];
    credits: number;
    salvageParts: number;
    activeRun: {
      runId: string;
      seed: number;
      sectorId: string;
      contractId: string;
      shipId: string;
      crewId: string;
      layer: number;
      fuel: number;
      hp: number;
      maxHp: number;
      wallet: number;
      combatRound: number | null;
      combatWaitingDecision: boolean;
      wreckStability: number | null;
      isFinalCampaignRun: boolean;
      endlessThreat: number;
    } | null;
    failedAssets: string[];
    modalOpen: boolean;
  }
  ```
- **Stable DOM Attributes & `data-testid` Contract**:
  - Root `.app-shell.v2-shell`: `data-screen`, `data-phase`, `data-act`, `data-sector`.
  - Title Screen: `[data-testid="title-screen"]`, `[data-testid="btn-enter-station"]`, `[data-testid="btn-more-modes"]`.
  - Base Screen: `[data-testid="base-screen"]`, `[data-testid="campaign-banner"]`, `[data-testid="btn-open-campaign"]`, `[data-testid="btn-open-contracts"]`, `[data-testid="btn-open-facilities"]`, `[data-testid="btn-open-warehouse"]`, `[data-testid="btn-open-relics"]`, `[data-testid="btn-open-codex"]`, `[data-testid="btn-open-career"]`, `[data-testid="btn-start-tutorial"]`, `[data-testid="btn-start-recommended"]`.
  - Prepare Screen: `[data-testid="prepare-screen"]`, `[data-testid="sector-selector"]`, `[data-testid="ship-selector"]`, `[data-testid="crew-selector"]`, `[data-testid="btn-launch-expedition"]`.
  - Map Screen: `[data-testid="map-screen"]`, `[data-testid="map-node-<id>"]`, `[data-testid="btn-jump-node"]`, `[data-testid="btn-safe-return"]`.
  - Combat Screen: `[data-testid="combat-screen"]`, `[data-testid="btn-start-combat"]`, `[data-testid="combat-tactical-bar"]`, `[data-testid="tactical-order-<id>"]`, `[data-testid="btn-combat-skip"]`.
  - Wreck/Event/Shop/Reward/Arrange/Settlement/Ending: `[data-testid="wreck-screen"]`, `[data-testid="wreck-stability"]`, `[data-testid="wreck-cut-<spot>"]`, `[data-testid="btn-wreck-extract"]`, `[data-testid="event-screen"]`, `[data-testid="event-choice-<index>"]`, `[data-testid="shop-screen"]`, `[data-testid="reward-screen"]`, `[data-testid="arrange-screen"]`, `[data-testid="btn-leave-arrange"]`, `[data-testid="settlement-screen"]`, `[data-testid="btn-confirm-settlement"]`, `[data-testid="ending-screen"]`, `[data-testid="ending-choice-<id>"]`, `[data-testid="btn-ending-continue"]`.
  - Cargo Grid: `.cargo-cell[data-cx][data-cy]` (plus `data-power-cell="true"` for hull power cells in M5).

### 3. Pluggable Sector/Encounter/Combat Registries (M2 ↔ M3 ↔ M4)
- `routeGenerator.ts` (owned by M2 after M1) delegates enemy formation lookup to `buildSectorEnemyEncounter(sectorId, layer, kind, rng, endlessThreat)` in `src/v2/data/enemies.ts` (owned by M3) and delegates non-combat event payload lookup to `drawSectorEventPayload(sectorId, nodeType, usedEventIds, rng)` in `src/v2/data/events.ts` (owned by M4).
- M2 provides clean default implementations/stubs for both hooks so M2 compiles and passes tests independently; M3 and M4 then upgrade their respective modules in parallel with ZERO file overlap.

### 4. BaseScene V2 Diorama Interface (`V2AppController.ts` ↔ `BaseScene.ts`)
- M5 adds `setV2StationState(state: V2BaseDioramaState)` on `BaseScene` (`activeShipId`, `facilityTiers`, `restoredRelicIds`, `campaignAct`, `stargatePowered`) while preserving the existing V1 `setProgression()` method intact for `?mode=v1`.

### 5. Git Commit Hygiene Protocol (All Milestones)
- `.agents/` MUST be in `.gitignore` (added in M1 first).
- Every milestone sub-orchestrator stages ONLY its explicitly owned files (`git add -- <files>`) — NEVER `git add -A` or `git add .` — and commits upon passing its milestone gate so progress is preserved cleanly on `main`.

---

## Round 2: Experience Overhaul Execution Plan (`docs/PROJECT-体验重铸.md`)

> **User Request (`.agents/teamwork/ORIGINAL_REQUEST.md`)**: `以 docs/PROJECT-体验重铸.md 作为本轮执行计划，优先推进修复代码编写任务，任务修改完成则开PR合并到Main，修复完所有都合并到main之后再进入测试环境`
> **Surveyed Baseline**: `main@8a8626d` (PR #1 V3 Expansion + PR #2 First-Voyage Review Docs; `node_modules/` absent; 5 stale Vitest assertions on `main` fixed on unmerged `origin/feat/m7-tests-hardening@12d7ff5`).
> **Execution Principle**: Prioritize all code-fix implementation milestones (`R2-M1` through `R2-M6`), verifying each milestone with independent Review + Challenge + Forensic Audit and opening & merging PRs to `main` (`gh pr create --base main` → Gate PASS → `gh pr merge --merge --delete-branch`). Enter the browser/Playwright test environment (`R2-M7`) ONLY AFTER all code-fix PRs (`R2-M1`–`R2-M6`) are merged into `main`.

### Adopted Design Decisions (`docs/PROJECT-体验重铸.md §7` Defaults)
- **D1 = `b`**: Default Layer-1 forecast shows qualitative Threat Tiers (`稳 / 吃力 / 危险 / 致命`) + `↑↓` trend badges; exact deterministic simulation (`余 xxHP (n轮)`, labeled `不干预时结果`) lives in an on-demand Details Drawer.
- **D2 = `b`**: Free safe return restricted to Beacon nodes only (with non-softlock emergency tow fallback and intact `0¤` bankruptcy launch guarantee).
- **D3 = `b` (harmonized with PR #1 Active Tactical Commands)**: Preserve PR #1's default-ON Active Tactical Commands (`1` charge regular / `2` boss) AND extend with deterministic per-module click-to-overload (`interventions[]`, including battery boosting adjacent weapons).
- **D4 = `b`**: Battery supply capacity cap (Common = 1 adjacent weapon, Improved = 2 adjacent weapons, deterministic tie-breaker) + `cargo.coolant_tank`↔`heavy` cross-category synergy + `"新联动！"` discovery popup & ledger.
- **D5 = `a`**: Preserve legacy V1 (`?mode=v1`) untouched.

### Round 2 Feature Inventory (46 Items — 100% Assigned, 0 Unassigned)

| # | Plan ID | Feature | Work Class | Post-V3 Status | Milestone | Source |
|---|---|---|---|---|---|---|
| 0 | `PRE-01` | Env Bootstrap (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci`) & Reconcile `origin/feat/m7-tests-hardening` (fixes 5 broken Vitest cases, adds 4 M3–M6 suites 116/116, 14 domain hardening fixes, SwiftShader low-FPS combat fix) | `CODE-FIX` | Pending | R2-M1 | Explorer #2 |
| 1 | `F01` | Persistent `CargoGridV2Component` + local Arrange refresh (0 destroy/recreate on 10 drags) | `CODE-FIX` | Pending | R2-M1 | Spec Miner, Explorer #1 |
| 2 | `F02` | Phaser stage `playbackKey` deduplication (static stages & wreck cut FX no longer wiped on frame 0) | `CODE-FIX` | Partial-V3 | R2-M1 | Spec Miner, Explorer #1 |
| 3 | `F03` | `tacticalDelta` cache (`bayHash+itemId+zone`, idle scheduling) + `CargoGridV2` sub-render split (0 `simulateV2Combat` on arrow keys) | `CODE-FIX` | Pending | R2-M1 | Spec Miner, Explorer #1 |
| 4 | `F04` | Stateful `mount/update/unmount` lifecycle on `src/v2/ui/screens/{ArrangeView,MapView}.ts` | `CODE-FIX` | Partial-V3 | R2-M1 | Spec Miner, Explorer #1 |
| 5 | `F05` | Phase-switch & UI persistence Vitest unit tests + Playwright 10-screenshot first-voyage capture script (`scripts/capture-first-voyage.mjs`) | `CODE-FIX` + `TEST-ENV` | Partial-V3 | R2-M1 (code), R2-M7 (run) | Spec Miner, Explorer #1 |
| 6 | `G0` | Foundation Gate (all Vitest + F01–F05 regression green) | `GATE` | Pending | R2-M1 / R2-M7 | Spec Miner |
| 7 | `S01` | Rewrite `tutorialV2.ts` per §4.1 (14HP target, battery in staging/hand, penultimate 2×3 reactor w/ sacrifice preview, post-reactor fork w/ risky enemy + `ancient_navigator`, `engineerSwapAvailable: true`, Base Step-0 focus) | `CODE-FIX` | Pending | R2-M3 | Spec Miner, Explorer #1 |
| 8 | `S02` | `shouldAutoSkipArrange(run)` across all 6 resolution paths in `encounter.ts`/`events.ts` + editable CargoGrid on `MAP` | `CODE-FIX` | Partial-V3 | R2-M3 | Spec Miner, Explorer #1 |
| 9 | `S03` | Persistent `ShipStage` (≥60% viewport at 1366×768 / 390×844 / 844×390) + persistent `HoldView` + floating `ContextDock`, Arrange expanded by default, slim HUD | `CODE-FIX` | Pending | R2-M4 | Spec Miner, Explorer #1 |
| 10 | `S04` | Unified Star Map (node = card, 1-click jump preserving `data-testid`s) + hide target policy when `units.length <= 1` | `CODE-FIX` | Pending | R2-M3 | Spec Miner, Explorer #1 |
| 11 | `S05` | Pre-combat merge (pausable 1.5s auto-engage countdown; cancels on pause/policy/gadget/details/unmount/read-only) | `CODE-FIX` | Pending | R2-M3 | Spec Miner, Explorer #1 |
| 12 | `S06` | Qualitative Threat Tiers (`稳/吃力/危险/致命` + `↑↓`) on Layer 1 + on-demand Details Drawer (`不干预时结果`) + 1-row compact CargoGrid stat bar (preserve `data-preview-final-hp`) | `CODE-FIX` | Pending | R2-M4 | Spec Miner, Explorer #1 |
| 13 | `S07` | Tactile drag-drop (grab offset + mobile lift, ghost snap, live hover synergy links + animated `.energy-link-line`, invalid spring-back, distinct SFX, opt-in `recommendedSpot`, un-linked fallback loadout) | `CODE-FIX` | Partial | R2-M4 | Spec Miner, Explorer #1 |
| 14 | `S08` | Direct Wreck clamp click → ~600ms skippable plasma cut FX → FLIP item flight to staging → state commit (instant in `reducedMotion`) | `CODE-FIX` | Pending | R2-M4 | Spec Miner, Explorer #1 |
| 15 | `S09` | Return-to-port real item artwork unloaded by `BaseScene` crane + auto-resolve single-option settlement items (`buttons <= decisionItems + 1`) + sequential `creditTick` rollup | `CODE-FIX` | Partial | R2-M4 | Spec Miner, Explorer #1 |
| 16 | `S10` | Post-tutorial recommended contract differs from `transport_std` (distinct gameplay & tradeoff) | `CODE-FIX` | Pending | R2-M3 | Spec Miner, Explorer #1 |
| 17 | `A01` | Localized ADD hit glow + ≤40ms mild tint + shield-only absorb flash (remove all `setTintFill(0xffffff)`) | `CODE-FIX` | Pending | R2-M2 | Spec Miner, Explorer #1 |
| 18 | `A02` | Multi-beat `time.delayedCall` combat round choreography (0/120/160-200/450ms ÷ `speed`, clean `skipPlayback` timer cancel) | `CODE-FIX` | Pending | R2-M2 | Spec Miner, Explorer #1 |
| 19 | `A03` | 3-layer beams, heavy cannon tracers, muzzle flash, capped spark/shield-shard particles (≤24/burst, ≤100 active, off in `lowQuality`), 40–80ms hitstop | `CODE-FIX` | Pending | R2-M2 | Spec Miner, Explorer #1 |
| 20 | `A04` | Multi-stage death choreography (staggered explosions, split-hull drift, debris), damage-trail ticked HP bars, tiered non-overlapping staggered damage popups | `CODE-FIX` | Pending | R2-M2 | Spec Miner, Explorer #1 |
| 21 | `A05` | Engine exhaust plumes via `manifest.ts` `hardpoints.engine` + subtle idle micro-tilt | `CODE-FIX` | Pending | R2-M2 | Spec Miner, Explorer #1 |
| 22 | `A06` | High-res layered gunboat (`1024×512`), 5 modules (`512×256`), 1 enemy (`1024×512` + split halves): code support (`A04` split clipping + hardpoint wiring) in R2-M2; hand-painted WebP raster plates tracked as `EXTERNAL-ART` | `CODE+ART` | Pending (art external) | R2-M2 (code) / External-Art | Spec Miner, Explorer #1 |
| 23 | `A07` | High-res layered wreck cutaway (`2560×1440` 3 rooms × 2 states): interactive compartment cutaway/clamp code in R2-M4 (`S08`); hand-painted WebP raster plates tracked as `EXTERNAL-ART` | `CODE+ART` | Pending (art external) | R2-M4 (code) / External-Art | Spec Miner, Explorer #1 |
| 24 | `A08` | Base 4-joint articulated crane + smooth overlay cross-fade/scanline power-up (`BaseScene.ts` code in R2-M2); hand-painted iso gunboat / 3-state base WebP raster plates tracked as `EXTERNAL-ART` | `CODE+ART` | Pending (art external) | R2-M2 (code) / External-Art | Spec Miner, Explorer #1 |
| 25 | `A09` | Industrial Terminal UI skin v1 (`src/v2/ui/styles/v3-terminal-skin.css` scoped to `.v2-shell`: 45° `clip-path`, recessed CRT, tactile buttons, hazard stripes, powered-off disabled, 0 functional pills on first voyage) + revise Art Spec §8 | `CODE-FIX` | Pending | R2-M5 | Spec Miner, Explorer #1 |
| 26 | `A10` | Full WebAudio overhaul (`sfxBus`/`bgmBus`/`ambientBus` → `DynamicsCompressorNode` → `masterGain`, ambient noise bed, ±5% pitch randomization, 7+ new SFX kinds, `creditTick` & UI/combat/base caller wiring) | `CODE-FIX` | Partial-V3 | R2-M2 (engine) + R2-M4 (callers) | Spec Miner, Explorer #1 |
| 27 | `G1` | Internal First-Voyage Slice Walkthrough (desktop + mobile + pointer-only + keyboard-only + `reducedMotion` + all §8 automated metrics) | `TEST-ENV` | Pending | R2-M7 | Spec Miner |
| 28 | `T01` | Opt-in local playtest telemetry (`?playtest=1`, `localStorage['starline_playtest_log']`, JSON export, zero writes when inactive) | `CODE-FIX` | Pending | R2-M4 | Spec Miner, Explorer #1 |
| 29 | `T02` | 8-player counterbalanced human blind playtest vs `8f43788` | `PLAYTEST-HUMAN` | External | External-Human (enabled by T01) | Spec Miner, Explorer #1 |
| 30 | `T03` | Human playtest evaluation report (`docs/reviews/<date>-v3-slice/`) | `PLAYTEST-HUMAN` | External | External-Human | Spec Miner, Explorer #1 |
| 31 | `G2` | Scale-up human playtest gate (≥6/8 refit, ≤60s action, ≤1 confirm, ≥4/8 replay) | `PLAYTEST-HUMAN` | External | External-Human | Spec Miner |
| 32 | `D01` | Mid-combat component Overload (`interventions[]` + clickable mounted ship modules incl. battery-adjacent boost, harmonized with PR #1 Active Tactical Commands) | `CODE-FIX` | Partial-V3 | R2-M6 | Spec Miner, Explorer #1 |
| 33 | `D02` | Specific-enemy target lock (`lockedEnemyId`) on top of PR #1's enemy intent cycles (click card or canvas sprite; fallback on death) | `CODE-FIX` | Partial-V3 | R2-M6 | Spec Miner, Explorer #1 |
| 34 | `D03` | Battery power capacity limit (Common=1, Improved=2, deterministic) + `cargo.coolant_tank`↔`heavy` cross-category synergy + `"新联动！"` discovery popup & `discoveredSynergies` ledger | `CODE-FIX` | Partial-V3 | R2-M6 | Spec Miner, Explorer #1 |
| 35 | `D04` | Risk-reward curve (beacon-only free return w/ non-softlock emergency fallback, depth-scaled cargo appreciation, lower defeat salvage floor, `V2_RULES_VERSION='3.1.0'` + non-destructive migration) | `CODE-FIX` | Pending | R2-M6 | Spec Miner, Explorer #1 |
| 36 | `D05` | Multi-cut press-your-luck wreck dissection ("再切一刀") — already implemented by PR #1; verify & ensure parity with `S08`/balance | `CODE-FIX` | Done-V3 | R2-M6 (verify) | Spec Miner, Explorer #1 |
| 37 | `D06` | Dynamic spatial conflict generation wired to `verifyV2SpatialConflict` guaranteeing ≥1 genuine spatial conflict per standard run | `CODE-FIX` | Pending | R2-M6 | Spec Miner, Explorer #1 |
| 38 | `D07` | 3-equipment synergy-tagged combat reward (reducing free HP heals) + Run-1 3-pick-1 equipment family unlock (PR #1 relic passives preserved) | `CODE-FIX` | Partial-V3 | R2-M6 | Spec Miner, Explorer #1 |
| 39 | `D08` | Permanent CI balance & strategy regression suite (`tests/v2-rules.test.ts` + `tests/v2-simulation.test.ts`: sandwich T09 ≤60%, policy/lock flip ≥10%, conflict ≥1/run, defeat rate 10–25%) | `CODE-FIX` | Pending | R2-M6 | Spec Miner, Explorer #1 |
| 40 | `G3` | Rule Balance Gate (proven via D08 CI balance matrix) | `GATE` | Pending | R2-M6 / R2-M7 | Spec Miner |
| 41 | `M5-1` | Remaining high-res ships/enemies/bosses/BGs/title WebP raster art (`1024×512`, `2560×1440`, `3840×2160`) | `EXTERNAL-ART` | External (post-G2) | External-Art | Spec Miner, Explorer #1 |
| 42 | `M5-2` | Unified 31+ item icons + dedicated repair drone WebP raster art | `EXTERNAL-ART` | External (post-G2) | External-Art | Spec Miner, Explorer #1 |
| 43 | `M5-3` | Industrial Terminal UI skin extended to all remaining V2/V3 screens & modals (Prepare, Shop, Facilities, Codex, Settings, Campaign, Contracts, Workshop, Career, Ending; V1 untouched) | `CODE-FIX` | Pending | R2-M5 | Spec Miner, Explorer #1 |
| 44 | `M5-4` | Stateful `mount/update/unmount` lifecycle for remaining screens (Combat, Wreck, Settlement, Shop, Prepare, Base, Event, Reward) | `CODE-FIX` | Partial-V3 | R2-M5 | Spec Miner, Explorer #1 |
| 45 | `M5-5` | 5-breakpoint responsive regression (`360×640`, `390×844`, `430×932`, `844×390`, `1366×768`) | `TEST-ENV` | Pending | R2-M7 | Spec Miner, Explorer #1 |

### Round 2 Milestones (Strictly Sequenced PR-to-`main` Pipeline → Test Environment Entry)

| # | Name | Scope | PR Target | Dependencies | Status |
|---|---|---|---|---|---|
| **R2-M1** | Bootstrap, Baseline M7 Reconcile & M0 Foundation | `PRE-01` (`npm ci` + merge `origin/feat/m7-tests-hardening` + commit updated `PROJECT.md`), `F01`, `F02`, `F03`, `F04`, `F05-code`, `G0` (Vitest/build) | PR #3 (`v3/M0-baseline-m7-reconcile`) + PR #4 (`v3/M0-foundation-f01-f05`) | none | IN_PROGRESS (dispatching R2-M1A) |
| **R2-M2** | M2 Combat VFX, BaseScene Kinematics & Audio Overhaul | `A01`, `A02`, `A03`, `A04`, `A05`, `A06-code` (split-hull clipping), `A08-code` (4-joint crane + cross-fade/scanline), `A10` (WebAudio engine/buses/compressor/ambient/pitch/SFX) | PR (`v3/M2-vfx-audio-a01-a05-a10`) | R2-M1 | PLANNED |
| **R2-M3** | M1A First-Voyage Gameplay & Flow | `S01` (tutorial rewrite), `S02` (auto-skip empty arrange + editable MAP bay), `S04` (unified 1-click Map + hide single-enemy policy), `S05` (pausable 1.5s pre-combat auto-engage), `S10` (post-tutorial contract rec) | PR (`v3/M1A-first-voyage-flow`) | R2-M1, R2-M2 | PLANNED |
| **R2-M4** | M1B Persistent Stage, Forecast, Tactile Drag, Wreck/Return & Telemetry | `S03` (persistent ShipStage ≥60% + HoldView + ContextDock), `S06` (Threat Tiers + Details Drawer + 1-row stats), `S07` (drag-drop feel + live links + opt-in solver + un-linked fallback), `S08` (direct wreck clamp + 600ms cut + FLIP), `S09` (real-sprite crane unload + auto-disposition + `creditTick`), `A10-callers`, `T01` (`?playtest=1` telemetry) | PR (`v3/M1B-stage-feel-telemetry`) | R2-M2, R2-M3 | PLANNED |
| **R2-M5** | M2/M5 Industrial Terminal UI Skin & Stateful Views | `A09` (first-voyage terminal skin + Art Spec §8 update), `M5-3` (full V2/V3 terminal skin coverage; V1 untouched), `M5-4` (stateful `mount/update/unmount` for remaining screen views) | PR (`v3/M2-M5-terminal-skin-views`) | R2-M4 | PLANNED |
| **R2-M6** | M4 Core Loop Depth, Rules v3.1 & CI Balance Suite | `D01` (component overload + Tactical Commands), `D02` (target lock), `D03` (battery cap + `coolant_tank` synergy + `"新联动！"` discovery), `D04` (beacon return + depth scaling + lower defeat floor + `V2_RULES_VERSION='3.1.0'` migration), `D05` (verify parity), `D06` (dynamic spatial conflict via `verifyV2SpatialConflict`), `D07` (3-eq synergy reward + Run-1 3-pick-1 family unlock), `D08` (CI balance matrix — Gate G3) | PR(s) (`v3/M4A-combat-buildstats-d01-d03`, `v3/M4B-risk-rewards-balance-d04-d08`) | R2-M4, R2-M5 | PLANNED |
| **R2-M7** | Final Milestone: Test Environment Verification, E2E Tiers 1–4, 5-Breakpoint & Tier-5 Hardening | Entered ONLY AFTER R2-M1..R2-M6 are ALL merged to `main`. Sync/extend E2E specs for Round-2 specs (`TEST_INFRA.md`/`TEST_READY.md`), pass 100% Vitest + `tsc` + `vite build` + Playwright E2E Tiers 1–4 (dev & preview `E2E_USE_PREVIEW=1`), run `F05` 10-screenshot capture (`1366×768`, `390×844`, `reducedMotion`), verify `G0`/`G1`/`G3` automated metrics & `M5-5` 5 breakpoints, run Tier-5 white-box adversarial Challenger loop until 0 gaps, whole-project Forensic Audit CLEAN, final `PROJECT.md` sync PR. | PR(s) (`v3/M7-e2e-verification-hardening`) | R2-M1..R2-M6 merged to `main` | PLANNED |

### Round 2 Interface Contracts (#6–#10)

### 6. Stateful PhaseView Contract (`src/v2/ui/screens/screenTypes.ts` ↔ `V2AppController.ts`)
- Upgrade existing `src/v2/ui/screens/*.ts` in-place (do NOT create parallel `src/v2/ui/phases/`).
- Interface: `export interface PhaseView<P, A> { mount(host: HTMLElement): void; update(props: P, actions: A): void; unmount(): void; }`.
- `V2AppController` tracks mounted phase views and invokes `mount()`/`unmount()` ONLY on phase/screen transitions; in-phase updates call `update()` preserving DOM identity, focus, selection, and animations.
- `CargoGridV2Component` stays mounted across in-phase updates (`setCallbacks()` + sub-container rendering); `syncPhaserStage()` deduplicates static/wreck stages via composite `playbackKey` so active VFX (e.g., wreck cuts) are never cleared on same-frame refreshes.

### 7. E2E Contract Compatibility & UX Harmonization (`src/v2/ui/` ↔ `tests/e2e/`)
- Preserve all `PROJECT.md § Interface Contracts #2` observability & `data-testid` anchors wherever compatible:
  - Unified Map (`S04`): each destination card keeps `[data-testid="map-node-<id>"]` and embeds its 1-click `[data-testid="btn-jump-node"]` (or activates jump cleanly).
  - Pre-combat (`S05`): `[data-testid="btn-start-combat"]` stays clickable for immediate engage; auto-engage 1.5s timer exposes `[data-testid="btn-pause-auto-combat"]` and cancels on pause/policy/gadget/details/unmount/read-only.
  - Threat Tiers (`S06`): Layer 1 shows qualitative tier (`稳/吃力/危险/致命`) + `↑↓` trend; preserve `data-preview-final-hp` attribute on combat forecast container and expose `[data-testid="btn-toggle-forecast-details"]` opening `[data-testid="forecast-details-drawer"]` with exact deterministic numbers labeled `"不干预时结果"`.
  - Any E2E tests in `tests/e2e/` asserting superseded pre-overhaul behaviors (e.g., old tutorial 15HP/3-layer layout, mandatory empty ARRANGE, unrestricted free safe return at non-beacon nodes, old 1-eq/1-cargo/1-repair combat reward) will be updated cleanly in `R2-M7` (and documented in `TEST_INFRA.md` / `TEST_READY.md`) once all code-fix PRs are merged to `main`.

### 8. WebAudio Bus & SFX Contract (`src/audio/soundEngine.ts`)
- Graph: `sfxBus` + `bgmBus` + `ambientBus` → `DynamicsCompressorNode` → `masterGain` → `ctx.destination` (graceful no-op if `AudioContext` unavailable/suspended).
- Distinct SFX kinds include: existing V2/V3 SFX + `pickup`, `hoverValid`, `placeHeavy`, `wreckCut`, `clampPop`, `craneServo`, `cashRegister`, `enemyFire`, plus wired `creditTick` and ±3–5% pitch randomization.

### 9. Rules Version `3.1.0` & Migration Contract (`R2-M6`)
- `V2_SCHEMA_VERSION` stays `3` (additive profile/run fields: `discoveredSynergies?: string[]`, `pendingFamilyUnlockChoices?: V2EquipmentFamily[]`, `lockedEnemyId?: string | null`, `interventions?: V2CombatIntervention[]`, `isBeacon?: boolean` on map nodes).
- Bump `V2_RULES_VERSION` from `'3.0.0'` to `'3.1.0'` in `R2-M6`; `loadV2Save()` MUST migrate `'3.0.0'` saves non-destructively (keeping backup and safely handling any in-flight `activeRun` without corrupting profile progress or `starline_save_v1`).

### 10. PR-to-`main` Gate Protocol (`R2-M1`–`R2-M7`)
- Because `GOD-OF-PPT/starline` has no GitHub Actions CI and `delete_branch_on_merge: false`, every PR MUST:
  1. Branch from synced `origin/main` (`v3/<task-or-milestone>-<short-desc>`).
  2. Use `<type>(<TaskID>): <description>` commits, staging explicit file paths ONLY (`git add -- <files>`).
  3. Pass local `npx tsc --noEmit && npm test && npm run build` (exit 0) in BOTH Worker AND independent Verification Wave (2 Reviewers + 2 Challengers + 1 Forensic Auditor).
  4. Merge ONLY AFTER `GATE_STATUS.md` records `PASS` (zero Auditor violations, all Reviewers APPROVE, all Challengers confirm), via `gh pr merge <num> --merge --delete-branch`, followed immediately by `git checkout main && git pull --ff-only origin main`.

