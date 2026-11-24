# E2E Test Suite Ready

> **Project**: 《星际拆解站：星门远征》 (`starline` V3 Full-Game Upgrade)
> **Track**: Independent Opaque-Box Requirement-Driven E2E Testing Track
> **Architecture Spec**: `TEST_INFRA.md` | **Authority**: `.agents/teamwork/ORIGINAL_REQUEST.md` & `PROJECT.md`

---

## Test Runner

- **Primary Full-Suite Command**: `npm run test:e2e` *(verified in `package.json`: `"test:e2e": "playwright test"`)*
- **Expected Exit Code at Final Milestone M7**: `0` (all 135 opaque-box tests passing across `desktop` and `mobile`, with zero `console.error`, zero `pageerror`, and zero `failedAssets`)
- **Isolated Web Server (Port `4179`)**:
  - Default (live Vite dev server): `npx vite --host 127.0.0.1 --port 4179 --strictPort`
  - Production bundle gate (`dist/`): `E2E_USE_PREVIEW=1 npm run test:e2e` (runs `npx vite preview --host 127.0.0.1 --port 4179 --strictPort`)
- **Chromium Binary Auto-Detection (`playwright.config.ts`)**:
  - `resolveChromiumExecutablePath()` checks disk existence (`existsSync` from `node:fs`) in strict fallback priority order so `npm run test:e2e` runs out-of-the-box without setting any environment variable:
    1. `process.env.CHROMIUM_PATH` *(trimmed; if unset, empty, or not present on disk, gracefully falls through)*
    2. `/usr/bin/chromium`
    3. `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome` *(detected on this VM: `Google Chrome for Testing 159.0.8154.6`)*
    4. `/usr/bin/google-chrome-stable` *(also present on this VM as next fallback: `Google Chrome 158.0.8127.36`)*
    5. `undefined` *(Playwright built-in default resolution)*
  - Golden headless WebGL launch flags (`--use-gl=angle`, `--use-angle=swiftshader`, `--enable-webgl`, `--enable-unsafe-swiftshader`, `--ignore-gpu-blocklist`, `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--mute-audio`) are preserved intact for Phaser 3.90 WebGL rendering.

### Tier & Scope Commands

| Scope | Command |
|---|---|
| List & validate all specs (no browser launch) | `npx playwright test --list` or `npm run test:e2e -- --list` |
| Typecheck all `src/` & `tests/e2e/` | `npx tsc --noEmit` |
| **Tier 1** — Isolated Feature Coverage | `npx playwright test tests/e2e/tier1` |
| **Tier 1 (`@p0-core` progressive subset)** | `npx playwright test tests/e2e/tier1 --grep "@p0-core"` |
| **Tier 2** — Boundary, Corner & Negative Cases | `npx playwright test tests/e2e/tier2` |
| **Tier 3** — Pairwise Cross-Feature Combinations | `npx playwright test tests/e2e/tier3` |
| **Tier 4** — Real-World End-to-End Scenarios | `npx playwright test tests/e2e/tier4` |
| **Full Suite (Dev Server, Port 4179)** | `npm run test:e2e` |
| **Full Suite (Production Preview, Port 4179)** | `E2E_USE_PREVIEW=1 npm run test:e2e` |

---

## Coverage Summary

Verified verbatim via `env -u CHROMIUM_PATH npx playwright test --list` and `env -u CHROMIUM_PATH npm run test:e2e -- --list` for **N = 10** independent user-requirement feature areas (`A1–A10`):

| Tier | Category | Spec Files | Test Count | Desktop (`1366×768`) | Mobile (`390×844`, `@mobile-only`) | Required Threshold (`N = 10`) | Status |
|---|---|---:|---:|---:|---:|---|---|
| **Tier 1** | Isolated Feature Coverage | 10 | 55 | 54 | 1 | `>= 5 * N = 50` (`>= 5` per area) | PASS (`55 >= 50`) |
| **Tier 2** | Boundary, Corner & Negative Cases | 10 | 54 | 53 | 1 | `>= 5 * N = 50` (`>= 5` per area) | PASS (`54 >= 50`) |
| **Tier 3** | Pairwise Cross-Feature Combinations | 5 | 18 | 18 | 0 | `>= N = 10` | PASS (`18 >= 10`) |
| **Tier 4** | Real-World End-to-End Scenarios | 8 | 8 | 7 | 1 | `>= max(5, N / 2) = 5` | PASS (`8 >= 5`) |
| **Total** | **Full Opaque-Box E2E Suite** | **33** | **135** | **132** | **3** | **Disjoint Projects (Zero Duplicate Runs)** | **READY** |

