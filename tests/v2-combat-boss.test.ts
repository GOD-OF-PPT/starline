import { describe, expect, it } from 'vitest';
import {
  V3_BOSS_DEFS,
  V3_BOSS_ORDER,
  getV3BossDef,
  isV3BossId,
  resolveV3BossDefForEncounter,
} from '../src/v2/data/bosses';
import {
  V2_REGULAR_ENCOUNTER_KINDS,
  buildEncounterUnits,
  buildSectorEnemyEncounter,
  getUnitIntentCyclePreview,
  isActBossEncounterKind,
  resolveUnitInitialShield,
  resolveUnitIntentForRound,
  resolveUnitIntentRole,
} from '../src/v2/data/enemies';
import { V2_MAX_BATTLE_SHIELD } from '../src/v2/data/equipment';
import { V2_SHIPS, V2_SHIP_ORDER, getShipSignatureCommand } from '../src/v2/data/ships';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import { SeededRng } from '../src/domain/rng';
import {
  V2_ELITE_OVERLOAD_COST,
  V2_ELITE_OVERLOAD_RAW_DMG,
  V2_TACTIC_EMERGENCY_SHIELD_GAIN,
  V2_TACTIC_FOCUS_PRECISION_DMG,
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  computeCombatTacticalChargesMax,
  getTacticalCommandLabel,
  isActBossOrBossNode,
  markV2CombatDecisionPaused,
  previewV2CombatNode,
  resolveNodeBossId,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import { getReachableNextNodeIds, selectV2MapNode } from '../src/v2/domain/encounter';
import {
  addV2ItemToStaging,
  createEmptyV2Bay,
  placeV2FromStaging,
} from '../src/v2/domain/inventoryV2';
import { createV2EquipmentInstance } from '../src/v2/domain/itemCatalog';
import { buildFreeFallbackPrepareSlots, launchV2Expedition } from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  normalizeV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import { applyV2Settlement } from '../src/v2/domain/settlementV2';
import { computeV2PlacementTacticalDelta } from '../src/v2/domain/tacticalDelta';
import {
  isPureAutoCombat,
  type SectorId,
  type V2CargoBayState,
  type V2ProfileState,
  type V2RunState,
} from '../src/v2/domain/types';

class MemoryStorage implements V2StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function makeUnlockedCombatProfile(overrides: Partial<V2ProfileState> = {}): V2ProfileState {
  const base = createFreshV2Profile();
  return {
    ...base,
    tutorialCompleted: true,
    credits: 1200,
    salvageParts: 300,
    buildings: {
      workbench: true,
      contract_hub: true,
      drydock: true,
      research_lab: true,
      display: true,
      drydock_tier2: true,
    },
    facilityTiers: {
      ...base.facilityTiers,
      workbench: 2,
      contract_hub: 2,
      drydock: 3,
      drydock_tier2: 1,
      research_lab: 2,
      display: 2,
      stargate_relay: 1,
    },
    unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter', 'stargate_cruiser'],
    unlockedCrew: ['engineer', 'navigator', 'salvager'],
    unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
    blueprints: [
      'laser',
      'battery',
      'shield',
      'repair',
      'heavy',
      'capacitor',
      'hangar',
      'relay',
      'counter',
      'flak',
      'coolant_vent',
      'cargo_amp',
      'emp_jammer',
      'overdrive_core',
      'salvage_grapple',
      'salvo_pod',
    ],
    campaign: {
      ...base.campaign,
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
    },
    ...overrides,
  };
}

function makeSimpleBay(
  shipId: V2CargoBayState['shipId'],
  specs: ReadonlyArray<{
    readonly id: string;
    readonly kind: Parameters<typeof createV2EquipmentInstance>[0]['kind'];
    readonly quality?: 'common' | 'improved';
    readonly x: number;
    readonly y: number;
    readonly rotation?: 0 | 1 | 2 | 3;
  }>
): V2CargoBayState {
  let bay = createEmptyV2Bay(shipId);
  for (const s of specs) {
    const item = createV2EquipmentInstance({
      instanceId: s.id,
      kind: s.kind,
      quality: s.quality ?? 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'staging',
    });
    bay = addV2ItemToStaging(bay, item, s.rotation ?? 0);
    const res = placeV2FromStaging(bay, item.instanceId, s.x, s.y, s.rotation ?? 0);
    if (!res.ok) {
      throw new Error(`Failed placing ${s.id} (${s.kind}) at (${s.x},${s.y}): ${res.reason}`);
    }
    bay = res.bay;
  }
  return bay;
}

describe('M3 F08: Default-ON Active Tactical Combat, Settings Sanitization & Charge Budgets', () => {
  it('defaults isPureAutoCombat to false, honors pureAutoCombat toggle on combat start, and sanitizes persisted settings', () => {
    expect(isPureAutoCombat(undefined)).toBe(false);
    expect(isPureAutoCombat({})).toBe(false);
    expect(isPureAutoCombat({ pureAutoCombat: false })).toBe(false);
    expect(isPureAutoCombat({ pureAutoCombat: true })).toBe(true);

    const profile = makeUnlockedCombatProfile();
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      sectorId: 'near_orbit',
      seed: 3101,
    });
    expect(launched.ok && launched.run).toBeTruthy();

    const combatNode = Object.values(launched.run!.graph.nodes).find(
      (n) => n.type === 'combat' && n.layer >= 2 && n.combat
    )!;
    const atCombat: V2RunState = {
      ...launched.run!,
      currentNodeId: combatNode.nodeId,
      phase: 'ENCOUNTER',
      tacticalChargesMax: 1,
      tacticalChargesUsed: 0,
    };

    // Active Tactical (default-ON: pureAutoCombat = false) pauses at Round 2 with 4 options
    const tacticalStart = startV2CombatAtCurrentNode(atCombat, 'weakest', {
      pureAutoCombat: false,
    });
    expect(tacticalStart.ok).toBe(true);
    expect(tacticalStart.run.activeCombat?.pendingDecision).not.toBeNull();
    expect(tacticalStart.run.activeCombat?.pendingDecision?.options.length).toBe(4);
    expect(tacticalStart.run.activeCombat?.pendingDecision?.chargesMax).toBe(1);

    // Pure-Auto (pureAutoCombat = true) skips pause and matches previewV2CombatNode verbatim
    const preview = previewV2CombatNode(atCombat, combatNode.nodeId, 'weakest');
    const autoStart = startV2CombatAtCurrentNode(atCombat, 'weakest', {
      pureAutoCombat: true,
    });
    expect(autoStart.ok).toBe(true);
    expect(autoStart.run.activeCombat?.pendingDecision).toBeNull();
    expect(autoStart.run.activeCombat?.simulation.outcome).toBe(preview?.outcome);
    expect(autoStart.run.activeCombat?.simulation.finalPlayerHpAfterRepair).toBe(
      preview?.finalPlayerHpAfterRepair
    );
    expect(autoStart.run.activeCombat?.simulation.roundsCount).toBe(preview?.roundsCount);

    // Settings sanitization: allowlists boolean pureAutoCombat, strips non-boolean / unknown keys
    const storage = new MemoryStorage();
    const baseSave = createFreshV2SaveData();
    const dirtySave = {
      ...baseSave,
      settings: {
        ...baseSave.settings,
        pureAutoCombat: true,
        unknownRogueFlag: 'hacked',
      } as unknown as typeof baseSave.settings,
    };
    const normalizedTrue = normalizeV2SaveData(dirtySave);
    expect(normalizedTrue.settings.pureAutoCombat).toBe(true);
    expect('unknownRogueFlag' in normalizedTrue.settings).toBe(false);

    const normalizedBadType = normalizeV2SaveData({
      ...baseSave,
      settings: {
        ...baseSave.settings,
        pureAutoCombat: 'yes' as unknown as boolean,
      },
    });
    expect(normalizedBadType.settings.pureAutoCombat).toBeUndefined();
    expect(isPureAutoCombat(normalizedBadType.settings)).toBe(false);

    expect(persistV2SaveData(storage, normalizedTrue).ok).toBe(true);
    const loaded = loadV2SaveData(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.data.settings.pureAutoCombat).toBe(true);
      expect('unknownRogueFlag' in loaded.data.settings).toBe(false);
    }
  });

  it('enforces dynamic Command Charge budgets (1 regular/non-boss elite, 2 Act Boss, 3 Act Boss w/ restored obsidian_crown), multi-charge chaining, zero overspend, and reload-safe pause/commit idempotency', () => {
    const baseProfile = makeUnlockedCombatProfile();
    const storedCrownProfile = makeUnlockedCombatProfile({
      relics: {
        ...baseProfile.relics,
        obsidian_crown: { storedCount: 1, restored: false },
      },
    });
    const restoredCrownProfile = makeUnlockedCombatProfile({
      relics: {
        ...baseProfile.relics,
        obsidian_crown: { storedCount: 0, restored: true },
      },
    });

    // Showcase L4A non-boss elite stays 1 charge EVEN with bonusBossCharges = 1
    const showcase = createV2ShowcaseRun('trial_counter', 'charges_showcase');
    const showcaseElite = showcase.graph.nodes['L4A'];
    expect(isActBossOrBossNode(showcaseElite, showcase)).toBe(false);
    expect(computeCombatTacticalChargesMax(showcaseElite, showcase, 0)).toBe(1);
    expect(computeCombatTacticalChargesMax(showcaseElite, showcase, 1)).toBe(1);

    // Launch Sector 1 expedition to inspect regular combat & Act I Boss (L6)
    const launched = launchV2Expedition({
      profile: baseProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'shield_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('shield_cruiser', baseProfile.blueprints),
      sectorId: 'near_orbit',
      seed: 3202,
    });
    expect(launched.ok && launched.run).toBeTruthy();
    const run = launched.run!;
    const regNode = Object.values(run.graph.nodes).find((n) => n.type === 'combat' && n.combat)!;
    const bossNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 6 && (n.type === 'elite' || n.type === 'boss')
    )!;

    expect(isActBossOrBossNode(regNode, run)).toBe(false);
    expect(computeCombatTacticalChargesMax(regNode, run, 1)).toBe(1);

    expect(isActBossOrBossNode(bossNode, run)).toBe(true);
    expect(resolveNodeBossId(bossNode, run)).toBe('boss_anvil');
    expect(computeCombatTacticalChargesMax(bossNode, run, 0)).toBe(2);
    expect(computeCombatTacticalChargesMax(bossNode, run, 1)).toBe(3);

    // Entering Act Boss via selectV2MapNode honors obsidian_crown.restored STRICTLY
    const parentToBoss = Object.values(run.graph.nodes).find((n) =>
      n.nextNodeIds.includes(bossNode.nodeId)
    )!;
    const preBossRun: V2RunState = {
      ...run,
      currentNodeId: parentToBoss.nodeId,
      phase: 'MAP',
      fuel: 8,
      visitedNodeIds: [...run.visitedNodeIds, parentToBoss.nodeId],
      graph: {
        ...run.graph,
        nodes: {
          ...run.graph.nodes,
          [parentToBoss.nodeId]: { ...parentToBoss, resolved: true },
        },
      },
    };
    const enteredStored = selectV2MapNode(preBossRun, bossNode.nodeId, {
      profile: storedCrownProfile,
    });
    expect(enteredStored.ok).toBe(true);
    expect(enteredStored.run.tacticalChargesMax).toBe(2); // stored-but-unrestored gives 0 bonus!

    const enteredRestored = selectV2MapNode(preBossRun, bossNode.nodeId, {
      profile: restoredCrownProfile,
    });
    expect(enteredRestored.ok).toBe(true);
    expect(enteredRestored.run.tacticalChargesMax).toBe(3); // restored obsidian_crown -> 3 charges!
    expect(enteredRestored.run.tacticalChargesUsed).toBe(0);

    // Build a tough, steady Act III Leviathan battle with 3 charges so all 3 charges can chain!
    const leviLaunch = launchV2Expedition({
      profile: restoredCrownProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'stargate_abyss',
      seed: 3209,
    });
    const leviNode = Object.values(leviLaunch.run!.graph.nodes).find(
      (n) => n.layer === 6 && n.bossId === 'boss_leviathan'
    )!;
    // Balanced tanky bay so battle lasts >= 6 rounds cleanly
    const steadyBay = makeSimpleBay('stargate_cruiser', [
      { id: 'l1', kind: 'laser', quality: 'common', x: 1, y: 0 },
      { id: 's1', kind: 'shield', quality: 'improved', x: 2, y: 0 },
      { id: 'c1', kind: 'coolant_vent', quality: 'improved', x: 3, y: 0 },
      { id: 'r1', kind: 'repair', quality: 'improved', x: 1, y: 2 },
    ]);
    const atLevi: V2RunState = {
      ...leviLaunch.run!,
      currentNodeId: leviNode.nodeId,
      phase: 'ENCOUNTER',
      bay: steadyBay,
      hp: 38,
      maxHp: 38,
      tacticalChargesMax: 3,
      tacticalChargesUsed: 0,
    };

    // Pause #1 -> mark paused -> persist -> reload -> commit #1
    const started = startV2CombatAtCurrentNode(atLevi, 'weakest', {
      pureAutoCombat: false,
      bonusBossCharges: 1,
    });
    expect(started.ok).toBe(true);
    const p1 = started.run.activeCombat!.pendingDecision!;
    expect(p1.chargesMax).toBe(3);
    expect(p1.chargeIndex).toBe(1);
    expect(p1.chosen).toBeNull();

    const paused1 = markV2CombatDecisionPaused(started.run, p1.decisionId);
    expect(paused1.activeCombat!.pausedAtDecisionId).toBe(p1.decisionId);
    expect(paused1.activeCombat!.resumeFromRound).toBe(p1.roundNumber - 1);
    // Idempotent second call returns identical reference
    expect(markV2CombatDecisionPaused(paused1, p1.decisionId)).toBe(paused1);

    const storage = new MemoryStorage();
    expect(
      persistV2SaveData(storage, {
        ...createFreshV2SaveData(),
        profile: restoredCrownProfile,
        activeRun: paused1,
      }).ok
    ).toBe(true);
    const reloaded = loadV2SaveData(storage);
    expect(reloaded.status).toBe('loaded');
    if (reloaded.status !== 'loaded') return;
    expect(reloaded.data.activeRun!.activeCombat!.pausedAtDecisionId).toBe(p1.decisionId);

    // Completing combat before deciding is strictly blocked
    expect(
      completeV2CombatAtCurrentNode(reloaded.data.activeRun!, restoredCrownProfile.unlockedFamilies)
        .ok
    ).toBe(false);

    // Commit #1 (emergency_shield) -> chains to Pause #2!
    const c1 = commitV2EliteTacticDecision(
      reloaded.data.activeRun!,
      p1.decisionId,
      'emergency_shield'
    );
    expect(c1.ok).toBe(true);
    expect(c1.run.tacticalChargesUsed).toBe(1);
    expect(c1.run.activeCombat!.committedCommands?.length).toBe(1);
    expect(c1.run.activeCombat!.pausedAtDecisionId).toBeNull();
    // Re-committing Pause #1 fails (idempotency!)
    expect(commitV2EliteTacticDecision(c1.run, p1.decisionId, 'focus_calibrate').ok).toBe(false);

    const p2 = c1.run.activeCombat!.pendingDecision;
    expect(p2).not.toBeNull();
    expect(p2!.chosen).toBeNull();
    expect(p2!.roundNumber).toBeGreaterThan(p1.roundNumber);
    expect(p2!.chargeIndex).toBe(2);

    // Commit #2 (focus_calibrate) -> chains to Pause #3!
    const c2 = commitV2EliteTacticDecision(c1.run, p2!.decisionId, 'focus_calibrate');
    expect(c2.ok).toBe(true);
    expect(c2.run.tacticalChargesUsed).toBe(2);
    expect(c2.run.activeCombat!.committedCommands?.length).toBe(2);

    const p3 = c2.run.activeCombat!.pendingDecision;
    expect(p3).not.toBeNull();
    expect(p3!.chosen).toBeNull();
    expect(p3!.roundNumber).toBeGreaterThan(p2!.roundNumber);
    expect(p3!.chargeIndex).toBe(3);

    // Commit #3 (signature_stargate_cruiser) -> exhausts all 3 charges, zero overspend, and matches option prediction!
    const p3Opt = p3!.options.find((o) => o.choice === 'signature_stargate_cruiser')!;
    expect(p3Opt).toBeDefined();
    const c3 = commitV2EliteTacticDecision(c2.run, p3!.decisionId, 'signature_stargate_cruiser');
    expect(c3.ok).toBe(true);
    expect(c3.run.tacticalChargesUsed).toBe(3);
    expect(c3.run.tacticalChargesUsed).toBeLessThanOrEqual(c3.run.tacticalChargesMax!);
    expect(c3.run.activeCombat!.committedCommands?.length).toBe(3);
    expect(c3.run.activeCombat!.pendingDecision!.chosen).toBe('signature_stargate_cruiser');
    const c3Sim = c3.run.activeCombat!.simulation;
    expect(c3Sim.outcome === 'victory' ? c3Sim.finalPlayerHpAfterRepair : 0).toBe(
      p3Opt.predictedFinalHp
    );
    expect(c3Sim.roundsCount).toBe(p3Opt.predictedRounds);
    // No 4th decision & re-commit rejected
    expect(commitV2EliteTacticDecision(c3.run, p3!.decisionId, 'overload').ok).toBe(false);

    const saveCheck = validateV2SaveDataDetailed({
      ...createFreshV2SaveData(),
      profile: restoredCrownProfile,
      activeRun: c3.run,
    });
    expect(saveCheck.ok).toBe(true);
  });
});

