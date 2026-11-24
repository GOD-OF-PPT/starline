# Project: 《星际拆解站：星门远征》 (`starline` V3 Full-Game Upgrade)

> **User Request**: `"游戏主线不明确，玩法不完整；整个游戏比较像demo，请规划分析全方位完善游戏"` (`.agents/teamwork/ORIGINAL_REQUEST.md`)
> **Baseline**: `main@084e781` (TypeScript 5.8 + Vite 6 + Phaser 3.90 + Vitest 3.2; 35,107 LOC across 62 files; 56 hand-painted WebP assets; V2 vertical slice + V1 `?mode=v1` preserved).

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
| M7 | Final Milestone: E2E Tiers 1–4 Pass & Tier 5 Adversarial Hardening | F19 — Phase 0: complete M3–M6 Vitest + balance sim; Phase 1: pass 100% of E2E Tiers 1–4 sequentially (dev + `E2E_USE_PREVIEW=1`); Phase 2: white-box adversarial Tier-5 Challenger loop until zero remaining gaps; final whole-project Forensic Audit CLEAN. | M6, E2E (`TEST_READY.md`) | IN_PROGRESS (Phase 0 DONE 116/116 Vitest; Phase 1a–1c E2E DONE 135/135 PASS [T1:55, T2:54, T3:18, T4:8]; Phase 1d `E2E_USE_PREVIEW=1` next) |

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