- **Disjoint Project Partitioning**:
  - `desktop` (`1366×768`, `grepInvert: /@mobile-only/`): **132 tests**
  - `mobile` (`390×844`, `hasTouch: true`, `isMobile: true`, `grep: /@mobile-only/`): **3 tests** (`T1-A10-04`, `T2-A10-01`, `T4-03`)
  - Sum: `132 + 3 = 135 tests` across `33 spec files` (zero overlap).
- **Tier 1 `@p0-core` Progressive Subset**: **19 tests** (`a1`: 5, `a2`: 6, `a4`: 1, `a6`: 1, `a7`: 1, `a10`: 5 incl. 1 mobile).

---

## Feature Checklist

### Feature Area Traceability (`A1–A10` → Tiers 1–4)

| Area | Feature Area | Mapped `PROJECT.md` Features | Tier 1 Spec (Tests) | Tier 2 Spec (Tests) | Tier 3 Pairwise Specs | Tier 4 Scenario Specs |
|---|---|---|---|---|---|---|
| **A1** | Boot, Persistence, Save Migration & Mode Coexistence | F01, F02, F03, F04 | `tier1/a1-boot-persistence.spec.ts` (5) | `tier2/a1-persistence-boundaries.spec.ts` (6) | `p5-endless-seed-career.spec.ts` | `j4-v1-coexistence.spec.ts`, `j5-reload-continuity.spec.ts`, `j7-showcase-drawer-isolation.spec.ts` |
| **A2** | Onboarding, Tutorial & Core Expedition Loop | F03, F04 | `tier1/a2-tutorial-core-loop.spec.ts` (6) | `tier2/a2-core-loop-boundaries.spec.ts` (6) | `p2-crew-wreck-cargo.spec.ts` | `j1-full-campaign-to-endless.spec.ts`, `j2-desktop-full-loop-1366x768.spec.ts`, `j3-mobile-full-loop-390x844.spec.ts`, `j6-bankruptcy-defeat-comeback.spec.ts` |
| **A3** | Mainline 4-Act Campaign, 3 Star Sectors & Named Crew | F05, F06, F07 | `tier1/a3-campaign-sectors-crew.spec.ts` (6) | `tier2/a3-campaign-sector-boundaries.spec.ts` (5) | `p1-sector-tactical-boss.spec.ts`, `p2-crew-wreck-cargo.spec.ts` | `j1-full-campaign-to-endless.spec.ts` |
| **A4** | Active Tactical Combat, 8+ Enemies & 3 Multi-Phase Bosses | F08, F09, F10 | `tier1/a4-combat-tactical-bosses.spec.ts` (6) | `tier2/a4-combat-boundaries.spec.ts` (6) | `p1-sector-tactical-boss.spec.ts` (4), `p4-relics-powercells-flagship.spec.ts` | `j1-full-campaign-to-endless.spec.ts`, `j2-desktop-full-loop-1366x768.spec.ts`, `j5-reload-continuity.spec.ts` |
| **A5** | True Dismantling Loop: Multi-Cut Derelicts & Scrap Refining | F11 | `tier1/a5-dismantle-wreck.spec.ts` (5) | `tier2/a5-dismantle-boundaries.spec.ts` (5) | `p2-crew-wreck-cargo.spec.ts` (4), `p3-faction-contracts-endings.spec.ts` | `j2-desktop-full-loop-1366x768.spec.ts`, `j3-mobile-full-loop-390x844.spec.ts`, `j5-reload-continuity.spec.ts` |
| **A6** | 16+ Sector Event Deck, Merchants, 3 Factions & 5 Contracts | F04, F12, F13 | `tier1/a6-events-factions-contracts.spec.ts` (6) | `tier2/a6-events-shop-boundaries.spec.ts` (5) | `p3-faction-contracts-endings.spec.ts` (4) | `j2-desktop-full-loop-1366x768.spec.ts`, `j3-mobile-full-loop-390x844.spec.ts`, `j5-reload-continuity.spec.ts`, `j6-bankruptcy-defeat-comeback.spec.ts` |
| **A7** | Deepened Buildcraft: 16 Modules, 4 Gadgets, 4th Flagship & Power Cells | F14 | `tier1/a7-buildcraft-gadgets-flagship.spec.ts` (6) | `tier2/a7-buildcraft-boundaries.spec.ts` (5) | `p2-crew-wreck-cargo.spec.ts`, `p4-relics-powercells-flagship.spec.ts` (4) | `j2-desktop-full-loop-1366x768.spec.ts`, `j3-mobile-full-loop-390x844.spec.ts`, `j7-showcase-drawer-isolation.spec.ts` |
| **A8** | Station Upgrades (T1–T3), Stargate Relay, 4 Relics, Codex & Diorama | F04, F15, F16 | `tier1/a8-station-relics-diorama.spec.ts` (5) | `tier2/a8-station-codex-boundaries.spec.ts` (5) | `p3-faction-contracts-endings.spec.ts`, `p4-relics-powercells-flagship.spec.ts` | `j1-full-campaign-to-endless.spec.ts`, `j2-desktop-full-loop-1366x768.spec.ts`, `j4-v1-coexistence.spec.ts`, `j6-bankruptcy-defeat-comeback.spec.ts` |
| **A9** | Act III Climax, 3 Endings, Endless Abyss & Career Archive | F17, F18 | `tier1/a9-endgame-endless-career.spec.ts` (5) | `tier2/a9-endgame-boundaries.spec.ts` (5) | `p3-faction-contracts-endings.spec.ts`, `p5-endless-seed-career.spec.ts` (2) | `j1-full-campaign-to-endless.spec.ts`, `j8-multi-ending-career-persistence.spec.ts` |
| **A10** | Visual Ergonomics, Audio/BGM Telemetry & Responsive Layouts | F04 | `tier1/a10-ui-audio-responsive.spec.ts` (5) | `tier2/a10-layout-input-boundaries.spec.ts` (6) | `p2-crew-wreck-cargo.spec.ts` | `j2-desktop-full-loop-1366x768.spec.ts`, `j3-mobile-full-loop-390x844.spec.ts` |