describe('M3 F08: All 3 Universal Orders & All 4 Hull Signature Commands', () => {
  it('verifies overload lethal guard & 9 ignore-armor dmg, emergency_shield +6/+8 & 0.5x pierce mitigation & +2 counter, and focus_calibrate ignore-armor +1 direct & 4 strike', () => {
    const armoredUnits = buildEncounterUnits('armored', 4, 'tactic_armored'); // HP 28, armor 2, dmg 3
    const piercerUnits = buildEncounterUnits('piercer', 4, 'tactic_piercer'); // HP 22, dmg 4, pierce 0.5

    // 1. Overload: 9 ignore-armor strike + costs 3 (shield first then HP); lethal guard at HP + shield <= 3
    const overloadBay = makeSimpleBay('cannon_skiff', [
      { id: 'l1', kind: 'laser', quality: 'common', x: 0, y: 0 },
      { id: 's1', kind: 'shield', quality: 'common', x: 2, y: 0 },
    ]);
    const simOverload = simulateV2Combat({
      resultId: 'ord_overload',
      bay: overloadBay,
      startingHp: 30,
      maxHp: 30,
      units: armoredUnits,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'overload' }],
    });
    const r2Over = simOverload.rounds[1];
    expect(r2Over.appliedTacticThisRound).toBe('overload');
    const overHit = r2Over.playerAttacks.find((a) => a.sourceInstanceId === 'tactic_overload');
    expect(overHit).toBeDefined();
    expect(overHit!.appliedDamage).toBe(V2_ELITE_OVERLOAD_RAW_DMG);
    expect(overHit!.armorBlocked).toBe(0);
    // Shield spent by Overload (3) before enemy phase -> playerShieldAfter reflects cost + enemy absorption
    const expectedShieldBeforeEnemy = Math.max(
      0,
      simOverload.rounds[0].playerShieldAfter - V2_ELITE_OVERLOAD_COST
    );
    expect(r2Over.playerShieldAfter).toBe(
      Math.max(0, expectedShieldBeforeEnemy - r2Over.shieldAbsorbedTotal)
    );

    // Lethal guard boundary: startingHp = 6 against 3 dmg/round with 0 shield -> R1 end HP = 3 -> HP+shield = 3 <= 3 -> disabled!
    // startingHp = 7 -> R1 end HP = 4 -> HP+shield = 4 > 3 -> enabled!
    const profile = makeUnlockedCombatProfile();
    const baseLaunch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 3301,
    });
    const targetNode = Object.values(baseLaunch.run!.graph.nodes).find(
      (n) => n.type === 'combat' && n.combat
    )!;
    const noShieldBay = makeSimpleBay('cannon_skiff', [
      { id: 'l1', kind: 'laser', quality: 'common', x: 0, y: 0 },
    ]);
    const customGraph = {
      ...baseLaunch.run!.graph,
      nodes: {
        ...baseLaunch.run!.graph.nodes,
        [targetNode.nodeId]: {
          ...targetNode,
          combat: { ...targetNode.combat!, encounterKind: 'armored' as const, units: armoredUnits },
        },
      },
    };
    const nearDeathRun: V2RunState = {
      ...baseLaunch.run!,
      graph: customGraph,
      currentNodeId: targetNode.nodeId,
      phase: 'ENCOUNTER',
      bay: noShieldBay,
      hp: 6, // After R1 3 dmg -> HP = 3, shield = 0 -> total 3 <= 3
      maxHp: 30,
      tacticalChargesMax: 1,
      tacticalChargesUsed: 0,
    };
    const startBlocked = startV2CombatAtCurrentNode(nearDeathRun, 'weakest', {
      pureAutoCombat: false,
    });
    const blockedOverload = startBlocked.run.activeCombat!.pendingDecision!.options.find(
      (o) => o.choice === 'overload'
    )!;
    expect(blockedOverload.enabled).toBe(false);

    const safeHpRun: V2RunState = { ...nearDeathRun, hp: 7 }; // After R1 3 dmg -> HP = 4 > 3
    const startAllowed = startV2CombatAtCurrentNode(safeHpRun, 'weakest', {
      pureAutoCombat: false,
    });
    const allowedOverload = startAllowed.run.activeCombat!.pendingDecision!.options.find(
      (o) => o.choice === 'overload'
    )!;
    expect(allowedOverload.enabled).toBe(true);

    // 2. Emergency Shield: +6 without counter, +8 with counter (capped at 20), halves enemy pierceRatio (0.5 -> 0.25), +2 counter bonus
    const simNoOrderPiercer = simulateV2Combat({
      resultId: 'ord_emg_base',
      bay: overloadBay,
      startingHp: 30,
      maxHp: 30,
      units: piercerUnits,
      targetPolicy: 'weakest',
    });
    const simEmgPiercer = simulateV2Combat({
      resultId: 'ord_emg_shield',
      bay: overloadBay,
      startingHp: 30,
      maxHp: 30,
      units: piercerUnits,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'emergency_shield' }],
    });
    const expectedEmgShieldBeforeEnemy = Math.min(
      V2_MAX_BATTLE_SHIELD,
      simNoOrderPiercer.rounds[0].playerShieldAfter + V2_TACTIC_EMERGENCY_SHIELD_GAIN
    );
    expect(simEmgPiercer.rounds[1].playerShieldAfter).toBe(
      Math.max(0, expectedEmgShieldBeforeEnemy - simEmgPiercer.rounds[1].shieldAbsorbedTotal)
    );
    // Pierce mitigation: raw 4 @ 0.5 pierce = 2 pierce dmg normally vs floor(4 * 0.25) = 1 pierce dmg under emergency_shield
    expect(simNoOrderPiercer.rounds[1].enemyAttacks[0].pierceDamage).toBe(2);
    expect(simEmgPiercer.rounds[1].enemyAttacks[0].pierceDamage).toBe(1);

    // Counter synergy on emergency_shield: +8 shield (cap 20) & +2 counter bonus
    const counterBay = makeSimpleBay('shield_cruiser', [
      { id: 'c1', kind: 'counter', quality: 'common', x: 0, y: 0 },
      { id: 's1', kind: 'shield', quality: 'common', x: 1, y: 0 },
    ]);
    const simCounterBase = simulateV2Combat({
      resultId: 'ord_ctr_base',
      bay: counterBay,
      startingHp: 34,
      maxHp: 34,
      units: armoredUnits,
      targetPolicy: 'weakest',
    });
    const simCounterEmg = simulateV2Combat({
      resultId: 'ord_ctr_emg',
      bay: counterBay,
      startingHp: 34,
      maxHp: 34,
      units: armoredUnits,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'emergency_shield' }],
    });
    const expectedCtrShieldBeforeEnemy = Math.min(
      V2_MAX_BATTLE_SHIELD,
      simCounterBase.rounds[0].playerShieldAfter + 8
    );
    expect(simCounterEmg.rounds[1].playerShieldAfter).toBe(
      Math.max(0, expectedCtrShieldBeforeEnemy - simCounterEmg.rounds[1].shieldAbsorbedTotal)
    );
    // Raw counter damage gains exact +2 bonus under emergency_shield!
    expect(simCounterEmg.rounds[1].counterAttack!.rawDamage).toBe(
      simCounterBase.rounds[1].counterAttack!.rawDamage + 2
    );
    // Against 0-armor patrol, appliedDamage also reflects full +2 counter bonus
    const patrolUnits = buildEncounterUnits('patrol', 4, 'ord_ctr_pat');
    const simPatBase = simulateV2Combat({
      resultId: 'ord_ctr_pat_base',
      bay: counterBay,
      startingHp: 34,
      maxHp: 34,
      units: patrolUnits,
      targetPolicy: 'weakest',
    });
    const simPatEmg = simulateV2Combat({
      resultId: 'ord_ctr_pat_emg',
      bay: counterBay,
      startingHp: 34,
      maxHp: 34,
      units: patrolUnits,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'emergency_shield' }],
    });
    expect(simPatEmg.rounds[1].counterAttack!.appliedDamage).toBe(
      simPatBase.rounds[1].counterAttack!.appliedDamage + 2
    );

    // 3. Focus Calibrate: ignore-armor + +1 direct weapon dmg + 4 ignore-armor precision strike
    const simFocusBase = simulateV2Combat({
      resultId: 'ord_foc_base',
      bay: noShieldBay,
      startingHp: 30,
      maxHp: 30,
      units: armoredUnits,
      targetPolicy: 'weakest',
    });
    const simFocus = simulateV2Combat({
      resultId: 'ord_foc_on',
      bay: noShieldBay,
      startingHp: 30,
      maxHp: 30,
      units: armoredUnits,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'focus_calibrate' }],
    });
    const r2Focus = simFocus.rounds[1];
    const focusPrecision = r2Focus.playerAttacks.find(
      (a) => a.sourceInstanceId === 'tactic_focus_calibrate'
    );
    expect(focusPrecision).toBeDefined();
    expect(focusPrecision!.appliedDamage).toBe(V2_TACTIC_FOCUS_PRECISION_DMG);
    expect(focusPrecision!.armorBlocked).toBe(0);

    const baseLaserR2 = simFocusBase.rounds[1].playerAttacks.find((a) => a.sourceInstanceId === 'l1')!;
    const focusLaserR2 = r2Focus.playerAttacks.find((a) => a.sourceInstanceId === 'l1')!;
    expect(baseLaserR2.armorBlocked).toBe(2);
    expect(focusLaserR2.armorBlocked).toBe(0);
    // Direct weapon gains +1 dmg AND ignores 2 armor -> +3 appliedDamage over base!
    expect(focusLaserR2.appliedDamage).toBe(baseLaserR2.appliedDamage + 3);
  });

  it('verifies all 4 Hull Signature Commands including heavy_freighter EMP immunity and AoE waves', () => {
    // Verify registry completeness for all 4 ships
    expect(V2_SHIP_ORDER.length).toBe(4);
    for (const shipId of V2_SHIP_ORDER) {
      const sig = getShipSignatureCommand(shipId);
      expect(sig.choice).toBe(`signature_${shipId}`);
      expect(getTacticalCommandLabel(sig.choice, shipId)).toBe(sig.label);
    }

    // 1. cannon_skiff -> signature_cannon_skiff: +1 direct weapon dmg + 2x4 ignore-armor hits
    const armored = buildEncounterUnits('armored', 4, 'sig_arm');
    const skiffBay = makeSimpleBay('cannon_skiff', [
      { id: 'l1', kind: 'laser', quality: 'common', x: 0, y: 0 },
    ]);
    const simSkiffBase = simulateV2Combat({
      resultId: 'sig_skiff_base',
      bay: skiffBay,
      startingHp: 30,
      maxHp: 30,
      units: armored,
      targetPolicy: 'weakest',
    });
    const simSkiff = simulateV2Combat({
      resultId: 'sig_skiff',
      bay: skiffBay,
      startingHp: 30,
      maxHp: 30,
      units: armored,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'signature_cannon_skiff' }],
    });
    const sigHit1 = simSkiff.rounds[1].playerAttacks.find(
      (a) => a.sourceInstanceId === 'tactic_sig_cannon_skiff_1'
    );
    const sigHit2 = simSkiff.rounds[1].playerAttacks.find(
      (a) => a.sourceInstanceId === 'tactic_sig_cannon_skiff_2'
    );
    expect(sigHit1?.appliedDamage).toBe(4);
    expect(sigHit1?.armorBlocked).toBe(0);
    expect(sigHit2?.appliedDamage).toBe(4);
    expect(sigHit2?.armorBlocked).toBe(0);
    const skiffLaserBase = simSkiffBase.rounds[1].playerAttacks.find((a) => a.sourceInstanceId === 'l1')!;
    const skiffLaserSig = simSkiff.rounds[1].playerAttacks.find((a) => a.sourceInstanceId === 'l1')!;
    expect(skiffLaserSig.appliedDamage).toBe(skiffLaserBase.appliedDamage + 1);

    // 2. shield_cruiser -> signature_shield_cruiser: +5 shield (cap 20) + AoE ignore-armor shockwave to ALL living enemies
    const swarm = buildEncounterUnits('swarm', 4, 'sig_sw'); // 4 units of 6 HP
    const cruiserBay = makeSimpleBay('shield_cruiser', [
      { id: 's1', kind: 'shield', quality: 'improved', x: 0, y: 0 },
      { id: 's2', kind: 'shield', quality: 'common', x: 1, y: 0 },
    ]);
    const simCruiserBase = simulateV2Combat({
      resultId: 'sig_cruiser_base',
      bay: cruiserBay,
      startingHp: 34,
      maxHp: 34,
      units: swarm,
      targetPolicy: 'weakest',
    });
    const simCruiser = simulateV2Combat({
      resultId: 'sig_cruiser',
      bay: cruiserBay,
      startingHp: 34,
      maxHp: 34,
      units: swarm,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'signature_shield_cruiser' }],
    });
    const waveHits = simCruiser.rounds[1].playerAttacks.filter(
      (a) => a.sourceInstanceId === 'tactic_sig_shield_cruiser'
    );
    expect(waveHits.length).toBeGreaterThanOrEqual(3); // Hits every living swarm drone!
    for (const h of waveHits) {
      expect(h.appliedDamage).toBeGreaterThanOrEqual(4);
      expect(h.armorBlocked).toBe(0);
    }
    const expectedCruiserShieldBeforeEnemy = Math.min(
      V2_MAX_BATTLE_SHIELD,
      simCruiserBase.rounds[0].playerShieldAfter + 5
    );
    expect(simCruiser.rounds[1].playerShieldAfter).toBe(
      Math.max(0, expectedCruiserShieldBeforeEnemy - simCruiser.rounds[1].shieldAbsorbedTotal)
    );

    // 3. heavy_freighter -> signature_heavy_freighter: +5 HP (capped maxHp) + +4 shield + EMP immunity!
    const empUnits = buildEncounterUnits('emp_disruptor', 4, 'sig_emp'); // EMP drains 3 shield on odd rounds (R1, R3)
    const freighterBay = makeSimpleBay('heavy_freighter', [
      { id: 's1', kind: 'shield', quality: 'improved', x: 0, y: 0 }, // +9 shield
      { id: 's2', kind: 'shield', quality: 'improved', x: 1, y: 0 }, // +9 shield -> 18 total so R3 still has shield!
    ]);
    const simFreighterBase = simulateV2Combat({
      resultId: 'sig_fr_base',
      bay: freighterBay,
      startingHp: 20,
      maxHp: 28,
      units: empUnits,
      targetPolicy: 'weakest',
      encounterKind: 'emp_disruptor',
    });
    // Trigger signature on Round 3 (odd round = EMP pulse round!)
    const simFreighterSig = simulateV2Combat({
      resultId: 'sig_fr_emp',
      bay: freighterBay,
      startingHp: 20,
      maxHp: 28,
      units: empUnits,
      targetPolicy: 'weakest',
      encounterKind: 'emp_disruptor',
      tacticalCommands: [{ roundNumber: 3, choice: 'signature_heavy_freighter' }],
    });
    // Without signature, Round 3 EMP drains 3 shield
    const baseR3EmpDrain = simFreighterBase.rounds[2].enemyAttacks[0]?.empShieldDrained ?? 0;
    expect(baseR3EmpDrain).toBe(3);
    // With heavy_freighter signature, Round 3 heals up to +5 HP, adds +4 shield, and grants EMP immunity (0 shield drained)!
    const sigR3EmpDrain = simFreighterSig.rounds[2].enemyAttacks[0]?.empShieldDrained ?? 0;
    expect(sigR3EmpDrain).toBe(0);
    const sigR3HullDmg = simFreighterSig.rounds[2].enemyAttacks.reduce(
      (s, a) => s + a.hullDamage,
      0
    );
    expect(simFreighterSig.rounds[2].playerHpAfter).toBe(
      Math.min(28, simFreighterBase.rounds[1].playerHpAfter + 5) - sigR3HullDmg
    );
    const expectedFrShieldBeforeEnemy = Math.min(
      V2_MAX_BATTLE_SHIELD,
      simFreighterBase.rounds[1].playerShieldAfter + 4
    );
    expect(simFreighterSig.rounds[2].playerShieldAfter).toBe(
      Math.max(0, expectedFrShieldBeforeEnemy - simFreighterSig.rounds[2].shieldAbsorbedTotal)
    );

    // 4. stargate_cruiser -> signature_stargate_cruiser: +4 shield (cap 20) + AoE 7 ignore-armor wave to ALL living enemies
    const stargateBay = makeSimpleBay('stargate_cruiser', [
      { id: 's1', kind: 'shield', quality: 'common', x: 1, y: 0 },
    ]);
    const multiArmored = [
      ...buildEncounterUnits('armored', 4, 'sg_a1'),
      ...buildEncounterUnits('armored', 4, 'sg_a2'),
    ];
    const simStargateBase = simulateV2Combat({
      resultId: 'sig_stargate_base',
      bay: stargateBay,
      startingHp: 38,
      maxHp: 38,
      units: multiArmored,
      targetPolicy: 'weakest',
    });
    const simStargate = simulateV2Combat({
      resultId: 'sig_stargate',
      bay: stargateBay,
      startingHp: 38,
      maxHp: 38,
      units: multiArmored,
      targetPolicy: 'weakest',
      tacticalCommands: [{ roundNumber: 2, choice: 'signature_stargate_cruiser' }],
    });
    const sgHits = simStargate.rounds[1].playerAttacks.filter(
      (a) => a.sourceInstanceId === 'tactic_sig_stargate_cruiser'
    );
    expect(sgHits.length).toBe(2);
    for (const h of sgHits) {
      expect(h.appliedDamage).toBe(7);
      expect(h.armorBlocked).toBe(0);
    }
    const expectedSgShieldBeforeEnemy = Math.min(
      V2_MAX_BATTLE_SHIELD,
      simStargateBase.rounds[0].playerShieldAfter + 4
    );
    expect(simStargate.rounds[1].playerShieldAfter).toBe(
      Math.max(0, expectedSgShieldBeforeEnemy - simStargate.rounds[1].shieldAbsorbedTotal)
    );
  });
});

