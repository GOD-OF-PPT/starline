# E2E Testing Infrastructure — 《星际拆解站：星门远征》 (`starline` V3)

> **Track**: Independent Opaque-Box Requirement-Driven E2E Testing Track (Dual Track)
> **Authority Sources**: `.agents/teamwork/ORIGINAL_REQUEST.md` (`"游戏主线不明确，玩法不完整；整个游戏比较像demo，请规划分析全方位完善游戏"`) & `PROJECT.md` (§ Feature Inventory `F01–F19`, § Interface Contracts `#1–#4`)
> **Browser Runtime**: Playwright (`@playwright/test`) + auto-detected Chromium (`CHROMIUM_PATH` → `/usr/bin/chromium` → `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome` → `/usr/bin/google-chrome-stable` → Playwright default `undefined`; detected on this VM: `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome`, `Google Chrome for Testing 159.0.8154.6`, headless WebGL via SwiftShader ANGLE)

---

## 1. Philosophy: Opaque-Box, Requirement-Driven & Independent

1. **Opaque-Box Testing Only**:
   - Every E2E test interacts with the game strictly through **user-observable external boundaries**: real browser DOM clicks/drags/keyboard inputs, URL query parameters (`?seed=<uint32>`, `?mode=v1`, `?mode=v2`), documented `localStorage` save fixtures strictly adhering to `PROJECT.md § Interface Contracts #1` (`starline_save_v2`, `starline_save_backup_v2`, `starline_active_tab_lock_v2`), and multi-tab browser contexts.
   - Telemetry assertions use **strictly read-only** `window.__STARLINE_INSPECT__()` snapshots and root DOM state attributes (`.app-shell.v2-shell` `data-screen`, `data-phase`, `data-act`, `data-sector`, plus `data-testid` anchors).
   - **FORBIDDEN**: Importing internal `src/` domain mutators into tests, invoking hidden window cheat methods, injecting fabricated victory states, or bypassing gameplay rules with tautological assertions.
2. **Requirement-Driven Feature Area Decomposition (Independent of Implementation Milestones)**:
   - Tests are organized by **10 User-Requirement Feature Areas (`A1–A10`)** derived from `ORIGINAL_REQUEST.md`, `PROJECT.md § Feature Inventory (F01–F18)`, and V2 design/polish acceptance specifications — **NOT** mirroring implementation milestones `M1–M6`.
3. **Progressive Testability**:
   - Every Tier 1 & Tier 2 test is tagged by progressive scope (`P0-Core`, `P1-Mid`, `P2-Late`).
   - `P0-Core` tests (boot, persistence, de-demo title, tutorial, core expedition/map/arrange/settlement, basic active tactical combat, basic shop/contracts, core cargo grid, desktop/mobile layout & BGM) depend **ONLY** on fresh or minimal Act I state and **NEVER** depend on Act II/III, multi-phase bosses, 4th flagship, endings, or Endless Abyss.
   - `P1-Mid` and `P2-Late` isolated Tier 1/Tier 2 tests seed schema-valid V3 `localStorage` saves via `tests/e2e/helpers/fixtures.ts` so late-game systems are tested thoroughly without re-playing 30 minutes of campaign prerequisites.
4. **Universal Zero-Error Baseline (Enforced Across Every Test)**:
   - `console.error` count === `0`
   - `pageerror` (uncaught exception) count === `0`
   - `window.__STARLINE_INSPECT__().failedAssets.length === 0` and zero HTTP `>= 400` asset responses.

---

## 2. Independent Feature Area Decomposition (`A1–A10`)