### Complete `PROJECT.md` Feature Inventory Matrix (`F01–F18`)

| Feature | Summary | Area(s) | Tier 1 Coverage | Tier 2 Coverage | Tier 3 Coverage | Tier 4 Coverage |
|---|---|---|---|---|---|---|
| **F01** | Repo Hygiene & Tooling Baseline (Playwright + Vitest non-collision) | A1 | `a1-boot-persistence` (`T1-A1-01..02`) | `a1-persistence-boundaries` | — | `j4-v1-coexistence` |
| **F02** | Save Schema V3 & Non-Destructive V2→V3 Migration | A1 | `a1-boot-persistence` (`T1-A1-01..02`) | `a1-persistence-boundaries` (`T2-A1-01..05`) | — | `j4-v1-coexistence`, `j5-reload-continuity` |
| **F03** | Modular Screen/CSS Split & E2E Testability Contracts (`?seed=`, `window.__STARLINE_INSPECT__`, `data-testid`) | A1, A2 | `a1-boot-persistence` (`T1-A1-03,05`), `a2-tutorial-core-loop` | `a1-persistence-boundaries` (`T2-A1-06`), `a2-core-loop-boundaries` | `p5-endless-seed-career` | `j1`, `j2`, `j3`, `j5` |
| **F04** | V2 Bug Remediation & De-Demo Presentation (BGM tracks, Codex 100%/Seen, Engineer Swap in SHOP, anti-repeat, 1366×768 fold, DAG edges) | A1, A2, A6, A8, A10 | `a1` (`T1-A1-01,04`), `a6` (`T1-A6-03`), `a8` (`T1-A8-04`), `a10` (`T1-A10-01..05`) | `a3` (`T2-A3-02`), `a4` (`T2-A4-06`), `a8` (`T2-A8-01`), `a10` (`T2-A10-01..06`) | `p2-crew-wreck-cargo` | `j2`, `j3`, `j7` |
| **F05** | 4-Act Main Campaign (`星门重启计划`), Quest Tracker & Pity Relics | A3 | `a3-campaign-sectors-crew` (`T1-A3-01,06`) | `a3-campaign-sector-boundaries` (`T2-A3-04..05`) | `p1`, `p3` | `j1-full-campaign-to-endless` |
| **F06** | 3 Distinct Star Sectors & Environmental Modifiers | A3 | `a3-campaign-sectors-crew` (`T1-A3-02..03`) | `a3-campaign-sector-boundaries` (`T2-A3-01`) | `p1-sector-tactical-boss` (`T3-P1-01..04`) | `j1-full-campaign-to-endless` |
| **F07** | Named Crew Roster (`林工`/`陆衡`/`苏岚`), SVG Portraits, Comms & Mastery | A3 | `a3-campaign-sectors-crew` (`T1-A3-04..05`) | `a3-campaign-sector-boundaries` (`T2-A3-03`) | `p2-crew-wreck-cargo` (`T3-P2-01..03`) | `j1`, `j2` |
| **F08** | Active Tactical Command System (Default-ON) & Pure-Auto Toggle | A4 | `a4-combat-tactical-bosses` (`T1-A4-01..03`) | `a4-combat-boundaries` (`T2-A4-01..03`) | `p1-sector-tactical-boss` (`T3-P1-01..04`), `p4` (`T3-P4-04`) | `j1`, `j5` |
| **F09** | Expanded Enemy Roster (8+ Regular) & Telegraphed Intents | A4 | `a4-combat-tactical-bosses` (`T1-A4-04`) | `a4-combat-boundaries` (`T2-A4-04..05`) | `p1-sector-tactical-boss` | `j2`, `j3` |
| **F10** | 3 Multi-Phase Act Bosses (`铁砧号`, `铁壁无畏`, `黑曜利维坦`) | A4 | `a4-combat-tactical-bosses` (`T1-A4-05..06`) | `a4-combat-boundaries` (`T2-A4-01..03`) | `p1-sector-tactical-boss` (`T3-P1-01..04`), `p4` (`T3-P4-04`) | `j1-full-campaign-to-endless` |
| **F11** | True "Dismantling (拆解)" Loop: Multi-Cut Derelicts & Salvage Parts Refining | A5 | `a5-dismantle-wreck` (`T1-A5-01..05`) | `a5-dismantle-boundaries` (`T2-A5-01..05`) | `p2-crew-wreck-cargo` (`T3-P2-01..04`), `p3` (`T3-P3-02`) | `j2`, `j3`, `j5` |
| **F12** | 16+ Narrative & Tactical Sector Event Deck | A6 | `a6-events-factions-contracts` (`T1-A6-01..02`) | `a6-events-shop-boundaries` (`T2-A6-01`) | `p2-crew-wreck-cargo` | `j2`, `j3`, `j5` |
| **F13** | 3 Orbital Factions, Reputation & Expanded Contracts (5 Types + Bonus Goals) | A6 | `a6-events-factions-contracts` (`T1-A6-04..06`) | `a6-events-shop-boundaries` (`T2-A6-05`) | `p3-faction-contracts-endings` (`T3-P3-01..04`) | `j2`, `j6` |
| **F14** | Deepened Buildcraft: 6 New Modules (16 Total), 4 Gadgets, 4th Flagship & Power Cells | A7 | `a7-buildcraft-gadgets-flagship` (`T1-A7-01..06`) | `a7-buildcraft-boundaries` (`T2-A7-01..05`) | `p4-relics-powercells-flagship` (`T3-P4-01..04`) | `j1`, `j2`, `j3`, `j7` |
| **F15** | Station Departments (T1–T3), Stargate Relay, 4 Relic Passives & Holodeck Reconciliation | A8, A7 | `a8-station-relics-diorama` (`T1-A8-01..03`), `a7` (`T1-A7-06`) | `a8-station-codex-boundaries` (`T2-A8-02..05`), `a7` (`T2-A7-04`) | `p3` (`T3-P3-03`), `p4` (`T3-P4-01..04`) | `j1`, `j2`, `j6`, `j7` |
| **F16** | Full V2 `BaseScene.ts` Orbital Station Diorama Parity | A8 | `a8-station-relics-diorama` (`T1-A8-05`) | `a10-layout-input-boundaries` (`T2-A10-05`) | — | `j4-v1-coexistence` |
| **F17** | Act III Climax Mission, 3 Campaign Endings & Victory Ceremony | A9 | `a9-endgame-endless-career` (`T1-A9-01..02`), `a4` (`T1-A4-06`) | `a9-endgame-boundaries` (`T2-A9-04`), `a3` (`T2-A3-04`) | `p3-faction-contracts-endings` (`T3-P3-03..04`) | `j1-full-campaign-to-endless`, `j8-multi-ending-career-persistence` |
| **F18** | Endless Abyss (`威压 1–10`), Career Ledger, Bestiary, Lore & 18 Achievements | A9 | `a9-endgame-endless-career` (`T1-A9-03..05`) | `a9-endgame-boundaries` (`T2-A9-01..03,05`) | `p5-endless-seed-career` (`T3-P5-01..02`) | `j1-full-campaign-to-endless`, `j8-multi-ending-career-persistence` |