describe('M3 F09: All 9 Regular Enemy Archetypes & Deterministic Telegraphed Intents', () => {
  it('covers all 9 regular archetypes, telegraphed intent cycles, EMP drain, shield regen, and drone_carrier summon cap', () => {
    expect(V2_REGULAR_ENCOUNTER_KINDS).toEqual([
      'patrol',
      'swarm',
      'armored',
      'piercer',
      'artillery',
      'shield_regen',
      'drone_carrier',
      'emp_disruptor',
      'rammer',
    ]);

    const previewBay = makeSimpleBay('shield_cruiser', [
      { id: 's1', kind: 'shield', quality: 'improved', x: 0, y: 0 },
      { id: 'c1', kind: 'coolant_vent', quality: 'improved', x: 1, y: 0 },
    ]);

    for (const kind of V2_REGULAR_ENCOUNTER_KINDS) {
      const units = buildEncounterUnits(kind, 4, `enc_${kind}`);
      expect(units.length).toBeGreaterThanOrEqual(1);
      for (const u of units) {
        const cycle = getUnitIntentCyclePreview(u, kind);
        expect(cycle.length).toBeGreaterThanOrEqual(1);
        for (let r = 1; r <= cycle.length; r += 1) {
          expect(cycle[r - 1]).toEqual(
            resolveUnitIntentForRound({ unit: u, round: r, encounterKind: kind })
          );
        }
      }

      const sim = simulateV2Combat({
        resultId: `sim_reg_${kind}`,
        bay: previewBay,
        startingHp: 34,
        maxHp: 34,
        units,
        targetPolicy: 'weakest',
        encounterKind: kind,
      });
      expect(sim.roundsCount).toBeGreaterThanOrEqual(1);
      // Verify Round 1 telegraphed intents in round log match resolveUnitIntentForRound
      const r1Intents = sim.rounds[0].enemyIntentsThisRound ?? [];
      expect(r1Intents.length).toBeGreaterThanOrEqual(1);
      for (const logged of r1Intents) {
        const spec = units.find((u) => u.enemyId === logged.enemyId);
        if (spec) {
          expect(logged.intent.kind).toBe(
            resolveUnitIntentForRound({ unit: spec, round: 1, encounterKind: kind }).kind
          );
        }
      }
    }

    // Specific mechanics verification:
    // Artillery: odd round charge (0 dmg) -> even round heavy_volley (1.75x)
    const artUnit = buildEncounterUnits('artillery', 4, 'art_chk')[0];
    expect(resolveUnitIntentRole(artUnit)).toBe('artillery');
    expect(resolveUnitIntentForRound({ unit: artUnit, round: 1, encounterKind: 'artillery' }).kind).toBe(
      'charge'
    );
    expect(resolveUnitIntentForRound({ unit: artUnit, round: 1, encounterKind: 'artillery' }).damage).toBe(
      0
    );
    expect(resolveUnitIntentForRound({ unit: artUnit, round: 2, encounterKind: 'artillery' }).kind).toBe(
      'heavy_volley'
    );
    expect(
      resolveUnitIntentForRound({ unit: artUnit, round: 2, encounterKind: 'artillery' }).damage
    ).toBe(Math.round(artUnit.damagePerRound * 1.75));

    // Shield Regenerator: starts with shield 5/8, even round regens +4 shield
    const regenUnit = buildEncounterUnits('shield_regen', 4, 'regen_chk')[0];
    expect(resolveUnitInitialShield(regenUnit, 'shield_regen')).toEqual({
      shield: 5,
      maxShield: 8,
    });
    expect(
      resolveUnitIntentForRound({ unit: regenUnit, round: 2, encounterKind: 'shield_regen' }).kind
    ).toBe('shield_regen');
    expect(
      resolveUnitIntentForRound({ unit: regenUnit, round: 2, encounterKind: 'shield_regen' })
        .shieldGain
    ).toBe(4);

    // EMP Disruptor: odd round EMP (drain 3), even round attack
    const empUnit = buildEncounterUnits('emp_disruptor', 4, 'emp_chk')[0];
    expect(
      resolveUnitIntentForRound({ unit: empUnit, round: 1, encounterKind: 'emp_disruptor' }).kind
    ).toBe('emp');
    expect(
      resolveUnitIntentForRound({ unit: empUnit, round: 1, encounterKind: 'emp_disruptor' })
        .empShieldDrain
    ).toBe(3);
    expect(
      resolveUnitIntentForRound({ unit: empUnit, round: 2, encounterKind: 'emp_disruptor' }).kind
    ).toBe('attack');

    // Rammer: odd round charge (0.5x), even round ram (1.65x, >=0.3 pierce)
    const ramUnit = buildEncounterUnits('rammer', 4, 'ram_chk')[0];
    expect(resolveUnitIntentForRound({ unit: ramUnit, round: 1, encounterKind: 'rammer' }).kind).toBe(
      'charge'
    );
    expect(resolveUnitIntentForRound({ unit: ramUnit, round: 2, encounterKind: 'rammer' }).kind).toBe(
      'ram'
    );
    expect(
      resolveUnitIntentForRound({ unit: ramUnit, round: 2, encounterKind: 'rammer' }).pierceRatio
    ).toBeGreaterThanOrEqual(0.3);

    // Drone Carrier: 3-round cycle (attack / summon / attack) and strict summon caps (max 4 living, max 3 summons/carrier)
    const carrierUnits = buildEncounterUnits('drone_carrier', 4, 'car_chk');
    expect(carrierUnits.length).toBe(2); // hulk + 1 scout
    expect(
      resolveUnitIntentForRound({ unit: carrierUnits[0], round: 1, encounterKind: 'drone_carrier' })
        .kind
    ).toBe('attack');
    expect(
      resolveUnitIntentForRound({ unit: carrierUnits[0], round: 2, encounterKind: 'drone_carrier' })
        .kind
    ).toBe('summon');
    expect(
      resolveUnitIntentForRound({ unit: carrierUnits[0], round: 3, encounterKind: 'drone_carrier' })
        .kind
    ).toBe('attack');

    // Long tanky fight with no weapons (1 core dmg) against drone_carrier verifies summon cap <= 4 living & <= 3 total summons!
    const turtleBay = makeSimpleBay('shield_cruiser', [
      { id: 's1', kind: 'shield', quality: 'improved', x: 0, y: 0 },
      { id: 'cv1', kind: 'coolant_vent', quality: 'improved', x: 1, y: 0 },
      { id: 'cv2', kind: 'coolant_vent', quality: 'improved', x: 3, y: 0 },
    ]);
    const simCarrier = simulateV2Combat({
      resultId: 'sim_carrier_cap',
      bay: turtleBay,
      startingHp: 120,
      maxHp: 120,
      units: carrierUnits,
      targetPolicy: 'highest_threat',
      encounterKind: 'drone_carrier',
    });
    let totalSummoned = 0;
    for (const r of simCarrier.rounds) {
      totalSummoned += r.summonedEnemies?.length ?? 0;
      const aliveCount = r.enemiesAfter.filter((e) => e.hp > 0).length;
      expect(aliveCount).toBeLessThanOrEqual(4);
    }
    expect(totalSummoned).toBeGreaterThanOrEqual(1);
    expect(totalSummoned).toBeLessThanOrEqual(3);
  });
});

