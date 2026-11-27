import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  V3_0_RULES_VERSION,
  V3_RULES_VERSION,
  V3_SCHEMA_VERSION,
  attachZeroErrorMonitors,
  createAppDriver,
  createContractInstance,
  createV3_0SaveFixture,
  presetEndlessReadyV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 3 · P5: Endless Abyss Mutators × Seeded Challenge × Career & Achievements', () => {
  test('T3-P5-01 Endless Threat 1+ Mutators × Deterministic Seeded Challenge (90001) reproduces identical DAG, mutators & combat preview', async ({
    browser,
  }) => {
    test.slow();

    const launchSeededEndless = async (): Promise<{
      mutators: string[];
      nodeTypes: Record<string, string>;
      l1DrawerText: string;
      l1PredictedHp: number;
      l1EndlessBannerText: string;
    }> => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      try {
        const page = await ctx.newPage();
        const monitor = attachZeroErrorMonitors(page);
        const app = createAppDriver(page);

        await app.seedStorage({ v2Save: presetEndlessReadyV3(), skipTitleScreen: true });
        await app.boot({ seed: 90001, enterStation: true });
        await app.openPrepareFromBase();

        // Enable Endless Abyss Threat 1 via stable btn-mode-endless
        const endlessBtn = page.getByTestId('btn-mode-endless');
        await expect(endlessBtn).toBeVisible();
        await endlessBtn.click();

        await expect(page.getByTestId('endless-config-panel')).toBeVisible();
        const mutatorPreview = page.getByTestId('endless-mutator-preview');
        await expect(mutatorPreview).toBeVisible();

        // Unconditionally fill deterministic challenge seed 90001 and verify preview reflects #90001
        const seedInput = page.getByTestId('endless-seed-input');
        await expect(seedInput).toBeVisible();
        await seedInput.fill('90001');
        await expect(mutatorPreview).toContainText('#90001');

        await app.launchExpedition();

        const snap = await app.waitForInspect(
          (s) => s.phase === 'MAP' && (s.activeRun?.endlessThreat ?? 0) >= 1,
          15_000,
          'seeded endless run launched',
        );
        expect(snap.activeRun?.seed).toBe(90001);

        const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
        const run = stored?.activeRun;
        expect(run).not.toBeNull();
        const mutators = [...(run?.endlessMutatorIds ?? [])];
        expect(mutators.length).toBeGreaterThanOrEqual(1);

        const nodeTypes: Record<string, string> = {};
        for (const [id, node] of Object.entries(run?.graph.nodes ?? {})) {
          nodeTypes[id] = `${node.type}:${node.combat?.encounterKind ?? ''}`;
        }

        // Jump to Layer 1 combat node, immediately pause S05 auto-engage, and read exact S06 Layer-2 drawer forecast
        const l1CombatId = Object.values(run?.graph.nodes ?? {}).find(
          (n) => n.layer === 1 && (n.type === 'combat' || n.type === 'elite'),
        )?.nodeId;

        expect(l1CombatId, 'Seeded endless Layer 1 must contain a combat/elite node').toBeTruthy();
        await app.jumpToNode(l1CombatId!);
        await app.pauseAutoCombat();

        const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
        await expect(combatScreen).toBeVisible();
        const endlessBanner = page.getByTestId('combat-endless-banner');
        await expect(endlessBanner).toBeVisible();
        await expect(app.byTestId(TEST_IDS.COMBAT_THREAT_TIER)).toBeVisible();

        const drawer = await app.openForecastDetails();
        await expect(drawer).toContainText('不干预时结果');
        const l1DrawerText = ((await drawer.textContent()) ?? '').replace(/\s+/g, ' ').trim();
        expect(l1DrawerText.length).toBeGreaterThan(0);

        const hpAttr = await combatScreen
          .locator('[data-preview-final-hp]')
          .first()
          .getAttribute('data-preview-final-hp');
        expect(hpAttr, 'Pre-combat forecast must expose numeric data-preview-final-hp').not.toBeNull();
        const l1PredictedHp = Number(hpAttr);
        expect(Number.isFinite(l1PredictedHp)).toBe(true);

        const l1EndlessBannerText = ((await endlessBanner.textContent()) ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        expect(l1EndlessBannerText.length).toBeGreaterThan(0);

        monitor.assertClean(await app.inspect());
        return { mutators, nodeTypes, l1DrawerText, l1PredictedHp, l1EndlessBannerText };
      } finally {
        await ctx.close();
      }
    };

    const runA = await launchSeededEndless();
    const runB = await launchSeededEndless();

    expect(runA.mutators).toEqual(runB.mutators);
    expect(runA.nodeTypes).toEqual(runB.nodeTypes);
    expect(runA.l1DrawerText).toBe(runB.l1DrawerText);
    expect(runA.l1PredictedHp).toBe(runB.l1PredictedHp);
    expect(runA.l1EndlessBannerText).toBe(runB.l1EndlessBannerText);
  });

  test('T3-P5-02 Endless Abyss Threat 1 Clear increments maxEndlessThreat, updates career & runHistory, and unlocks Endless achievement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const endlessProfile = presetEndlessReadyV3();
    const settleSave = presetSettlementV3({
      reason: 'safe_return',
      wallet: 95,
      contract: createContractInstance('bounty_std', {
        overrides: {
          status: 'active',
          completedNodeIds: ['L3A'],
          requiredCompletions: 1,
          name: '无尽深渊 · 威压 1',
        },
      }),
    });
    settleSave.profile = endlessProfile.profile;
    if (settleSave.activeRun) {
      settleSave.activeRun.sectorId = 'stargate_abyss';
      settleSave.activeRun.endlessThreat = 1;
      settleSave.activeRun.endlessMutatorIds = ['ion_surge'];
      settleSave.activeRun.currentNodeId = 'L6A';
      settleSave.activeRun.visitedNodeIds = ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'];
    }

    await app.seedStorage({ v2Save: settleSave, skipTitleScreen: true });
    await app.boot({ seed: 35002 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await expect(page.getByTestId('settlement-endless-banner')).toBeVisible();
    await app.confirmSettlement();

    const baseSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after endless clear');
    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);

    expect(stored?.profile.campaign.maxEndlessThreat).toBe(2);
    expect(stored?.profile.career.deepestEndlessCleared).toBe(1);
    expect(stored?.profile.runHistory.length).toBeGreaterThanOrEqual(1);
    expect(stored?.profile.runHistory[0]?.endlessThreat).toBe(1);
    expect(stored?.profile.runHistory[0]?.endlessMutatorIds).toEqual(['ion_surge']);
    expect(stored?.profile.achievementsUnlocked).toContain('endless_first_clear');

    const creditsBeforeClaim = baseSnap.credits;
    const partsBeforeClaim = baseSnap.salvageParts;

    // Open Career modal and verify Endless history (威压 1 + 电离过载) & claimable endless_first_clear card
    const careerModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);
    const historyList = careerModal.getByTestId('career-run-history');
    await expect(historyList).toBeVisible();
    await expect(historyList).toContainText('威压 1');
    await expect(historyList).toContainText('电离过载');

    const achTab = careerModal.getByTestId('career-tab-achievements');
    await expect(achTab).toBeVisible();
    await achTab.click();

    const endlessAchCard = careerModal.getByTestId('achievement-card-endless_first_clear');
    await expect(endlessAchCard).toBeVisible();
    await expect(endlessAchCard).toHaveAttribute('data-unlocked', 'true');

    const claimBtn = careerModal.getByTestId('btn-claim-achievement-endless_first_clear');
    await expect(claimBtn).toBeVisible();
    await expect(claimBtn).toBeEnabled();
    await claimBtn.click();

    await expect(endlessAchCard).toHaveAttribute('data-claimed', 'true');

    await app.closeModal();
    const afterClaimSnap = await app.waitForInspect(
      (s) => s.credits === creditsBeforeClaim + 80 && s.salvageParts === partsBeforeClaim + 15,
      10_000,
      'endless_first_clear achievement reward (+80 credits / +15 salvage parts) credited',
    );
    expect(afterClaimSnap.credits).toBe(creditsBeforeClaim + 80);
    expect(afterClaimSnap.salvageParts).toBe(partsBeforeClaim + 15);

    monitor.assertClean(afterClaimSnap);
  });

  test('T3-P5-03 Rules 3.0.0→3.1.0 Migration (V3_0_BACKUP) × D03 Codex Synergy Journal × Seeded Endless Launch × T01 ?playtest=1 Telemetry Isolation', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const endlessBase = presetEndlessReadyV3({ discoveredSynergies: [] });
    const legacyEndlessV3_0 = createV3_0SaveFixture({
      profile: endlessBase.profile,
      withActiveRun: false,
    });

    await app.seedStorage({
      v2Save: legacyEndlessV3_0,
      v3_0Backup: null,
      playtestLog: null,
      skipTitleScreen: true,
    });

    // Phase A: Default Boot (NO ?playtest=1) migrates 3.0.0 -> 3.1.0, writes V3_0_BACKUP once, and writes ZERO playtest telemetry
    await app.boot({ seed: 90503, enterStation: true });
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    const migrated = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(migrated?.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(migrated?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(migrated?.profile.campaign.endlessUnlocked).toBe(true);
    expect(migrated?.profile.campaign.maxEndlessThreat).toBe(1);
    expect(migrated?.profile.campaign.endingsUnlocked).toContain('stargate_reignited');
    expect(migrated?.profile.discoveredSynergies).toEqual([]);

    const v3_0BackupInitial = await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP);
    expect(v3_0BackupInitial, '3.0.0 -> 3.1.0 migration must create write-once V3_0_BACKUP').not.toBeNull();
    expect(JSON.parse(v3_0BackupInitial!).rulesVersion).toBe(V3_0_RULES_VERSION);

    expect(await app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG)).toBeNull();
    await page.locator('#v2-hud-settings').click();
    await expect(app.byTestId(TEST_IDS.PLAYTEST_TELEMETRY_ROW)).toHaveCount(0);
    await app.closeModal();

    // Phase B: Live D03 battery_laser synergy discovery on Prepare -> Codex Synergy Journal (0/10 -> 1/10)
    await app.openPrepareFromBase();
    await page.locator('#v2-prep-clear').click();
    await page.locator('[data-add-loan="equipment.laser.common"]').first().click();
    await page.locator('[data-add-loan="equipment.battery.common"]').first().click();

    const discoveryToast = app.byTestId(TEST_IDS.SYNERGY_DISCOVERY_TOAST);
    await expect(discoveryToast).toBeVisible();
    const discoveredAttr = (await discoveryToast.getAttribute('data-synergy-ids')) ?? '';
    expect(discoveredAttr).toContain('battery_laser');

    await page.locator('#v2-prep-back').click();
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    const codexModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CODEX);
    const synergySection = codexModal.getByTestId(TEST_IDS.CODEX_SYNERGY_SECTION);
    await expect(synergySection).toBeVisible();
    await expect(synergySection).toContainText('联动图鉴 (1/10)');
    await expect(synergySection.locator('[data-synergy-id="battery_laser"]')).toHaveAttribute(
      'data-synergy-state',
      'discovered',
    );
    await expect(synergySection.locator('[data-synergy-state="locked"]')).toHaveCount(9);
    await app.closeModal();

    // Phase C: Deterministic Seeded Endless Launch (90503) under default mode maintains zero-write T01 isolation
    await app.openPrepareFromBase();
    await page.getByTestId('btn-mode-endless').click();
    const seedInput = page.getByTestId('endless-seed-input');
    await expect(seedInput).toBeVisible();
    await seedInput.fill('90503');
    await expect(page.getByTestId('endless-mutator-preview')).toContainText('#90503');

    await app.launchExpedition();
    const launchedSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.endlessThreat === 1 && s.activeRun?.seed === 90503,
      15_000,
      'seeded Endless 90503 launched cleanly',
    );
    const launchedRunId = launchedSnap.activeRun?.runId ?? '';
    expect(launchedRunId.length).toBeGreaterThan(0);

    const afterLaunchSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const launchedMutators = [...(afterLaunchSave?.activeRun?.endlessMutatorIds ?? [])];
    expect(launchedMutators.length).toBeGreaterThanOrEqual(1);

    expect(await app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG)).toBeNull();
    expect(await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP)).toBe(v3_0BackupInitial);

    // Phase D: Opt-In ?playtest=1 re-entry (without re-seeding storage), Export + Clear BEFORE closeModal(), then real reload
    await app.boot({ seed: 90503, playtest: true });
    await app.waitForInspect(
      (s) =>
        s.phase === 'MAP' &&
        s.activeRun?.runId === launchedRunId &&
        s.activeRun?.seed === 90503 &&
        s.activeRun?.endlessThreat === 1,
      30_000,
      'resumed active Endless run under ?playtest=1',
    );

    await page.locator('#v2-hud-settings').click();
    await expect(app.byTestId(TEST_IDS.PLAYTEST_TELEMETRY_ROW)).toBeVisible();
    const exportBtn = app.byTestId(TEST_IDS.BTN_EXPORT_PLAYTEST_LOG);
    const clearBtn = app.byTestId(TEST_IDS.BTN_CLEAR_PLAYTEST_LOG);
    await expect(exportBtn).toBeVisible();
    await expect(clearBtn).toBeVisible();

    const playtestRaw = await app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG);
    expect(playtestRaw, 'Opt-in ?playtest=1 must persist structured playtest log').not.toBeNull();
    const playtestParsed = JSON.parse(playtestRaw!) as {
      schemaVersion: number;
      events: { type: string }[];
    };
    expect(playtestParsed.schemaVersion).toBe(1);
    const eventTypes = new Set(playtestParsed.events.map((e) => e.type));
    expect(eventTypes.has('phase_enter')).toBe(true);
    expect(eventTypes.has('click')).toBe(true);

    await exportBtn.click();
    await clearBtn.click();
    // Verify clear immediately BEFORE closeModal() (closing modal triggers a new capture click under ?playtest=1)
    await expect
      .poll(async () => app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG), {
        timeout: 5_000,
        message: 'Clear button must remove starline_playtest_log cleanly',
      })
      .toBeNull();

    await app.closeModal();

    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReloadSnap = await app.waitForInspect(
      (s) =>
        s.phase === 'MAP' &&
        s.activeRun?.runId === launchedRunId &&
        s.activeRun?.seed === 90503 &&
        s.activeRun?.endlessThreat === 1,
      30_000,
      'Endless run 90503 survived reload cleanly',
    );

    const afterReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterReloadSave?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(afterReloadSave?.activeRun?.runId).toBe(launchedRunId);
    expect(afterReloadSave?.activeRun?.endlessThreat).toBe(1);
    expect(afterReloadSave?.activeRun?.endlessMutatorIds).toEqual(launchedMutators);
    expect(afterReloadSave?.profile.discoveredSynergies).toContain('battery_laser');
    expect(await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP)).toBe(v3_0BackupInitial);

    monitor.assertClean(afterReloadSnap);
  });
});