---

## Wave 1 Verification & M7 Execution Schedule

### Static, Harness & Runtime Verification (Post-Final-Edit, Non-Browser)
1. **TypeScript Compilation**: `npx tsc --noEmit` — **PASS** (exit code `0`, 0 errors across `src/` and all 33 specs + helpers in `tests/e2e/`).
2. **Playwright Discovery & Suite Integrity**:
   - `env -u CHROMIUM_PATH npx playwright test --list` — **PASS** (`Total: 135 tests in 33 files`; `desktop`: 132, `mobile`: 3; Tier 1: 55/10, Tier 2: 54/10, Tier 3: 18/5, Tier 4: 8/8).
   - `env -u CHROMIUM_PATH npm run test:e2e -- --list` — **PASS** (matches verbatim; `package.json` already defines `"test:e2e": "playwright test"`).
3. **Chromium Binary Auto-Detection on This VM**:
   - `resolveChromiumExecutablePath()` verified across all 5 priority branches (valid `CHROMIUM_PATH`, trimmed env, non-existent `CHROMIUM_PATH` safe fallthrough, `/usr/bin/chromium`, `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome`, `/usr/bin/google-chrome-stable`, and `undefined`).
   - Detected on this VM with `CHROMIUM_PATH` unset: `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome` (`Google Chrome for Testing 159.0.8154.6`, executable verified on disk; `/usr/bin/google-chrome-stable` `158.0.8127.36` also present as secondary fallback).