describe('M3 F10: All 3 Multi-Phase Act Bosses, Defeated Recording & 3-Sector Preview Parity', () => {
  it('triggers multi-phase transitions on all 3 Act Bosses (boss_anvil 2P, boss_dreadnought 2P, boss_leviathan 3P)', () => {
    expect(V3_BOSS_ORDER).toEqual(['boss_anvil', 'boss_dreadnought', 'boss_leviathan']);
    for (const bossId of V3_BOSS_ORDER) {
      expect(isV3BossId(bossId)).toBe(true);
      expect(isActBossEncounterKind(bossId)).toBe(true);
      expect(getV3BossDef(bossId)).toBe(V3_BOSS_DEFS[bossId]);
      expect(resolveV3BossDefForEncounter({ encounterKind: bossId, bossId })?.bossId).toBe(bossId);
    }

    // Moderate sustained-DPS bay so each Boss crosses EVERY phase threshold cleanly without skipping
    const steadyDpsBay = makeSimpleBay('stargate_cruiser', [
      { id: 'l1', kind: 'laser', quality: 'improved', x: 1, y: 0 },
      { id: 'b1', kind: 'battery', quality: 'improved', x: 2, y: 0 },
      { id: 's1', kind: 'shield', quality: 'improved', x: 3, y: 0 },
      { id: 'cv1', kind: 'coolant_vent', quality: 'improved', x: 1, y: 2 },
    ]);

    // 1. Act I Boss: boss_anvil (2 phases; P2 <= 16 HP -> +2 shield + 2 iron anvil drones)
    const anvilUnits = buildEncounterUnits('boss_anvil', 6, 'b1');
    const simAnvil = simulateV2Combat({
      resultId: 'sim_anvil',
      bay: steadyDpsBay,
      startingHp: 38,
      maxHp: 38,
      units: anvilUnits,
      targetPolicy: 'highest_threat',
      sectorId: 'near_orbit',
      encounterKind: 'boss_anvil',
      bossId: 'boss_anvil',
    });
    expect(simAnvil.outcome).toBe('victory');
    const anvilTransitions = simAnvil.rounds.flatMap((r) => r.bossPhaseTransitions ?? []);
    expect(anvilTransitions.some((t) => t.toPhase === 2)).toBe(true);
    const anvilSummons = simAnvil.rounds.flatMap((r) => r.summonedEnemies ?? []);
    expect(anvilSummons.some((s) => s.name.includes('铁砧无人机'))).toBe(true);

    // 2. Act II Boss: boss_dreadnought (2 phases; initial shield 4, armor 2; P2 <= 21 HP -> armor 0, +6 shield)
    const dreadUnits = buildEncounterUnits('boss_dreadnought', 6, 'b2');
    const simDread = simulateV2Combat({
      resultId: 'sim_dread',
      bay: steadyDpsBay,
      startingHp: 38,
      maxHp: 38,
      units: dreadUnits,
      targetPolicy: 'highest_threat',
      sectorId: 'frozen_graveyard',
      encounterKind: 'boss_dreadnought',
      bossId: 'boss_dreadnought',
    });
    expect(simDread.initialEnemies[0].shield).toBe(4);
    expect(simDread.initialEnemies[0].armor).toBe(2);
    const dreadP2Round = simDread.rounds.find((r) =>
      (r.bossPhaseTransitions ?? []).some((t) => t.toPhase === 2)
    );
    expect(dreadP2Round).toBeDefined();
    const dreadBossAfterP2 = dreadP2Round!.enemiesAfter.find((e) => e.isBoss)!;
    expect(dreadBossAfterP2.armor).toBe(0);
    expect(dreadBossAfterP2.shield ?? 0).toBeGreaterThanOrEqual(6);

    // 3. Act III Boss: boss_leviathan (3 phases; P2 <= 34 HP armor 0 + summon 1; P3 <= 17 HP +2 shield)
    const leviUnits = buildEncounterUnits('boss_leviathan', 6, 'b3');
    const simLevi = simulateV2Combat({
      resultId: 'sim_levi',
      bay: steadyDpsBay,
      startingHp: 46,
      maxHp: 46,
      units: leviUnits,
      targetPolicy: 'highest_threat',
      sectorId: 'stargate_abyss',
      encounterKind: 'boss_leviathan',
      bossId: 'boss_leviathan',
    });
    expect(simLevi.outcome).toBe('victory');
    const leviP2Round = simLevi.rounds.find((r) =>
      (r.bossPhaseTransitions ?? []).some((t) => t.toPhase === 2)
    );
    const leviP3Round = simLevi.rounds.find((r) =>
      (r.bossPhaseTransitions ?? []).some((t) => t.toPhase === 3)
    );
    expect(leviP2Round).toBeDefined();
    expect(leviP3Round).toBeDefined();
    expect(leviP2Round!.enemiesAfter.find((e) => e.isBoss)!.armor).toBe(0);
    expect(leviP2Round!.summonedEnemies?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('records defeatedBossIds & defeatedEnemyKinds on victory, blocks boss credit on defeat, and never mutates on tutorial/showcase', () => {
    const profile = makeUnlockedCombatProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act1',
        unlockedSectors: ['near_orbit'],
        defeatedBossIds: [],
      },
      defeatedEnemyKinds: [],
    });

    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 3401,
    });
    const run = launch.run!;
    const bossNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 6 && n.bossId === 'boss_anvil'
    )!;
    const strongBay = makeSimpleBay('stargate_cruiser', [
      { id: 'h1', kind: 'heavy', quality: 'improved', x: 1, y: 0 },
      { id: 'oc1', kind: 'overdrive_core', quality: 'improved', x: 2, y: 0 },
      { id: 's1', kind: 'shield', quality: 'improved', x: 4, y: 1 },
    ]);

    // A. Victory records boss_anvil into run + profile on safe_return
    const atBossWin: V2RunState = {
      ...run,
      currentNodeId: bossNode.nodeId,
      phase: 'ENCOUNTER',
      bay: strongBay,
      hp: 38,
      maxHp: 38,
    };
    const startedWin = startV2CombatAtCurrentNode(atBossWin, 'weakest', { pureAutoCombat: true });
    expect(startedWin.run.activeCombat!.simulation.outcome).toBe('victory');
    const doneWin = completeV2CombatAtCurrentNode(startedWin.run, profile.unlockedFamilies);
    expect(doneWin.ok).toBe(true);
    expect(doneWin.run.defeatedBossIdsThisRun).toContain('boss_anvil');
    expect(doneWin.run.defeatedEnemyKindsThisRun).toContain('boss_anvil');

    const settleWinRun: V2RunState = {
      ...doneWin.run,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      graph: {
        ...doneWin.run.graph,
        nodes: {
          ...doneWin.run.graph.nodes,
          [bossNode.nodeId]: { ...bossNode, resolved: true },
        },
      },
    };
    const appliedWin = applyV2Settlement(profile, settleWinRun);
    expect(appliedWin.profile.campaign.defeatedBossIds).toContain('boss_anvil');
    expect(appliedWin.profile.defeatedEnemyKinds).toContain('boss_anvil');
    expect(appliedWin.profile.career.totalBossesDefeated).toBe(1);

    // B. Defeat must NOT credit defeatedBossIds, while earlier regular enemy kills remain in Bestiary
    const weakBay = makeSimpleBay('cannon_skiff', []);
    const atBossDefeat: V2RunState = {
      ...run,
      currentNodeId: bossNode.nodeId,
      phase: 'ENCOUNTER',
      bay: weakBay,
      hp: 5,
      maxHp: 30,
      defeatedEnemyKindsThisRun: ['patrol'],
    };
    const startedLose = startV2CombatAtCurrentNode(atBossDefeat, 'weakest', {
      pureAutoCombat: true,
    });
    expect(startedLose.run.activeCombat!.simulation.outcome).toBe('defeat');
    const doneLose = completeV2CombatAtCurrentNode(startedLose.run, profile.unlockedFamilies);
    expect(doneLose.ok).toBe(true);
    expect(doneLose.run.defeatedBossIdsThisRun ?? []).not.toContain('boss_anvil');
    const appliedDefeat = applyV2Settlement(profile, doneLose.run);
    expect(appliedDefeat.profile.campaign.defeatedBossIds).not.toContain('boss_anvil');
    expect(appliedDefeat.profile.career.totalBossesDefeated).toBe(0);
    expect(appliedDefeat.profile.defeatedEnemyKinds).toContain('patrol');

    // C. Tutorial & Showcase NEVER record defeatedBossIds or defeatedEnemyKinds
    const showcase = createV2ShowcaseRun('trial_heavy', 'iso_show');
    const showSettle: V2RunState = {
      ...showcase,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      defeatedBossIdsThisRun: ['boss_anvil'],
      defeatedEnemyKindsThisRun: ['patrol', 'boss_anvil'],
    };
    const appliedShow = applyV2Settlement(profile, showSettle);
    expect(appliedShow.profile).toBe(profile);

    const tut = createV2TutorialRun('tut_iso_777');
    const tutSettle: V2RunState = {
      ...tut,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      defeatedBossIdsThisRun: ['boss_anvil'],
      defeatedEnemyKindsThisRun: ['patrol', 'boss_anvil'],
    };
    const appliedTut = applyV2Settlement(profile, tutSettle);
    expect(appliedTut.profile.campaign.defeatedBossIds).not.toContain('boss_anvil');
    expect(appliedTut.profile.defeatedEnemyKinds).not.toContain('boss_anvil');
  });

  it('guarantees 100% deterministic preview === tacticalDelta === live combat execution parity across all 3 sectors', () => {
    const profile = makeUnlockedCombatProfile();
    const sectors: readonly SectorId[] = ['near_orbit', 'frozen_graveyard', 'stargate_abyss'];

    for (let i = 0; i < sectors.length; i += 1) {
      const sectorId = sectors[i];
      const launch = launchV2Expedition({
        profile,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
        sectorId,
        seed: 3500 + i * 17,
      });
      expect(launch.ok && launch.run).toBeTruthy();
      const run = launch.run!;

      // Test BOTH a regular combat node AND the Layer 6 Act Boss node in every sector
      const combatNodes = Object.values(run.graph.nodes).filter((n) => Boolean(n.combat));
      const regularNode = combatNodes.find((n) => n.layer < 6 && !n.bossId);
      const bossNode = combatNodes.find((n) => n.layer === 6 && n.bossId === V3_BOSS_ORDER[i]);
      expect(regularNode).toBeDefined();
      expect(bossNode).toBeDefined();

      const relayTier = 2;
      for (const node of [regularNode!, bossNode!]) {
        const atNode: V2RunState = {
          ...run,
          currentNodeId: node.nodeId,
          phase: 'ENCOUNTER',
        };
        const preview = previewV2CombatNode(atNode, node.nodeId, 'weakest', {
          stargateRelayTier: relayTier,
        });
        expect(preview).not.toBeNull();
        expect(preview!.sectorId).toBe(sectorId);

        const live = startV2CombatAtCurrentNode(atNode, 'weakest', {
          pureAutoCombat: true,
          stargateRelayTier: relayTier,
        });
        expect(live.ok).toBe(true);
        const liveSim = live.run.activeCombat!.simulation;
        expect(liveSim.outcome).toBe(preview!.outcome);
        expect(liveSim.roundsCount).toBe(preview!.roundsCount);
        expect(liveSim.finalPlayerHp).toBe(preview!.finalPlayerHp);
        expect(liveSim.finalPlayerHpAfterRepair).toBe(preview!.finalPlayerHpAfterRepair);
        expect(liveSim.startingPlayerShield).toBe(preview!.startingPlayerShield);
        expect(liveSim.rounds.length).toBe(preview!.rounds.length);
      }

      // True 3-way preview === tacticalDelta === live parity on exact first reachable combat node
      const nextCombatParent = Object.values(run.graph.nodes).find((parent) =>
        parent.nextNodeIds.some((cid) => Boolean(run.graph.nodes[cid]?.combat))
      );
      expect(nextCombatParent).toBeDefined();
      const mapRun: V2RunState = {
        ...run,
        currentNodeId: nextCombatParent!.nodeId,
        phase: 'MAP',
        graph: {
          ...run.graph,
          nodes: {
            ...run.graph.nodes,
            [nextCombatParent!.nodeId]: { ...nextCombatParent!, resolved: true },
          },
        },
      };
      const targetCombatId = getReachableNextNodeIds(mapRun).find((nid) =>
        Boolean(mapRun.graph.nodes[nid]?.combat)
      );
      expect(targetCombatId).toBeDefined();

      const candidateEq = createV2EquipmentInstance({
        instanceId: `delta_eq_${sectorId}`,
        kind: 'laser',
        quality: 'improved',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'staging',
      });
      const delta = computeV2PlacementTacticalDelta({
        run: mapRun,
        bay: mapRun.bay,
        startingHp: mapRun.hp,
        maxHp: mapRun.maxHp,
        targetPolicy: 'weakest',
        item: candidateEq,
        zone: 'staging',
        sectorId,
        crewId: mapRun.crewId,
        crewMasteryTier: mapRun.crewMasteryTier,
        stargateRelayTier: relayTier,
      });
      expect(delta.recommendedSpot).toBeDefined();
      const spot = delta.recommendedSpot!;
      const placedRes = placeV2FromStaging(
        addV2ItemToStaging(mapRun.bay, candidateEq, spot.rotation),
        candidateEq.instanceId,
        spot.x,
        spot.y,
        spot.rotation
      );
      expect(placedRes.ok).toBe(true);
      const afterBay = placedRes.bay;

      const beforePrev = previewV2CombatNode(mapRun, targetCombatId!, 'weakest', {
        stargateRelayTier: relayTier,
      })!;
      const afterPrev = previewV2CombatNode({ ...mapRun, bay: afterBay }, targetCombatId!, 'weakest', {
        stargateRelayTier: relayTier,
      })!;
      const liveAfter = startV2CombatAtCurrentNode(
        { ...mapRun, currentNodeId: targetCombatId!, phase: 'ENCOUNTER', bay: afterBay },
        'weakest',
        { pureAutoCombat: true, stargateRelayTier: relayTier }
      );
      expect(liveAfter.ok).toBe(true);
      const liveAfterSim = liveAfter.run.activeCombat!.simulation;
      expect(afterPrev.outcome).toBe(liveAfterSim.outcome);
      expect(afterPrev.roundsCount).toBe(liveAfterSim.roundsCount);
      expect(afterPrev.finalPlayerHp).toBe(liveAfterSim.finalPlayerHp);
      expect(afterPrev.finalPlayerHpAfterRepair).toBe(liveAfterSim.finalPlayerHpAfterRepair);

      // Exact numeric delta string parity between tacticalDelta and beforePrev/afterPrev
      if (beforePrev.outcome === 'defeat' && afterPrev.outcome === 'victory') {
        expect(delta.combatDeltaLine).toContain(
          `由败转胜（余 ${afterPrev.finalPlayerHpAfterRepair} 耐久 · ${afterPrev.roundsCount} 轮）`
        );
      } else if (beforePrev.outcome === 'victory' && afterPrev.outcome === 'defeat') {
        expect(delta.combatDeltaLine).toContain('将转为战败');
      } else {
        const roundDiff = beforePrev.roundsCount - afterPrev.roundsCount;
        const hpSaved = afterPrev.finalPlayerHpAfterRepair - beforePrev.finalPlayerHpAfterRepair;
        const expectedParts: string[] = [];
        if (roundDiff > 0) expectedParts.push(`少打 ${roundDiff} 回合`);
        else if (roundDiff < 0) expectedParts.push(`多打 ${Math.abs(roundDiff)} 回合`);
        if (hpSaved > 0) expectedParts.push(`少损 ${hpSaved} 耐久`);
        else if (hpSaved < 0) expectedParts.push(`多损 ${Math.abs(hpSaved)} 耐久`);
        if (expectedParts.length === 0) {
          expect(delta.combatDeltaLine).toContain(
            `战果持平（${afterPrev.roundsCount} 轮 · 余 ${afterPrev.finalPlayerHpAfterRepair} 耐久）`
          );
        } else {
          expect(delta.combatDeltaLine).toContain(expectedParts.join('，'));
        }
      }

      // Verify buildSectorEnemyEncounter deterministic boss mapping per sector
      const rng1 = new SeededRng(900 + i);
      const rng2 = new SeededRng(900 + i);
      const b1 = buildSectorEnemyEncounter(sectorId, 6, 'elite', rng1, 0);
      const b2 = buildSectorEnemyEncounter(sectorId, 6, 'elite', rng2, 0);
      expect(b1).toEqual(b2);
      expect(b1.bossId).toBe(V3_BOSS_ORDER[i]);
    }

    // Fix B regression: exact Relay T3 divergence repro (cannon_skiff hp=15, laser.common, 17-HP 4-dmg enemy)
    // Proves previewV2CombatNode, live startV2CombatAtCurrentNode, AND computeV2PlacementTacticalDelta ALL agree on VICTORY (3 轮 · 余 3 耐久)!
    const relayT3Profile = makeUnlockedCombatProfile({
      facilityTiers: { ...makeUnlockedCombatProfile().facilityTiers, stargate_relay: 3 },
    });
    const relayLaunch = launchV2Expedition({
      profile: relayT3Profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 3599,
    }).run!;
    const relayBay = makeSimpleBay('cannon_skiff', [
      { id: 'relay_l1', kind: 'laser', quality: 'common', x: 0, y: 0 },
    ]);
    const l1a = relayLaunch.graph.nodes['L1A'];
    const customRelayRun: V2RunState = {
      ...relayLaunch,
      hp: 15,
      maxHp: 30,
      bay: relayBay,
      currentNodeId: null,
      phase: 'MAP',
      graph: {
        ...relayLaunch.graph,
        startNextNodeIds: ['L1A'],
        nodes: {
          ...relayLaunch.graph.nodes,
          L1A: {
            ...l1a,
            type: 'combat',
            resolved: false,
            combat: {
              encounterKind: 'patrol',
              bounty: 20,
              improvedProb: 0,
              units: [
                {
                  enemyId: 'relay_probe_1',
                  name: '巡逻艇',
                  spriteArchetype: 'scout',
                  maxHp: 17,
                  damagePerRound: 4,
                  armor: 0,
                  pierceRatio: 0,
                },
              ],
            },
          },
        },
      },
    };
    const previewT3 = previewV2CombatNode(customRelayRun, 'L1A', 'weakest', {
      stargateRelayTier: 3,
    })!;
    expect(previewT3.outcome).toBe('victory');
    expect(previewT3.roundsCount).toBe(3);
    expect(previewT3.finalPlayerHpAfterRepair).toBe(3);

    const liveT3 = startV2CombatAtCurrentNode(
      { ...customRelayRun, currentNodeId: 'L1A', phase: 'ENCOUNTER' },
      'weakest',
      { pureAutoCombat: true, stargateRelayTier: 3 }
    );
    expect(liveT3.ok).toBe(true);
    expect(liveT3.run.activeCombat!.simulation.outcome).toBe('victory');
    expect(liveT3.run.activeCombat!.simulation.roundsCount).toBe(3);
    expect(liveT3.run.activeCombat!.simulation.finalPlayerHpAfterRepair).toBe(3);

    const stagedBat = createV2EquipmentInstance({
      instanceId: 'relay_bat_probe',
      kind: 'battery',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const deltaT3 = computeV2PlacementTacticalDelta({
      run: customRelayRun,
      bay: relayBay,
      startingHp: 15,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: stagedBat,
      zone: 'staging',
      candidateSpot: { x: 3, y: 3, rotation: 0 },
      stargateRelayTier: 3,
    });
    expect(deltaT3.combatDeltaLine).toContain('战果持平（3 轮 · 余 3 耐久）');

    // Contrast with stargateRelayTier: 0 (loses in 4 rounds with 0 HP) — confirms Relay T3 genuinely drives parity
    const deltaT0 = computeV2PlacementTacticalDelta({
      run: customRelayRun,
      bay: relayBay,
      startingHp: 15,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: stagedBat,
      zone: 'staging',
      candidateSpot: { x: 3, y: 3, rotation: 0 },
      stargateRelayTier: 0,
    });
    expect(deltaT0.combatDeltaLine).toContain('战果持平（4 轮 · 余 0 耐久）');

    // Also verify zone='grid' (installed_value) forwards stargateRelayTier accurately (flips defeat -> victory at T3!)
    const gridDeltaT3 = computeV2PlacementTacticalDelta({
      run: customRelayRun,
      bay: relayBay,
      startingHp: 15,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: relayBay.placed[0].item,
      zone: 'grid',
      stargateRelayTier: 3,
    });
    expect(gridDeltaT3.combatDeltaLine).toContain('由败转胜（余 3 耐久 · 3 轮）');
    const gridDeltaT0 = computeV2PlacementTacticalDelta({
      run: customRelayRun,
      bay: relayBay,
      startingHp: 15,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: relayBay.placed[0].item,
      zone: 'grid',
      stargateRelayTier: 0,
    });
    expect(gridDeltaT0.combatDeltaLine).toContain('战果持平（4 轮 · 余 0 耐久）');

    // Verify ship catalog sanity referenced by tactical UI
    expect(V2_SHIPS.stargate_cruiser.maxHp).toBe(38);
  });
});