| Area | User-Requirement Feature Area | Mapped Features (`PROJECT.md`) | Progressive Scope |
|---|---|---|---|
| **A1** | Boot, Persistence, Save Migration & Mode Coexistence | F01, F02, F03, F04 | `P0-Core` |
| **A2** | Onboarding, Tutorial & Core Expedition Loop | F03, F04 | `P0-Core` |
| **A3** | Mainline 4-Act Campaign, 3 Star Sectors & Named Crew (`林工`/`陆衡`/`苏岚`) | F05, F06, F07 | `P1-Mid` / `P2-Late` |
| **A4** | Active Tactical Combat, 8+ Enemies & 3 Multi-Phase Act Bosses | F08, F09, F10 | `P0-Core` / `P1-Mid` / `P2-Late` |
| **A5** | True Dismantling Loop: Multi-Cut Derelicts & Salvage Parts Refining | F11 | `P1-Mid` |
| **A6** | 16+ Sector Event Deck, Merchants, 3 Factions & 5 Contract Types | F04, F12, F13 | `P0-Core` / `P1-Mid` |
| **A7** | Deepened Buildcraft: 16 Modules, 4 Gadgets, 4th Flagship & Power Cells | F14 | `P0-Core` / `P1-Mid` / `P2-Late` |
| **A8** | Station Upgrades (T1–T3), Stargate Relay, 4 Relic Passives, Codex & Diorama | F04, F15, F16 | `P1-Mid` / `P2-Late` |
| **A9** | Act III Climax, 3 Endings, Endless Abyss (`威压 1–10`) & Career Archive | F17, F18 | `P2-Late` |
| **A10** | Visual Ergonomics, Audio/BGM Telemetry & Responsive Layouts (`1366×768` & `390×844`) | F04 | `P0-Core` |

---

## 3. Runtime, Browser & TypeScript Configuration

### 3.1 Playwright Configuration (`playwright.config.ts`)
- **Test Discovery**: `testDir: './tests/e2e'`, `testMatch: /.*\.spec\.ts/`.
  - **Vitest Collision Guard**: `vite.config.ts` matches `tests/**/*.test.ts` for Vitest. Every E2E test MUST use `.spec.ts` (never `.test.ts`).
- **Auto-Detected Chromium & Golden Headless WebGL Flags**:
  - `resolveChromiumExecutablePath()` in `playwright.config.ts` checks disk existence (`existsSync`) in strict fallback priority order:
    1. `process.env.CHROMIUM_PATH` (trimmed; if unset, empty, or not present on disk, falls through safely)
    2. `/usr/bin/chromium`
    3. `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome` *(detected on this VM: `Google Chrome for Testing 159.0.8154.6`)*
    4. `/usr/bin/google-chrome-stable` *(also present on this VM as next fallback: `Google Chrome 158.0.8127.36`)*
    5. `undefined` (Playwright built-in default resolution)
  - Empirically verified flags for Chromium + Phaser 3.90 WebGL (`Phaser.AUTO` + `.setTint()`/`.setTintFill()`) with zero Skia/mailbox/sandbox errors:
    ```ts
    [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--mute-audio',
    ]
    ```
- **Isolated Web Server (Port `4179`)**:
  - Default (live dev during M1–M6): `npx vite --host 127.0.0.1 --port 4179 --strictPort`
  - Production bundle gate (`E2E_USE_PREVIEW=1` for M7): `npx vite preview --host 127.0.0.1 --port 4179 --strictPort`
- **Projects / Viewports**:
  - `desktop` (`1366×768`, `deviceScaleFactor: 1`, `hasTouch: false`, `grepInvert: /@mobile-only/`) — default project
  - `mobile` (`390×844`, `deviceScaleFactor: 2`, `hasTouch: true`, `isMobile: true`, `grep: /@mobile-only/`) — disjoint responsive project (zero duplicate execution across projects)
- **Strict Timeouts, Concurrency & Failure Diagnostics**:
  - `workers: 1` (single-worker deterministic SwiftShader WebGL execution), `timeout: 90_000` (per test), `expect.timeout: 10_000`, `actionTimeout: 15_000`, `navigationTimeout: 30_000`.
  - Failure artifacts: `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`, `video: 'off'`, output under `test-results/e2e`.

### 3.2 Strict `tsconfig.json` Compliance
- Because `tsconfig.json` includes `["src", "tests"]` with `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`, `isolatedModules: true`, `moduleDetection: "force"`, and `lib: ["ES2022", "DOM", "DOM.Iterable"]`:
  - All files under `tests/e2e/**` MUST compile cleanly under `npx tsc --noEmit`.
  - Use extensionless relative imports (`../helpers/...`) and `import type` for type-only imports.
  - Keep `process.env` reads exclusively inside `playwright.config.ts` (never rely on undeclared Node globals inside `tests/e2e/**`).

