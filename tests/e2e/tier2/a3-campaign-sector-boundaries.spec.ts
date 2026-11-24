import { expect, test } from '@playwright/test';
import {
  CREW_NAMES,
  SECTOR_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createDefaultCampaignState,
  presetAct1V3,
  presetAct2V3,
  presetPostTutorialV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A3: Campaign & Sector Access Gate Boundaries', () => {
  test('T2-A3-01 @p1-mid Locked sectors display unlock requirements and reject selection or launch', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct1V3({
        campaign: createDefaultCampaignState({
          currentAct: 'act1',
          unlockedSectors: ['near_orbit'],
        }),
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 23001, enterStation: true });
    await app.openPrepareFromBase();

    const sectorSelector = app.byTestId(TEST_IDS.SECTOR_SELECTOR);
    await expect(sectorSelector).toBeVisible();

    const lockedSector2 = sectorSelector
      .locator(
        '[data-sector-id="frozen_graveyard"], [data-testid="sector-option-frozen_graveyard"]',
      )
      .or(sectorSelector.getByRole('button', { name: new RegExp(SECTOR_NAMES.frozen_graveyard) }))
      .first();
    const lockedSector3 = sectorSelector
      .locator('[data-sector-id="stargate_abyss"], [data-testid="sector-option-stargate_abyss"]')
      .or(sectorSelector.getByRole('button', { name: new RegExp(SECTOR_NAMES.stargate_abyss) }))
      .first();

    await expect(lockedSector2).toBeVisible();
    await expect(lockedSector3).toBeVisible();
    await expect(lockedSector2).toBeDisabled();
    await expect(lockedSector3).toBeDisabled();
    await expect(sectorSelector).toContainText(/未解锁|锁定|铁砧号|铁壁无畏|击败|通关/);

    // Launch must strictly stay in unlocked near_orbit
    await app.launchExpedition();
    const mapSnap = await app.inspect();
    expect(mapSnap.activeRun?.sectorId).toBe('near_orbit');

    monitor.assertClean(mapSnap);
  });

  test('T2-A3-02 @p0-core Locked deep contracts render informative preview cards (non-empty F04 fix) and reject acceptance', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetPostTutorialV3({
        completedContractTypes: [],
        completedContractIds: [],
        deepestLayerReached: 3,
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 23002, enterStation: true });

    const dialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_CONTRACTS);

    const deepHeading = dialog
      .locator('.v2-contract-section-title, [data-testid="contracts-deep-section"], .contracts-deep-section, section')
      .filter({ hasText: /深入委托|深空/ })
      .first();
    await expect(deepHeading).toBeVisible();

    // Must render non-empty locked preview cards (fixing V2 empty container bug)
    const lockedDeepCards = dialog.locator(
      '.v2-contract-card.is-locked, [data-contract-locked="true"], [data-testid^="contract-card-"].is-locked',
    );
    const cardCount = await lockedDeepCards.count();
    expect(cardCount, 'Locked deep contracts section must NOT be empty').toBeGreaterThan(0);

    await expect(lockedDeepCards.first()).toContainText(/120|标准委托|第\s*4\s*层|L4|解锁/);

    // Zero enabled action buttons may exist inside locked deep contract cards
    await expect(lockedDeepCards.locator('button:not([disabled])')).toHaveCount(0);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T2-A3-03 @p1-mid Locked crew specialists show unlock criteria and cannot be selected for launch', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetPostTutorialV3({
        unlockedCrew: ['engineer'],
        selectedCrewId: 'engineer',
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 23003, enterStation: true });
    await app.openPrepareFromBase();

    const crewSelector = app.byTestId(TEST_IDS.CREW_SELECTOR);
    await expect(crewSelector).toBeVisible();

    const lockedNav = crewSelector
      .locator('[data-crew-id="navigator"], [data-testid="crew-option-navigator"]')
      .or(crewSelector.getByRole('button', { name: new RegExp(CREW_NAMES.navigator) }))
      .first();
    const lockedSalvager = crewSelector
      .locator('[data-crew-id="salvager"], [data-testid="crew-option-salvager"]')
      .or(crewSelector.getByRole('button', { name: new RegExp(CREW_NAMES.salvager) }))
      .first();

    await expect(lockedNav).toBeVisible();
    await expect(lockedSalvager).toBeVisible();
    await expect(lockedNav).toBeDisabled();
    await expect(lockedSalvager).toBeDisabled();
    await expect(crewSelector).toContainText(/测绘|转运|未解锁|锁定/);

    await app.launchExpedition();
    const snap = await app.inspect();
    expect(snap.activeRun?.crewId).toBe('engineer');

    monitor.assertClean(snap);
  });

  test('T2-A3-04 @p2-late Act III final climax mission gate blocks launch until all prerequisites are satisfied', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct2V3({
        campaign: createDefaultCampaignState({
          currentAct: 'act2',
          unlockedSectors: ['near_orbit', 'frozen_graveyard'],
          defeatedBossIds: ['boss_anvil'],
          finalMissionUnlocked: false,
          endlessUnlocked: false,
        }),
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 23004, enterStation: true });

    const campaignDialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAMPAIGN);
    await expect(campaignDialog).toContainText(/星门重启|终战|前置|未解锁|第三幕/);

    const enabledFinalLaunch = campaignDialog
      .locator('[data-testid="btn-launch-final-mission"]:not([disabled])')
      .or(campaignDialog.locator('button:not([disabled])').filter({ hasText: /启动星门重启远征|开启终战/ }));
    await expect(enabledFinalLaunch).toHaveCount(0);

    await app.closeModal();

    // Launching normal expedition must NOT flag isFinalCampaignRun
    await app.openPrepareFromBase();
    await app.launchExpedition();
    const snap = await app.inspect();
    expect(snap.activeRun?.isFinalCampaignRun).toBe(false);

    monitor.assertClean(snap);
  });

  test('T2-A3-05 @p1-mid Acquiring a sector relic resets its relic pity counter cleanly upon settlement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const relicBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'pity_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'pity_relic_nav',
            definitionId: 'cargo.ancient_navigator',
            origin: 'loot',
            fixedValue: 48,
            acquiredDepth: 4,
          }),
          x: 1,
          y: 0,
        },
      ],
    });

    const settleSave = presetSettlementV3({
      reason: 'safe_return',
      wallet: 20,
      bay: relicBay,
    });
    settleSave.profile.buildings.display = true;
    settleSave.profile.campaign.relicPityCounters = {
      near_orbit: 3,
      frozen_graveyard: 1,
      stargate_abyss: 0,
    };
    if (settleSave.activeRun) {
      settleSave.activeRun.sectorId = 'near_orbit';
    }

    await app.seedStorage({
      v2Save: settleSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 23005 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.relics.ancient_navigator.storedCount).toBeGreaterThanOrEqual(1);
    expect(saved?.profile.campaign.relicPityCounters.near_orbit).toBe(0);
    // Unrelated sector pity counter remains untouched
    expect(saved?.profile.campaign.relicPityCounters.frozen_graveyard).toBe(1);

    monitor.assertClean(await app.inspect());
  });
});