4. **Schema & Contract Parity Audit**:
   - Verified `tests/e2e/helpers/contracts.ts` and `tests/e2e/helpers/fixtures.ts` against `PROJECT.md § Interface Contracts #1/#2`, `TEST_INFRA.md §4.2`, `src/v2/domain/types.ts`, `src/v2/domain/persistenceV2.ts`, and `src/v2/ui/inspectSnapshot.ts` — exact field parity on V3 save schema, backup keys, and `window.__STARLINE_INSPECT__()`.

### Prior Partial Browser Observations (Captured Before User Follow-Up Directive)
Before the user's `2026-11-23T02:52:55Z` directive suspending browser smoke tests during Waves 1–5, partial headless WebGL runs using auto-detected Chromium (`env -u CHROMIUM_PATH`) confirmed:
- **17/19 Tier 1 `@p0-core` tests verified passing** with zero `console.error`, zero `pageerror`, and zero `failedAssets`:
  - `a1-boot-persistence.spec.ts`: **5/5 PASS** (`T1-A1-01..05`)
  - `a2-tutorial-core-loop.spec.ts`: **6/6 PASS** (`T1-A2-03..06` passed initially; `T1-A2-01` & `T1-A2-02` passed after fixing SwiftShader 1× live combat wait timeout and `.cargo-cell` grid-click targeting + bay slot layout in the spec)
  - `a6-events-factions-contracts.spec.ts` (`@p0-core`): **1/1 PASS** (`T1-A6-03`, incl. Engineer Swap inside SHOP)
  - `a10-ui-audio-responsive.spec.ts`: **5/5 PASS** (`T1-A10-01..05`, including mobile `390×844` `@mobile-only`)
- **2 remaining Tier 1 `@p0-core` tests** (`T1-A4-02`, `T1-A7-01`) initially hit the same two test-side issues (20s SwiftShader 1× live combat timeout on `T1-A4-02`; pointer-intercepted `.placed-item` click on `T1-A7-01`), received the identical clean spec-only fixes (no assertion weakening), and their browser re-run was cancelled immediately upon receiving the user's follow-up directive. Zero M1 `src/` defects were detected.

### M2–M6 Policy & Final Milestone M7 Schedule
- Per user follow-up directive (`ORIGINAL_REQUEST.md` Follow-up `2026-11-23T02:52:55Z`: `"当下后续都不需要做冒烟测试"`):
  - **Wave 1 closure & Milestones M2–M6**: Browser E2E smoke runs are intentionally skipped; feature milestones validate via Vitest (`npm run test`), TypeScript (`npx tsc --noEmit`), production bundle (`npm run build`), and code review/audit gates.
  - **Final Milestone M7**: Full browser E2E execution runs sequentially across **Tier 1 → Tier 2 → Tier 3 → Tier 4** (both dev server and `E2E_USE_PREVIEW=1` production bundle on port `4179`), followed by **Tier 5** white-box adversarial coverage hardening until 100% pass and whole-project audit CLEAN.