---

## 4. Opaque-Box Contracts & Fixture Rules

### 4.1 Browser Storage Keys
- `localStorage['starline_save_v2']`: Primary V2/V3 save JSON (`schemaVersion: 2 | 3`)
- `localStorage['starline_save_backup_v2']`: Rolling last-known-good backup & V2→V3 migration backup
- `localStorage['starline_active_tab_lock_v2']`: Multi-tab lock lease (`{ tabId, updatedAt }`, TTL 6000ms)
- `localStorage['starline_save_v1']` / `starline_save_backup_v1`: Legacy V1 saves (untouched by V2/V3)
- `sessionStorage['starline_active_mode']`: Sticky `'v1' | 'v2'` mode memory (tests navigating back from `?mode=v1` explicitly pass `?mode=v2` or use a fresh context)
- `sessionStorage['starline_v2_title_entered']`: `'1'` suppresses Title Screen in same tab

### 4.2 Strict Save Fixture Invariants (`tests/e2e/helpers/fixtures.ts`)
Every V2 (`schemaVersion: 2`, `rulesVersion: '2.0.0'`) and V3 (`schemaVersion: 3`, `rulesVersion: '3.0.0'`) fixture builder enforces:
1. All required `V2ProfileState` arrays & records (`unlockedShips` non-empty, unique `blueprints`, `equipmentWarehouse.length <= 12` with NO `loan`/`mission` origins, `pendingGiftQueue`, `loadoutPresets`, `settledRunIds`, all 6 `buildings`, all 4 `relics`, plus all V3 fields: `salvageParts`, `facilityTiers` incl. `stargate_relay`, `campaign`, `factionRep`, `crewMastery`, `achievementsUnlocked`, `defeatedEnemyKinds`, `runHistory` max 30, `career`).
2. Synced `activeRun.schemaVersion` & `activeRun.rulesVersion` matching root save; all 5 `rngStreams` (`map`, `enemies`, `shop`, `events`, `rewards`).
3. Valid `V2CargoBayState`: unique `instanceId`s across `placed` + `staging`; `origin === 'loan' | 'mission'` ⇒ `fixedValue: 0`; `mission.*` defIds ⇔ `origin: 'mission'`; zero out-of-bounds or overlapping placements; zero placements on disabled bulkhead cells (`heavy_freighter`: `(4,0)`, `(0,3)`).
4. Valid phase invariants: `REWARD` ⇒ non-null `pendingReward`; `SETTLEMENT` ⇒ `settlementReason` in `'safe_return' | 'defeat'`; `currentNodeId` exists in `graph.nodes`.

### 4.3 Stable `data-testid` & Telemetry Surface
All helpers target the contracted surface in `PROJECT.md § Interface Contracts #2`:
- Root `.app-shell.v2-shell`: `data-screen`, `data-phase`, `data-act`, `data-sector`
- Read-only telemetry: `window.__STARLINE_INSPECT__()` (`StarlineInspectSnapshot`)
- Contracted `data-testid` selectors for Title, Base, Prepare, Map, Combat, Wreck, Event, Shop, Reward, Arrange, Settlement, Ending, and `.cargo-cell[data-cx][data-cy]` (`data-power-cell="true"`).
- Where secondary sub-controls inside modals (e.g. facility upgrade buttons, dismantle toggles, faction tabs, endless threat selector) do not have dedicated entries in `PROJECT.md § Interface Contracts #2`, helpers use semantic accessible roles/labels combined with resilient `data-testid` / `data-*` locators so tests remain opaque-box and implementation-decoupled.

---

## 5. 4-Tier Suite Layout & Coverage Inventory

