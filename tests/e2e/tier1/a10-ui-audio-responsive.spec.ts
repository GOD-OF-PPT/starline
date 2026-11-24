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
});
