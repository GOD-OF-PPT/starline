import { describe, expect, it } from 'vitest';
import { V2_SHIP_ORDER } from '../src/v2/data/ships';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import {
  buildTrialPrepareSlots,
  getTrialDemoUnits,
  V2_TRIAL_BUILD_ORDER,
  V2_TRIAL_BUILDS,
} from '../src/v2/data/trialBuilds';
import { calculateV2BuildStats } from '../src/v2/domain/buildStatsV2';
import {
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  resolveV2WreckChoice,
  selectV2MapNode,
} from '../src/v2/domain/encounter';
import { createV2CargoInstance, createV2EquipmentInstance } from '../src/v2/domain/itemCatalog';
import { launchV2Expedition, validateV2PrepareLoadout } from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import { deriveV2ShipVisualSpec } from '../src/v2/domain/shipVisualSpec';
import { computeV2PlacementTacticalDelta } from '../src/v2/domain/tacticalDelta';
import type { V2CargoBayState, V2RunState } from '../src/v2/domain/types';

describe('V2 Polish Phase B & D Domain Rules', () => {
  it('Trial builds are budget-legal, orthogonally linked, and launchable on all 3 ships without unlocking blueprints', () => {
    const baseProfile = {
      ...createFreshV2Profile(),
      unlockedShips: [...V2_SHIP_ORDER],
      tutorialCompleted: true,
    };

    for (const shipId of V2_SHIP_ORDER) {
      for (const trialId of V2_TRIAL_BUILD_ORDER) {
        const slots = buildTrialPrepareSlots(trialId, shipId);
        expect(slots.length).toBeGreaterThanOrEqual(2);

        // Without trialBuildId, locked heavy/hangar/counter blueprints MUST still be rejected!
        const withoutTrial = validateV2PrepareLoadout(baseProfile, shipId, 'engineer', slots, null);
        expect(withoutTrial.valid).toBe(false);

        // With trialBuildId, exact common loan kit within budget is authorized
        const withTrial = validateV2PrepareLoadout(baseProfile, shipId, 'engineer', slots, trialId);
        expect(withTrial.valid).toBe(true);
        expect(withTrial.totalBudget).toBeLessThanOrEqual(withTrial.maxBudget);

        const launched = launchV2Expedition({
          profile: baseProfile,
          contractTemplateId: 'free_salvage',
          shipId,
          crewId: 'engineer',
          primaryArchetype: V2_TRIAL_BUILDS[trialId].archetypeId,
          slots,
          trialBuildId: trialId,
          seed: 778899,
        });
        expect(launched.ok).toBe(true);
        expect(launched.run).not.toBeNull();
        expect(launched.run!.trialBuildId).toBe(trialId);

        // Every trial build must have >= 1 active synergy link right out of the box!
        const stats = calculateV2BuildStats(launched.run!.bay);
        expect(stats.links.length).toBeGreaterThanOrEqual(1);
        for (const placed of launched.run!.bay.placed) {
          expect(placed.item.origin).toBe('loan');
          expect(placed.item.fixedValue).toBe(0);
          expect(placed.item.quality).toBe('common');
        }

        // Demo units must simulate cleanly
        const demoSim = simulateV2Combat({
          resultId: `demo_${shipId}_${trialId}`,
          bay: launched.run!.bay,
          startingHp: launched.run!.maxHp,
          maxHp: launched.run!.maxHp,
          units: getTrialDemoUnits(trialId),
          targetPolicy: 'weakest',
        });
        expect(demoSim.roundsCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('Trial builds strictly reject improved loans or unauthorized locked equipment mixing', () => {
    const profile = createFreshV2Profile();
    const badImproved = [
      {
        slotKey: 'bad_1',
        origin: 'loan' as const,
        definitionId: 'equipment.heavy.improved',
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
    ];
    expect(
      validateV2PrepareLoadout(profile, 'cannon_skiff', 'engineer', badImproved, 'trial_heavy').valid
    ).toBe(false);

    const badCrossMix = [
      {
        slotKey: 'bad_2',
        origin: 'loan' as const,
        definitionId: 'equipment.hangar.common',
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
    ];
    expect(
      validateV2PrepareLoadout(profile, 'cannon_skiff', 'engineer', badCrossMix, 'trial_heavy').valid
    ).toBe(false);
  });

  it('3-room Wreck salvage supports Reactor Fuel (+2) and Reactor Repair (+8) with zero-gain guard and idempotency', () => {
    let run = createV2ShowcaseRun('trial_heavy', 'wreck_test');
    // Jump to L1B (wreck) -> fuel becomes 8/10
    const enter = selectV2MapNode(run, 'L1B');
    expect(enter.ok).toBe(true);
    run = { ...enter.run, hp: 20 };

    // Reactor fuel grants +2 fuel (8 -> 10)
    const fuelRes = resolveV2WreckChoice(run, 'reactor_fuel', ['core']);
    expect(fuelRes.ok).toBe(true);
    expect(fuelRes.run.fuel).toBe(10);
    expect(fuelRes.run.phase).toBe('ARRANGE');
    expect(fuelRes.run.graph.nodes['L1B'].wreck?.chosenRoom).toBe('reactor_fuel');

    // Re-claiming same wreck is rejected (idempotent)
    const dupRes = resolveV2WreckChoice(
      { ...fuelRes.run, phase: 'ENCOUNTER' },
      'armory',
      ['core']
    );
    expect(dupRes.ok).toBe(false);

    // Zero-gain guard: at full fuel (10/10), reactor_fuel must refuse rather than waste room
    const fullFuelRun: V2RunState = { ...run, fuel: run.maxFuel };
    const refusedFuel = resolveV2WreckChoice(fullFuelRun, 'reactor_fuel', ['core']);
    expect(refusedFuel.ok).toBe(false);

    // Reactor repair grants +8 HP (20 -> 28)
    const repairRes = resolveV2WreckChoice(run, 'reactor_repair', ['core']);
    expect(repairRes.ok).toBe(true);
    expect(repairRes.run.hp).toBe(28);
    expect(repairRes.run.graph.nodes['L1B'].wreck?.chosenRoom).toBe('reactor_repair');
  });

  it('deriveV2ShipVisualSpec maps placed cargo bay equipment & mission cargo accurately without guessing', () => {
    const bay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createV2EquipmentInstance({
            instanceId: 'h1',
            kind: 'heavy',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 0,
          y: 0,
          rotation: 0,
        },
        {
          item: createV2EquipmentInstance({
            instanceId: 'c1',
            kind: 'capacitor',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 1,
          y: 0,
          rotation: 0,
        },
        {
          item: createV2CargoInstance({
            instanceId: 'm1',
            defId: 'mission.sealed_reactor',
            origin: 'mission',
            acquiredDepth: 3,
            location: 'bay',
            missionBinding: 'c_1',
          }),
          x: 2,
          y: 0,
          rotation: 0,
        },
      ],
      staging: [],
      discardedThisArrange: [],
    };

    const spec = deriveV2ShipVisualSpec(bay);
    expect(spec.heavyCount).toBe(1);
    expect(spec.heavyBoosted).toBe(true);
    expect(spec.hasSealedReactor).toBe(true);
    expect(spec.cargoMassTier).toBe(2);
    expect(spec.mountSummaryTags.some((t) => t.includes('磁轨重炮'))).toBe(true);
    expect(spec.mountSummaryTags.some((t) => t.includes('密封反应堆'))).toBe(true);
  });

  it('computeV2PlacementTacticalDelta reports concrete simulated round/HP delta and recommended synergy slot', () => {
    const baseBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createV2EquipmentInstance({
            instanceId: 'h1',
            kind: 'heavy',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
      staging: [],
      discardedThisArrange: [],
    };
    const cap = createV2EquipmentInstance({
      instanceId: 'cap_stage',
      kind: 'capacitor',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });

    const delta = computeV2PlacementTacticalDelta({
      run: null,
      bay: baseBay,
      startingHp: 30,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: cap,
      zone: 'staging',
    });

    expect(delta.recommendedSpot).toBeDefined();
    expect(delta.synergyLine).toContain('先手');
    expect(delta.combatDeltaLine).toMatch(/少打|少损|由败转胜/);
    expect(delta.positiveImpact).toBe(true);
  });

  it('4-layer Showcase run validates cleanly and spans all 4 layers without corrupting save validation', () => {
    for (const trialId of V2_TRIAL_BUILD_ORDER) {
      const run = createV2ShowcaseRun(trialId, `sc_${trialId}`);
      expect(run.isShowcase).toBe(true);
      expect(run.graph.maxLayers).toBe(4);
      expect(Object.keys(run.graph.nodes).length).toBe(8);
      const save = { ...createFreshV2SaveData(), activeRun: run };
      expect(validateV2SaveDataDetailed(save).ok).toBe(true);
    }
  });

  it('Phase D Elite Round-2 tactical decision triggers cleanly, enforces 3-point survival cost, blocks premature completion, and is idempotent', () => {
    // Build a showcase run with trial_counter (shield 6 + counter 4 = 10 starting shield + laser!) and teleport cleanly into Elite L4A
    const baseRun = createV2ShowcaseRun('trial_counter', 'elite_tactic_test');
    const atElite: V2RunState = {
      ...baseRun,
      currentNodeId: 'L4A',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'],
      phase: 'ENCOUNTER',
    };

    const started = startV2CombatAtCurrentNode(atElite, 'weakest', { enableEliteTactic: true });
    expect(started.ok).toBe(true);
    const pending = started.run.activeCombat?.pendingDecision;
    expect(pending).not.toBeNull();
    expect(pending!.roundNumber).toBe(2);
    expect(pending!.chosen).toBeNull();
    expect(pending!.options.length).toBe(4);
    expect(pending!.options.map((o) => o.choice)).toEqual([
      'overload',
      'emergency_shield',
      'focus_calibrate',
      'signature_cannon_skiff',
    ]);

    // Starting shield 10, Elite R1 enemy total dmg = 4 + 1 + 1 = 6 -> R1 end shield = 4, hp+shield = 34 > 3 -> Overload enabled!
    expect(pending!.playerShieldAtPause).toBe(4);
    const overloadOpt = pending!.options.find((o) => o.choice === 'overload')!;
    expect(overloadOpt.enabled).toBe(true);

    // Completing combat BEFORE deciding MUST be rejected!
    const premature = completeV2CombatAtCurrentNode(started.run, ['core']);
    expect(premature.ok).toBe(false);

    // Emergency Defense test: +5 (+2 counter synergy = +7) shield, pauses direct guns, preserves Counter (+2 bonus)!
    const defSim = simulateV2Combat({
      resultId: 'chk_def',
      bay: atElite.bay,
      startingHp: atElite.hp,
      maxHp: atElite.maxHp,
      units: atElite.graph.nodes['L4A'].combat!.units,
      targetPolicy: 'weakest',
      round2Tactic: 'emergency_defense',
    });
    const r2Def = defSim.rounds[1];
    expect(r2Def).toBeDefined();
    expect(r2Def.playerAttacks.length).toBe(0); // Direct guns paused during full-shield defense
    expect(r2Def.counterAttack).not.toBeNull(); // Supercharged Counter retained!
    expect(r2Def.playerShieldAfter).toBeGreaterThan(pending!.playerShieldAtPause);

    // Commit Overload decision (9 armor-piercing damage!)
    const committed = commitV2EliteTacticDecision(started.run, pending!.decisionId, 'overload');
    expect(committed.ok).toBe(true);
    expect(committed.run.activeCombat!.pendingDecision!.chosen).toBe('overload');
    expect(committed.run.activeCombat!.simulation.appliedTactic).toBe('overload');
    const overloadHit = committed.run.activeCombat!.simulation.rounds[1].playerAttacks.find(
      (a) => a.sourceInstanceId === 'tactic_overload'
    );
    expect(overloadHit).toBeDefined();
    expect(overloadHit!.appliedDamage).toBe(9);
    expect(overloadHit!.armorBlocked).toBe(0);

    // Save validation passes with pendingDecision committed
    const saveCheck = validateV2SaveDataDetailed({
      ...createFreshV2SaveData(),
      activeRun: committed.run,
    });
    expect(saveCheck.ok).toBe(true);

    // Duplicate commit MUST be rejected (idempotency on refresh/double-click!)
    const dupCommit = commitV2EliteTacticDecision(
      committed.run,
      pending!.decisionId,
      'emergency_shield'
    );
    expect(dupCommit.ok).toBe(false);

    // Now completing combat succeeds cleanly!
    const finished = completeV2CombatAtCurrentNode(committed.run, ['core']);
    expect(finished.ok).toBe(true);

    // Also verify Overload is disabled when Round-1 remaining HP + shield <= 3 (near-death self-destruct guard)
    const noShieldBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createV2EquipmentInstance({
            instanceId: 'l1',
            kind: 'laser',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
      staging: [],
      discardedThisArrange: [],
    };
    const lowSurvivalStart = startV2CombatAtCurrentNode(
      { ...atElite, hp: 9, bay: noShieldBay }, // takes 6 dmg in R1 -> 3 HP + 0 shield <= 3!
      'weakest',
      { enableEliteTactic: true }
    );
    const lowOverload = lowSurvivalStart.run.activeCombat?.pendingDecision?.options.find(
      (o) => o.choice === 'overload'
    );
    expect(lowOverload?.enabled).toBe(false);
  });

  it('Elite Round-2 tactical pause survives full save/reload round-trip before and after decision without double-applying bonuses', () => {
    const store = new Map<string, string>();
    const memStorage: V2StorageLike = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
    };

    const run = createV2ShowcaseRun('trial_counter');
    const atElite: V2RunState = {
      ...run,
      isShowcase: false,
      phase: 'ENCOUNTER',
      currentNodeId: 'L4A',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'],
    };

    const started = startV2CombatAtCurrentNode(atElite, 'weakest', { enableEliteTactic: true });
    expect(started.ok).toBe(true);
    const pendingBefore = started.run.activeCombat?.pendingDecision;
    expect(pendingBefore?.chosen).toBeNull();

    // 1. Persist right at Round-2 pause boundary (simulating F5 mid-pause!)
    const saveMidPause = { ...createFreshV2SaveData(), activeRun: started.run };
    expect(persistV2SaveData(memStorage, saveMidPause).ok).toBe(true);
    const reloadedMidPause = loadV2SaveData(memStorage);
    expect(reloadedMidPause.status).toBe('loaded');
    if (reloadedMidPause.status !== 'loaded') return;

    const restoredRun = reloadedMidPause.data.activeRun!;
    expect(restoredRun.activeCombat?.pendingDecision?.decisionId).toBe(pendingBefore!.decisionId);
    expect(restoredRun.activeCombat?.pendingDecision?.chosen).toBeNull();

    // Wrong decisionId MUST be rejected
    expect(commitV2EliteTacticDecision(restoredRun, 'wrong_id', 'overload').ok).toBe(false);

    // 2. Commit Emergency Shield once -> persist -> reload
    const committed = commitV2EliteTacticDecision(
      restoredRun,
      pendingBefore!.decisionId,
      'emergency_shield'
    );
    expect(committed.ok).toBe(true);
    expect(committed.run.activeCombat?.pendingDecision?.chosen).toBe('emergency_shield');

    expect(
      persistV2SaveData(memStorage, { ...reloadedMidPause.data, activeRun: committed.run }).ok
    ).toBe(true);
    const reloadedPostCommit = loadV2SaveData(memStorage);
    expect(reloadedPostCommit.status).toBe('loaded');
    if (reloadedPostCommit.status !== 'loaded') return;

    const postCommitRun = reloadedPostCommit.data.activeRun!;
    expect(postCommitRun.activeCombat?.pendingDecision?.chosen).toBe('emergency_shield');
    // Re-committing after reload MUST fail so bonuses can NEVER stack!
    expect(
      commitV2EliteTacticDecision(postCommitRun, pendingBefore!.decisionId, 'emergency_shield').ok
    ).toBe(false);
    expect(
      commitV2EliteTacticDecision(postCommitRun, pendingBefore!.decisionId, 'overload').ok
    ).toBe(false);
  });

  it('Balance Fix Regression: Owned common -1 budget advantage, strict whole-kit trial non-mixing, Hangar multi-target spillover, monotonic cargo density, and 3-way Elite tactic non-dominance', async () => {
    const { V2_CARGO_DEFS } = await import('../src/v2/data/cargo');
    const { V2_SHAPES } = await import('../src/v2/data/shapes');
    const { buildEncounterUnits } = await import('../src/v2/data/enemies');

    // 1. Owned common equipment enjoys -1 budget discount (min 1) over lossless free loan
    const ownedHeavy = createV2EquipmentInstance({
      instanceId: 'wh_heavy_1',
      kind: 'heavy',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'warehouse',
    });
    const ownedShield = createV2EquipmentInstance({
      instanceId: 'wh_shield_1',
      kind: 'shield',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'warehouse',
    });
    const profileWithOwned = {
      ...createFreshV2Profile(),
      blueprints: ['laser', 'battery', 'shield', 'repair', 'heavy', 'capacitor'] as const,
      equipmentWarehouse: [ownedHeavy, ownedShield],
    };
    // Loan heavy(3) + cap(1) + shield(2) + laser(2) = 8 > 6 (rejected),
    // Owned heavy(2) + loan cap(1) + owned shield(1) + loan laser(2) = 6 <= 6 (legal!)
    const ownedCombo = validateV2PrepareLoadout(profileWithOwned, 'cannon_skiff', 'engineer', [
      { slotKey: 'oh', origin: 'owned', definitionId: 'equipment.heavy.common', warehouseInstanceId: ownedHeavy.instanceId, x: 0, y: 0, rotation: 0 },
      { slotKey: 'lc', origin: 'loan', definitionId: 'equipment.capacitor.common', x: 1, y: 0, rotation: 0 },
      { slotKey: 'os', origin: 'owned', definitionId: 'equipment.shield.common', warehouseInstanceId: ownedShield.instanceId, x: 2, y: 0, rotation: 0 },
      { slotKey: 'll', origin: 'loan', definitionId: 'equipment.laser.common', x: 3, y: 0, rotation: 0 },
    ]);
    expect(ownedCombo.valid).toBe(true);
    expect(ownedCombo.totalBudget).toBe(6);

    // 2. Trial mode rejects partial-kit removal or mixing with owned items, while allowing bay repositioning
    const heavyTrialSlots = buildTrialPrepareSlots('trial_heavy', 'cannon_skiff');
    const repositionedTrial = heavyTrialSlots.map((s) => ({ ...s, x: s.x + 1 }));
    expect(
      validateV2PrepareLoadout(profileWithOwned, 'cannon_skiff', 'engineer', repositionedTrial, 'trial_heavy').valid
    ).toBe(true);
    const partialTrial = heavyTrialSlots.slice(0, 2);
    expect(
      validateV2PrepareLoadout(profileWithOwned, 'cannon_skiff', 'engineer', partialTrial, 'trial_heavy').valid
    ).toBe(false);
    const mixedOwnedTrial = [
      ...heavyTrialSlots.slice(0, 2),
      { slotKey: 'mix', origin: 'owned' as const, definitionId: 'equipment.shield.common', warehouseInstanceId: ownedShield.instanceId, x: 2, y: 0, rotation: 0 as const },
    ];
    expect(
      validateV2PrepareLoadout(profileWithOwned, 'cannon_skiff', 'engineer', mixedOwnedTrial, 'trial_heavy').valid
    ).toBe(false);

    // 3. Hangar drones switch targets on kill vs 4-unit Swarm (beating Heavy in rounds & HP!)
    const hangarBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: buildTrialPrepareSlots('trial_hangar', 'cannon_skiff').map((s, i) => ({
        item: createV2EquipmentInstance({
          instanceId: `hg_${i}`,
          kind: s.definitionId.split('.')[1] as Parameters<typeof createV2EquipmentInstance>[0]['kind'],
          quality: 'common',
          origin: 'loan',
          acquiredDepth: 0,
          location: 'bay',
        }),
        x: s.x,
        y: s.y,
        rotation: s.rotation,
      })),
      staging: [],
      discardedThisArrange: [],
    };
    const heavyBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: buildTrialPrepareSlots('trial_heavy', 'cannon_skiff').map((s, i) => ({
        item: createV2EquipmentInstance({
          instanceId: `hv_${i}`,
          kind: s.definitionId.split('.')[1] as Parameters<typeof createV2EquipmentInstance>[0]['kind'],
          quality: 'common',
          origin: 'loan',
          acquiredDepth: 0,
          location: 'bay',
        }),
        x: s.x,
        y: s.y,
        rotation: s.rotation,
      })),
      staging: [],
      discardedThisArrange: [],
    };
    const swarmL3 = buildEncounterUnits('swarm', 3, 'reg_sw');
    const simHangarSwarm = simulateV2Combat({ resultId: 'hs', bay: hangarBay, startingHp: 30, maxHp: 30, units: swarmL3, targetPolicy: 'weakest' });
    const simHeavySwarm = simulateV2Combat({ resultId: 'vs', bay: heavyBay, startingHp: 30, maxHp: 30, units: swarmL3, targetPolicy: 'weakest' });
    expect(simHangarSwarm.roundsCount).toBeLessThan(simHeavySwarm.roundsCount);
    expect(simHangarSwarm.finalPlayerHp).toBeGreaterThan(simHeavySwarm.finalPlayerHp);

    // 4. Monotonic cargo value-per-cell density ladder (larger/awkward shapes >= smaller easy shapes)
    const density = (id: string) =>
      V2_CARGO_DEFS[id].layer1BasePrice / V2_SHAPES[V2_CARGO_DEFS[id].shapeId].cells.length;
    expect(density('cargo.data_box')).toBeLessThan(density('cargo.alloy_bar'));
    expect(density('cargo.alloy_bar')).toBeLessThan(density('cargo.old_engine'));
    expect(density('cargo.old_engine')).toBeLessThan(density('cargo.coolant_tank'));
    expect(density('cargo.coolant_tank')).toBeLessThan(density('cargo.folding_antenna'));

    // 5. All 3 Elite Round-2 tactics (normal / overload / emergency_defense) strictly win distinct archetypes (no single dominant tactic!)
    const eliteUnits = buildEncounterUnits('elite', 6, 'reg_el');
    const makeBay = (specs: { kind: Parameters<typeof createV2EquipmentInstance>[0]['kind']; quality: 'common' | 'improved'; x: number; y: number }[]): V2CargoBayState => ({
      shipId: 'cannon_skiff',
      placed: specs.map((sp, idx) => ({
        item: createV2EquipmentInstance({ instanceId: `e_${idx}`, kind: sp.kind, quality: sp.quality, origin: 'owned', acquiredDepth: 0, location: 'bay' }),
        x: sp.x,
        y: sp.y,
        rotation: 0,
      })),
      staging: [],
      discardedThisArrange: [],
    });
    const bestOf = (bay: V2CargoBayState, hp: number) => {
      const results = (['normal', 'overload', 'emergency_defense'] as const).map((t) => {
        const s = simulateV2Combat({ resultId: t, bay, startingHp: hp, maxHp: 30, units: eliteUnits, targetPolicy: 'weakest', round2Tactic: t });
        return { t, score: (s.outcome === 'victory' ? 10000 : 0) + s.finalPlayerHpAfterRepair * 10 - s.roundsCount };
      });
      return results.sort((a, b) => b.score - a.score)[0].t;
    };

    // Heavy wins via overload; 2xLaser+Bat wins via normal; Counter/ImpHangar wins via emergency_defense!
    expect(
      bestOf(makeBay([{ kind: 'heavy', quality: 'common', x: 0, y: 0 }, { kind: 'capacitor', quality: 'improved', x: 1, y: 0 }, { kind: 'shield', quality: 'improved', x: 2, y: 0 }]), 30)
    ).toBe('overload');
    expect(
      bestOf(makeBay([{ kind: 'laser', quality: 'common', x: 0, y: 0 }, { kind: 'battery', quality: 'common', x: 1, y: 0 }, { kind: 'laser', quality: 'common', x: 2, y: 0 }, { kind: 'shield', quality: 'common', x: 3, y: 0 }, { kind: 'shield', quality: 'common', x: 0, y: 2 }]), 25)
    ).toBe('normal');
    expect(
      bestOf(makeBay([{ kind: 'shield', quality: 'improved', x: 0, y: 0 }, { kind: 'counter', quality: 'common', x: 1, y: 0 }, { kind: 'laser', quality: 'common', x: 2, y: 0 }, { kind: 'battery', quality: 'improved', x: 3, y: 0 }]), 30)
    ).toBe('emergency_defense');
    expect(
      bestOf(makeBay([{ kind: 'hangar', quality: 'improved', x: 0, y: 0 }, { kind: 'relay', quality: 'common', x: 2, y: 0 }, { kind: 'shield', quality: 'improved', x: 3, y: 0 }]), 24)
    ).toBe('emergency_defense');
  });
});


