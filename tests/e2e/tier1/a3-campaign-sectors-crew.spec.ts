import { expect, test } from '@playwright/test';
import {
  CREW_NAMES,
  SECTOR_NAMES,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  presetAct1V3,
  presetAct2V3,
  presetAct3ClimaxV3,
  presetWreckEncounterV3,
} from '../helpers';

test.describe('Tier 1 · A3: Mainline 4-Act Campaign, 3 Star Sectors & Named Crew', () => {
  test('T1-A3-01 @p1-mid Base HUD campaign banner collapses/expands and Campaign modal renders 4-Act roadmap', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct1V3(), skipTitleScreen: true });
    await app.boot({ seed: 3001, enterStation: true });

    const banner = app.byTestId(TEST_IDS.CAMPAIGN_BANNER);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/第一幕|星门|主线/);

    // Toggle collapse/expand on campaign banner
    const toggleBtn = banner.locator('button').first();
    await expect(toggleBtn).toBeVisible();
    const initialHeight = (await banner.boundingBox())?.height ?? 0;
    await toggleBtn.click();
    const toggledHeight = (await banner.boundingBox())?.height ?? 0;
    expect(toggledHeight).not.toBe(initialHeight);

    // Open full Campaign Roadmap & Story Comms modal
    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAMPAIGN);
    const snap = await app.inspect();
    expect(snap.modalOpen).toBe(true);

    await expect(modal).toContainText(/序章|第一幕/);
    await expect(modal).toContainText(/第二幕/);
    await expect(modal).toContainText(/第三幕/);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T1-A3-02 @p1-mid Sector 2 selection discloses cryo/ion environmental rule and propagates to run telemetry', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct2V3(), skipTitleScreen: true });
    await app.boot({ seed: 3002, enterStation: true });
    await app.openPrepareFromBase();

    await app.selectSector('frozen_graveyard');
    const prepareScreen = app.byTestId(TEST_IDS.PREPARE_SCREEN);
    await expect(prepareScreen).toContainText(SECTOR_NAMES.frozen_graveyard);
    await expect(prepareScreen).toContainText(/冰晶|离子|低温|护盾|环境/);

    await app.launchExpedition();

    const snap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.sectorId === 'frozen_graveyard',
      15_000,
      'launched into frozen_graveyard',
    );
    const attrs = await app.getRootAttributes();
    expect(attrs.sector).toBe('frozen_graveyard');

    monitor.assertClean(snap);
  });

  test('T1-A3-03 @p2-late Sector 3 (古代星门禁区) displays Gravity Tide modifier on map & combat preview', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct3ClimaxV3(), skipTitleScreen: true });
    await app.boot({ seed: 3003, enterStation: true });
    await app.openPrepareFromBase();

    await app.selectSector('stargate_abyss');
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(SECTOR_NAMES.stargate_abyss);
    await app.launchExpedition();

    await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.sectorId === 'stargate_abyss',
      15_000,
      'launched into stargate_abyss',
    );
    expect((await app.getRootAttributes()).sector).toBe('stargate_abyss');
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toContainText(/引力潮汐|星门禁区|引力/);

    // Jump to a combat node on Layer 1 to verify modifier disclosure in combat preview
    const combatNode = page
      .locator('[data-testid="map-node-L1A"], [data-testid="map-node-L1B"]')
      .filter({ hasText: /战斗|敌|哨/ })
      .first();
    await expect(combatNode).toBeVisible();
    await combatNode.click();
    await app.byTestId(TEST_IDS.BTN_JUMP_NODE).click();

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toContainText(/引力潮汐|引力/);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A3-04 @p1-mid Named crew specialists render inline SVG portraits and selectable abilities', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct2V3(), skipTitleScreen: true });
    await app.boot({ seed: 3004, enterStation: true });
    await app.openPrepareFromBase();

    const crewSelector = app.byTestId(TEST_IDS.CREW_SELECTOR);
    await expect(crewSelector).toBeVisible();
    await expect(crewSelector).toContainText(CREW_NAMES.engineer);
    await expect(crewSelector).toContainText(CREW_NAMES.navigator);
    await expect(crewSelector).toContainText(CREW_NAMES.salvager);

    const svgCount = await crewSelector.locator('svg').count();
    expect(svgCount).toBeGreaterThanOrEqual(3);

    await app.selectCrew('navigator');
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/首次跃迁|0\s*燃料|领航/);

    await app.selectCrew('salvager');
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/残骸|透视|打捞/);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A3-05 @p1-mid Crew Mastery displays rank and Navigator free jump & Salvager full wreck reveal work', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: Navigator free first jump
    await app.seedStorage({ v2Save: presetAct2V3(), skipTitleScreen: true });
    await app.boot({ seed: 3005, enterStation: true });
    await app.openPrepareFromBase();

    const crewSelector = app.byTestId(TEST_IDS.CREW_SELECTOR);
    await expect(crewSelector).toContainText(/专精|Lv|阶|★/);

    await app.selectCrew('navigator');
    await app.launchExpedition();

    const beforeJump = await app.inspect();
    const initialFuel = beforeJump.activeRun?.fuel ?? 9;

    await app.jumpToNode('L1A');
    const afterJump = await app.inspect();
    expect(afterJump.activeRun?.fuel).toBe(initialFuel);

    // Part B: Salvager full reveal on Wreck screen
    await app.seedStorage({
      v2Save: presetWreckEncounterV3({ crewId: 'salvager' }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 3006 });

    const wreckScreen = app.byTestId(TEST_IDS.WRECK_SCREEN);
    await expect(wreckScreen).toBeVisible();
    // Salvager reveals exact loot names/shapes/values before cutting
    await expect(wreckScreen).toContainText(/激光|合金|引擎|价值|¤/);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A3-06 @p1-mid Pity relic signal threshold guarantees visible relic signal on Star Map', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const pitySave = presetAct1V3({
      campaign: {
        currentAct: 'act1',
        unlockedSectors: ['near_orbit'],
        completedMilestones: ['tutorial_complete'],
        defeatedBossIds: [],
        readCommsIds: [],
        relicPityCounters: {
          near_orbit: 5,
          frozen_graveyard: 0,
          stargate_abyss: 0,
        },
        endingsUnlocked: [],
        finalMissionUnlocked: false,
        endlessUnlocked: false,
        maxEndlessThreat: 0,
      },
    });

    await app.seedStorage({ v2Save: pitySave, skipTitleScreen: true });
    await app.boot({ seed: 3007, enterStation: true });
    await app.openPrepareFromBase();
    await app.launchExpedition();

    const mapScreen = app.byTestId(TEST_IDS.MAP_SCREEN);
    await expect(mapScreen).toBeVisible();
    await expect(mapScreen).toContainText(/遗物|信号|保底/);

    monitor.assertClean(await app.inspect());
  });
});
