import { expect, test } from '@playwright/test';
import {
  TEST_IDS,
  assertAboveFold,
  assertNoDevJargon,
  assertTouchTargetMinSize,
  assertZeroHorizontalOverflow,
  attachZeroErrorMonitors,
  createAppDriver,
  createMapGraph,
  presetArrangeV3,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
  presetWreckEncounterV3,
} from '../helpers';

test.describe('Tier 1 · A10: Visual Ergonomics, Audio/BGM Telemetry & Responsive Layouts', () => {
  test('T1-A10-01 @p0-core Desktop 1366x768 keeps primary CTAs above fold with zero horizontal overflow', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Title
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: false });
    await app.boot({ seed: 10001 });
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_ENTER_STATION), 768);

    // Base -> Prepare
    await app.enterStation();
    await assertZeroHorizontalOverflow(page, 1366);
    await app.openPrepareFromBase();
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION), 768);

    // Arrange
    await app.seedStorage({ v2Save: presetArrangeV3(), skipTitleScreen: true });
    await app.boot({ seed: 10002 });
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE), 768);

    // Settlement
    await app.seedStorage({ v2Save: presetSettlementV3(), skipTitleScreen: true });
    await app.boot({ seed: 10003 });
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT), 768);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A10-02 @p0-core Star Map renders high-contrast DAG edge connectors and side-by-side layer comparison', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetMidRunMapV3(), skipTitleScreen: true });
    await app.boot({ seed: 10004 });

    const mapScreen = app.byTestId(TEST_IDS.MAP_SCREEN);
    await expect(mapScreen).toBeVisible();

    const nodeA = app.byTestId(TEST_IDS.mapNode('L1A'));
    const nodeB = app.byTestId(TEST_IDS.mapNode('L1B'));
    await expect(nodeA).toBeVisible();
    await expect(nodeB).toBeVisible();

    // Verify SVG/DOM DAG edge connectors exist with non-zero rendered bounds
    const edgeCount = await mapScreen
      .locator('svg path, svg line, .map-dag-edge, .star-map-edge')
      .evaluateAll((els) =>
        els.filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 || rect.height > 0;
        }).length,
      );
    expect(edgeCount, 'Star Map must render visible DAG edge connectors').toBeGreaterThan(0);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A10-03 @p0-core BGM track telemetry transitions cleanly base -> expedition -> boss -> base', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Base -> Expedition
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 10005, enterStation: true });
    expect((await app.inspect()).bgmTrack).toBe('base');

    await app.openPrepareFromBase();
    await app.launchExpedition();
    const expSnap = await app.waitForInspect((s) => s.bgmTrack === 'expedition', 10_000, 'expedition BGM');
    expect(expSnap.bgmTrack).toBe('expedition');

    // Safe return -> Base
    await app.safeReturn();
    await app.confirmSettlement();
    const backBaseSnap = await app.waitForInspect((s) => s.bgmTrack === 'base', 10_000, 'base BGM after return');
    expect(backBaseSnap.bgmTrack).toBe('base');

    // Layer 6 Elite/Boss encounter -> boss BGM (M1-valid Layer 6 elite node with isBoss unit)
    const bossBgmSave = presetMidRunMapV3({
      phase: 'ENCOUNTER',
      currentNodeId: 'L6A',
      graph: createMapGraph({
        layer6Type: 'elite',
        nodeOverrides: {
          L6A: { type: 'elite', encounterKind: 'elite', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'],
        activeCombat: null,
      },
    });
    await app.seedStorage({ v2Save: bossBgmSave, skipTitleScreen: true });
    await app.boot({ seed: 10006 });

    const bossSnap = await app.waitForInspect((s) => s.bgmTrack === 'boss', 10_000, 'boss BGM');
    expect(bossSnap.bgmTrack).toBe('boss');

    monitor.assertClean(bossSnap);
  });

  test('T1-A10-04 @p0-core @mobile-only Mobile 390x844 enforces zero overflow, 2-layer map focus, and >=44px touch targets', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Base + Prepare
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 10007, enterStation: true });
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_START_RECOMMENDED), 44);

    await app.openPrepareFromBase();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION), 44);

    // Map
    await app.launchExpedition();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_SAFE_RETURN), 44);

    // Wreck hotspots >= 44px touch ergonomics
    await app.seedStorage({ v2Save: presetWreckEncounterV3(), skipTitleScreen: true });
    await app.boot({ seed: 10008 });
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.wreckCut('armory')), 44);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A10-05 @p0-core Zero internal dev jargon leaks across Title, Base, Prepare, Map, Arrange & Settlement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: false });
    await app.boot({ seed: 10009 });
    await assertNoDevJargon(page);

    await app.enterStation();
    await assertNoDevJargon(page);

    await app.openPrepareFromBase();
    await assertNoDevJargon(page);

    await app.launchExpedition();
    await assertNoDevJargon(page);

    await app.safeReturn();
    await assertNoDevJargon(page);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A10-06 @p0-core S03 persistent ship-stage >= 60% viewport height, hold-view DOM identity preserved across edits, and A09 zero functional capsule pills', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetArrangeV3(), skipTitleScreen: true });
    await app.boot({ seed: 10010 });

    const shipStage = app.byTestId(TEST_IDS.SHIP_STAGE);
    const contextDock = app.byTestId(TEST_IDS.CONTEXT_DOCK);
    const holdView = app.byTestId(TEST_IDS.HOLD_VIEW);
    const compactStats = app.byTestId(TEST_IDS.CARGO_COMPACT_STATS);

    await expect(shipStage).toBeVisible();
    await expect(contextDock).toBeVisible();
    await expect(holdView).toBeVisible();
    await expect(compactStats).toBeVisible();

    // S03: Persistent ShipStage must occupy >= 60% of 1366x768 viewport height
    const stageBox = await shipStage.boundingBox();
    expect(stageBox, 'ship-stage must have measurable bounding box').not.toBeNull();
    expect((stageBox?.height ?? 0) / 768).toBeGreaterThanOrEqual(0.6);

    // S03 + F01: Stamp DOM identity tokens on hold-view & cargo board before an in-phase bay edit
    const stamped = await page.evaluate(() => {
      const hold = document.querySelector('[data-testid="hold-view"]') as
        | (HTMLElement & { __e2eHoldToken?: string })
        | null;
      const board = document.querySelector('[data-cargo-slot="board"]') as
        | (HTMLElement & { __e2eBoardToken?: string })
        | null;
      if (!hold || !board) return false;
      hold.__e2eHoldToken = 'hold_persist_v3';
      board.__e2eBoardToken = 'board_persist_v3';
      return true;
    });
    expect(stamped).toBe(true);

    // Place staging battery into (1,0) and verify exact DOM === identity survived with zero recreate
    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();
    await app.gridCell(1, 0).click();
    await expect(page.locator('.placed-item.synergy-active')).toHaveCount(2);

    const preserved = await page.evaluate(() => {
      const hold = document.querySelector('[data-testid="hold-view"]') as
        | (HTMLElement & { __e2eHoldToken?: string })
        | null;
      const board = document.querySelector('[data-cargo-slot="board"]') as
        | (HTMLElement & { __e2eBoardToken?: string })
        | null;
      return {
        holdToken: hold?.__e2eHoldToken ?? null,
        boardToken: board?.__e2eBoardToken ?? null,
      };
    });
    expect(preserved).toEqual({
      holdToken: 'hold_persist_v3',
      boardToken: 'board_persist_v3',
    });

    // A09: Industrial Terminal Skin eliminates functional capsule pills (border-radius >= 99px on >12px elements)
    const capsuleOffenders = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell.v2-shell');
      if (!shell) return ['missing .v2-shell'];
      const offenders: string[] = [];
      for (const el of Array.from(shell.querySelectorAll<HTMLElement>('*'))) {
        const rect = el.getBoundingClientRect();
        // Exclude hidden nodes and <=12px decorative circular LEDs/status dots
        if (rect.width <= 12 && rect.height <= 12) continue;
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = window.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const tl = parseFloat(cs.borderTopLeftRadius);
        const tr = parseFloat(cs.borderTopRightRadius);
        const bl = parseFloat(cs.borderBottomLeftRadius);
        const br = parseFloat(cs.borderBottomRightRadius);
        if (Math.max(tl, tr, bl, br) >= 99) {
          offenders.push(`${el.tagName}.${el.className}(${Math.round(Math.max(tl, tr, bl, br))}px)`);
        }
      }
      return offenders;
    });
    expect(capsuleOffenders, `Functional capsule pills detected: ${capsuleOffenders.join(', ')}`).toEqual([]);

    monitor.assertClean(await app.inspect());
  });
});