```
playwright.config.ts
tests/e2e/
├── helpers/
│   ├── contracts.ts        # Read-only StarlineInspectSnapshot & contracted selectors/constants
│   ├── fixtures.ts         # Schema-valid V2 & V3 localStorage save & activeRun fixture builders
│   ├── appDriver.ts        # Opaque-box Playwright driver (boot ?seed=, wait helpers, UI navigation)
│   ├── assertions.ts       # Zero-error monitors, layout/overflow/CTA-above-fold & telemetry checks
│   └── index.ts            # Barrel export
├── tier1/                  # Tier 1: Isolated Feature Coverage (10 files, 55 tests — >=5 per area)
│   ├── a1-boot-persistence.spec.ts
│   ├── a2-tutorial-core-loop.spec.ts
│   ├── a3-campaign-sectors-crew.spec.ts
│   ├── a4-combat-tactical-bosses.spec.ts
│   ├── a5-dismantle-wreck.spec.ts
│   ├── a6-events-factions-contracts.spec.ts
│   ├── a7-buildcraft-gadgets-flagship.spec.ts
│   ├── a8-station-relics-diorama.spec.ts
│   ├── a9-endgame-endless-career.spec.ts
│   └── a10-ui-audio-responsive.spec.ts
├── tier2/                  # Tier 2: Boundary, Corner & Negative Cases (10 files, 54 tests — >=5 per area)
│   ├── a1-persistence-boundaries.spec.ts
│   ├── a2-core-loop-boundaries.spec.ts
│   ├── a3-campaign-sector-boundaries.spec.ts
│   ├── a4-combat-boundaries.spec.ts
│   ├── a5-dismantle-boundaries.spec.ts
│   ├── a6-events-shop-boundaries.spec.ts
│   ├── a7-buildcraft-boundaries.spec.ts
│   ├── a8-station-codex-boundaries.spec.ts
│   ├── a9-endgame-boundaries.spec.ts
│   └── a10-layout-input-boundaries.spec.ts
├── tier3/                  # Tier 3: Pairwise Cross-Feature Combinations (5 files, 18 tests)
│   ├── p1-sector-tactical-boss.spec.ts
│   ├── p2-crew-wreck-cargo.spec.ts
│   ├── p3-faction-contracts-endings.spec.ts
│   ├── p4-relics-powercells-flagship.spec.ts
│   └── p5-endless-seed-career.spec.ts
└── tier4/                  # Tier 4: Real-World End-to-End Scenarios (8 files, 8 tests)
    ├── j1-full-campaign-to-endless.spec.ts
    ├── j2-desktop-full-loop-1366x768.spec.ts
    ├── j3-mobile-full-loop-390x844.spec.ts
    ├── j4-v1-coexistence.spec.ts
    ├── j5-reload-continuity.spec.ts
    ├── j6-bankruptcy-defeat-comeback.spec.ts
    ├── j7-showcase-drawer-isolation.spec.ts
    └── j8-multi-ending-career-persistence.spec.ts
```

**Total Authored Suite**: **33 spec files / 135 opaque-box E2E tests** (Tier 1: 55, Tier 2: 54, Tier 3: 18, Tier 4: 8), achieving 100% traceability across `F01–F18`.

---

## 6. Execution Commands

| Scope | Command |
|---|---|
| List & validate all E2E specs (no browser launch) | `npx playwright test --list` |
| Typecheck all E2E helpers & specs | `npx tsc --noEmit` |
| **Tier 1** — Isolated Feature Coverage | `npx playwright test tests/e2e/tier1` |
| **Tier 1 (`P0-Core` progressive subset)** | `npx playwright test tests/e2e/tier1 --grep "@p0-core"` |
| **Tier 2** — Boundary, Corner & Negative Cases | `npx playwright test tests/e2e/tier2` |
| **Tier 3** — Pairwise Cross-Feature Combinations | `npx playwright test tests/e2e/tier3` |
| **Tier 4** — Real-World Full-Campaign & Responsive Journeys | `npx playwright test tests/e2e/tier4` |
| **Full Suite** (dev server, port 4179) | `npm run test:e2e` (alias for `npx playwright test`) |
| **Full Suite** (production `dist/` bundle via `vite preview`) | `E2E_USE_PREVIEW=1 npx playwright test` |

> **Dual-Track Note**: During parallel M1–M6 development, specs targeting unimplemented M2–M6 features are expected to fail on feature assertions until those milestones land; the E2E harness, fixtures, TypeScript types, Chromium WebGL boot, and `P0-Core` baseline contracts are independently verified prior to publishing `TEST_READY.md`, and 100% of Tiers 1–4 are driven to green sequentially in Final Milestone M7.
