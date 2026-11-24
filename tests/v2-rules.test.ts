import { describe, expect, it } from 'vitest';
import { createFreshSaveData, persistSaveData, PRIMARY_SAVE_KEY } from '../src/domain/persistence';
import { startExpedition, selectRoute } from '../src/domain/expedition';
import { V2_EQUIPMENT_DEFS } from '../src/v2/data/equipment';
import { buildEncounterUnits } from '../src/v2/data/enemies';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import {
  completeV2CombatAtCurrentNode,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  abortActiveV2Contract,
  canPerformSurveyAtCurrentNode,
  computeV2JumpFuelCost,
  createV2ContractInstance,
  getEscapePodExtraFuelCost,
  isContractReadyForDelivery,
  performSurveyAtCurrentNode,
} from '../src/v2/domain/contracts';
import {
  abandonV2EventAndReturn,
  applyV2EngineerSwap,
  areAllEventOptionsUnaffordable,
  buyV2MerchantFuel,
  buyV2MerchantOffer,
  buyV2MerchantRepair,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  pickV2CombatReward,
  resolveV2AnomalyChoice,
  resolveV2WreckChoice,
  selectV2MapNode,
  sellV2ItemToMerchant,
} from '../src/v2/domain/encounter';
import {
  addV2ItemToStaging,
  createEmptyV2Bay,
  discardV2Item,
  placeV2FromStaging,
  undoV2LastDiscard,
  validateV2Placement,
  verifyV2SpatialConflict,
} from '../src/v2/domain/inventoryV2';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
  getAnyV2ItemDef,
} from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  resolveV2PresetAgainstWarehouse,
  saveV2LoadoutPreset,
  validateV2PrepareLoadout,
} from '../src/v2/domain/loadout';
import {
  inspectV1SaveForMigration,
  migrateV1ToV2SaveData,
} from '../src/v2/domain/migration';
import {
  createFreshV2Profile,
  loadV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import {
  claimV2PendingGiftToWarehouse,
  craftV2CommonEquipment,
  purchaseV2Facility,
  researchV2Equipment,
  restoreV2Relic,
} from '../src/v2/domain/progressionV2';
import { createV2RngStreams } from '../src/v2/domain/rngStreams';
import { generateV2StarGraph, verifyV2GraphInvariants } from '../src/v2/domain/routeGenerator';
import { applyV2Settlement } from '../src/v2/domain/settlementV2';
import {
  V2_RULES_VERSION,
  V2_SAVE_KEY,
  V2_SCHEMA_VERSION,
  V3_BACKUP_KEY,
} from '../src/v2/domain/types';

class MemoryStorage implements V2StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('V2 规则与验收矩阵核心测试（T01–T12 / AC01–AC18, AC22）', () => {
  it('AC01: 教学第 3 层 2×3 密封反应堆存在经求解器证明的真实空间冲突与多种舍弃解，且放弃不锁死正式流程', () => {
    const tutRun = createV2TutorialRun('tut_ac01');
    const existingShapes = tutRun.bay.placed.map((p) => ({
      id: p.item.instanceId,
      shapeId: getAnyV2ItemDef(p.item.definitionId)!.shapeId,
    }));

    // Exact solver verifies ALL existing + 2x3 reactor CANNOT fit together, and >=2 single-item discards work!
    const conflict = verifyV2SpatialConflict('cannon_skiff', existingShapes, '2x3');
    expect(conflict.allFitTogether).toBe(false);
    expect(conflict.feasibleSingleDiscardIds.length).toBeGreaterThanOrEqual(2);

    // Aborting tutorial contract and returning still unlocks Workbench & Contract Hub (never locks formal mode!)
    const aborted = abortActiveV2Contract(tutRun);
    const toSettle = { ...aborted, phase: 'SETTLEMENT' as const, settlementReason: 'safe_return' as const };
    const settled = applyV2Settlement(createFreshV2Profile(), toSettle);
    expect(settled.ok).toBe(true);
    expect(settled.summary.contractCompleted).toBe(false);
    expect(settled.summary.tutorialBonusCredits).toBe(0);
    expect(settled.profile.buildings.workbench).toBe(true);
    expect(settled.profile.buildings.contract_hub).toBe(true);
    expect(settled.profile.tutorialCompleted).toBe(true);
  });

  it('AC02: 大件运输完整交付（2×3 占 6 格、一次交付、一次发奖、不可重复结算、任务货无普通卖价）', () => {
    const profile = {
      ...createFreshV2Profile(),
      buildings: { ...createFreshV2Profile().buildings, workbench: true, contract_hub: true },
      tutorialCompleted: true,
    };
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints);
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      seed: 10042,
      allowImproved: false,
    });
    expect(launched.ok).toBe(true);
    let run = launched.run!;

    // Place a genuine 2x3 mission reactor bound to this contract into a clean bay
    const reactor = createV2CargoInstance({
      instanceId: 'mis_reactor_1',
      defId: 'mission.sealed_reactor',
      origin: 'mission',
      acquiredDepth: 3,
      location: 'staging',
      missionBinding: run.contract.contractId,
    });
    expect(reactor.fixedValue).toBe(0);
    let bay = createEmptyV2Bay('cannon_skiff');
    bay = addV2ItemToStaging(bay, reactor, 0);
    const placedRes = placeV2FromStaging(bay, reactor.instanceId, 0, 0, 0);
    expect(placedRes.ok).toBe(true);
    run = { ...run, bay: placedRes.bay, phase: 'SETTLEMENT', settlementReason: 'safe_return' };

    expect(isContractReadyForDelivery(run, 'safe_return')).toBe(true);
    const res1 = applyV2Settlement(launched.profile, run);
    expect(res1.ok).toBe(true);
    expect(res1.summary.contractCompleted).toBe(true);
    expect(res1.summary.contractRewardCredits).toBe(70);
    expect(res1.profile.credits).toBe(70);
    expect(res1.profile.unlockedCrew).toContain('salvager');
    expect(res1.profile.unlockedFamilies).toContain('heavy_kit');

    // Idempotent second settlement pays 0 extra!
    const res2 = applyV2Settlement(res1.profile, run);
    expect(res2.profile.credits).toBe(70);
  });

  it('AC03: 失联救援单舱与双舱均只额外消耗 +1 燃料，末节点免费返航，中止无卖价', () => {
    const profile = createFreshV2Profile();
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'rescue_deep',
      shipId: 'cannon_skiff',
      crewId: null,
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 2025,
      allowImproved: false,
    });
    let run = launched.run!;
    expect(computeV2JumpFuelCost(run).totalCost).toBe(1);

    // Add 1 escape pod -> +1 extra fuel (total 2)
    const pod1 = createV2CargoInstance({
      instanceId: 'pod_1',
      defId: 'mission.escape_pod',
      origin: 'mission',
      acquiredDepth: 5,
      location: 'bay',
      missionBinding: run.contract.contractId,
    });
    const pod2 = createV2CargoInstance({
      instanceId: 'pod_2',
      defId: 'mission.escape_pod',
      origin: 'mission',
      acquiredDepth: 5,
      location: 'bay',
      missionBinding: run.contract.contractId,
    });

    run = {
      ...run,
      bay: {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: [{ item: pod1, x: 0, y: 0, rotation: 0 }],
      },
    };
    expect(getEscapePodExtraFuelCost(run.bay)).toBe(1);
    expect(computeV2JumpFuelCost(run).totalCost).toBe(2);

    // Add 2nd escape pod -> STILL flat +1 extra fuel (NEVER +2!)
    run = {
      ...run,
      bay: {
        ...run.bay,
        placed: [...run.bay.placed, { item: pod2, x: 1, y: 0, rotation: 0 }],
      },
    };
    expect(getEscapePodExtraFuelCost(run.bay)).toBe(1);
    expect(computeV2JumpFuelCost(run).totalCost).toBe(2);

    // Abort contract transfers pods cleanly with 0 sale value
    const aborted = abortActiveV2Contract(run);
    expect(aborted.contract.status).toBe('aborted');
    expect(aborted.bay.placed.length).toBe(0);
    expect(getEscapePodExtraFuelCost(aborted.bay)).toBe(0);
  });

  it('AC04: 航迹勘测目标可达、单节点不重复计次、燃料不足禁止勘测，领航员免首跳基耗', () => {
    const profile = {
      ...createFreshV2Profile(),
      unlockedCrew: ['engineer' as const, 'navigator' as const],
    };
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'survey_std',
      shipId: 'cannon_skiff',
      crewId: 'navigator',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 3030,
      allowImproved: false,
    });
    let run = launched.run!;
    // Navigator first jump costs 0 base fuel!
    expect(computeV2JumpFuelCost(run).totalCost).toBe(0);
    const firstId = run.graph.guaranteedPathNodeIds[0];
    const entered = selectV2MapNode(run, firstId);
    expect(entered.ok).toBe(true);
    expect(entered.run.fuel).toBe(9);
    expect(entered.run.navigatorFreeJumpUsed).toBe(true);

    // Simulate standing on a resolved marked survey node
    const markedId = run.contract.markedNodeIds[0];
    run = {
      ...entered.run,
      currentNodeId: markedId,
      phase: 'ARRANGE',
      fuel: 1,
      graph: {
        ...entered.run.graph,
        nodes: {
          ...entered.run.graph.nodes,
          [markedId]: { ...entered.run.graph.nodes[markedId], resolved: true },
        },
      },
    };
    expect(canPerformSurveyAtCurrentNode(run).canSurvey).toBe(true);
    const surv1 = performSurveyAtCurrentNode(run);
    expect(surv1.ok).toBe(true);
    expect(surv1.run.fuel).toBe(0);
    expect(surv1.run.contract.completedNodeIds).toEqual([markedId]);

    // Repeat survey on same node rejected!
    expect(performSurveyAtCurrentNode(surv1.run).ok).toBe(false);

    // Insufficient fuel on second marked node rejected!
    const markedId2 = run.contract.markedNodeIds[1];
    const atNode2 = {
      ...surv1.run,
      currentNodeId: markedId2,
      graph: {
        ...surv1.run.graph,
        nodes: {
          ...surv1.run.graph.nodes,
          [markedId2]: { ...surv1.run.graph.nodes[markedId2], resolved: true },
        },
      },
    };
    const chk2 = canPerformSurveyAtCurrentNode(atNode2);
    expect(chk2.canSurvey).toBe(false);
    expect(chk2.reason).toBe('insufficient_fuel');
  });

  it('AC05: 批量生成 1000 个种子全量满足六层有向图连通、委托目标、燃料保底、事件分布与主体系配件不变量', () => {
    const templates = [
      'transport_std',
      'transport_deep',
      'rescue_std',
      'rescue_deep',
      'survey_std',
      'survey_deep',
      'free_salvage',
    ];
    const archetypes = ['laser', 'heavy', 'hangar', 'counter'] as const;

    for (let s = 1; s <= 1000; s++) {
      const tplId = templates[s % templates.length];
      const arch = archetypes[s % archetypes.length];
      const gen = generateV2StarGraph({
        runId: `seed_${s}`,
        contractTemplateId: tplId,
        primaryArchetype: arch,
        unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
        streams: createV2RngStreams(s * 2654435761),
        allowImproved: false,
      });
      const contract = createV2ContractInstance(tplId, gen.markedNodeIds, `seed_${s}`);
      const report = verifyV2GraphInvariants(gen.graph, contract, arch);
      if (!report.ok) {
        throw new Error(`Seed ${s} (${tplId}/${arch}) failed: ${report.violations.join('; ')}`);
      }
    }
  });

  it('AC06: 流动商人买卖无套利、限购 1 次、禁售借用/自有/任务物、交易幂等；异常区/求救/废船规则严密', () => {
    const profile = createFreshV2Profile();
    const ownedLaser = createV2EquipmentInstance({
      instanceId: 'owned_l1',
      kind: 'laser',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'warehouse',
    });
    const profWithOwned = { ...profile, equipmentWarehouse: [ownedLaser] };
    const launched = launchV2Expedition({
      profile: profWithOwned,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [
        { slotKey: 's1', origin: 'owned', definitionId: ownedLaser.definitionId, warehouseInstanceId: ownedLaser.instanceId, x: 0, y: 0, rotation: 0 },
        { slotKey: 's2', origin: 'loan', definitionId: 'equipment.battery.common', x: 1, y: 0, rotation: 0 },
      ],
      seed: 4040,
      allowImproved: false,
    });
    expect(launched.ok).toBe(true);
    let run = launched.run!;

    // Locate merchant node
    const merchantNode = Object.values(run.graph.nodes).find((n) => n.type === 'merchant')!;
    const lootCargo = createV2CargoInstance({
      instanceId: 'loot_box_1',
      defId: 'cargo.old_engine',
      origin: 'loot',
      acquiredDepth: 2,
      location: 'bay',
    });
    run = {
      ...run,
      currentNodeId: merchantNode.nodeId,
      phase: 'SHOP',
      wallet: 100,
      fuel: 8,
      hp: 25,
      bay: {
        ...run.bay,
        placed: [...run.bay.placed, { item: lootCargo, x: 2, y: 0, rotation: 0 }],
      },
    };

    // Reject selling loan or owned equipment!
    const loanItem = run.bay.placed.find((p) => p.item.origin === 'loan')!.item;
    expect(sellV2ItemToMerchant(run, loanItem.instanceId, 'tx_loan').ok).toBe(false);
    expect(sellV2ItemToMerchant(run, ownedLaser.instanceId, 'tx_owned').ok).toBe(false);

    // Selling loot cargo succeeds at floor(fixedValue * 0.8)
    const sellLoot = sellV2ItemToMerchant(run, lootCargo.instanceId, 'tx_sell_loot');
    expect(sellLoot.ok).toBe(true);
    expect(sellLoot.run.wallet).toBe(100 + Math.floor(lootCargo.fixedValue * 0.8));

    // Buying merchant equipment then reselling it yields strict loss (zero arbitrage!)
    const offer = merchantNode.merchant!.offers[0];
    const bought = buyV2MerchantOffer(sellLoot.run, offer.offerId, 'tx_buy_1', ['core']);
    expect(bought.ok).toBe(true);
    // Duplicate transactionId rejected!
    expect(buyV2MerchantOffer(bought.run, offer.offerId, 'tx_buy_1', ['core']).ok).toBe(false);
    const resold = sellV2ItemToMerchant(bought.run, offer.item.instanceId, 'tx_resell');
    expect(resold.ok).toBe(true);
    expect(resold.run.wallet).toBeLessThan(sellLoot.run.wallet);

    // Fuel limit 1/node & capped at maxFuel (10)
    const buyFuel = buyV2MerchantFuel(resold.run, 'tx_fuel_1');
    expect(buyFuel.ok).toBe(true);
    expect(buyFuel.run.fuel).toBe(10);
    expect(buyV2MerchantFuel(buyFuel.run, 'tx_fuel_2').ok).toBe(false);

    // Repair limit 1/node & blocked at full HP
    const buyRep = buyV2MerchantRepair(buyFuel.run, 'tx_rep_1');
    expect(buyRep.ok).toBe(true);
    expect(buyRep.run.hp).toBe(30);
    expect(buyV2MerchantRepair(buyRep.run, 'tx_rep_2').ok).toBe(false);

    // Leaving merchant WITH staged purchase still enters ARRANGE; leaving with empty staging auto-skips to MAP (S02)
    const leftWithPurchase = finishV2MerchantVisit(bought.run);
    expect(leftWithPurchase.ok).toBe(true);
    expect(leftWithPurchase.run.phase).toBe('ARRANGE');

    const left = finishV2MerchantVisit(buyRep.run);
    expect(left.ok).toBe(true);
    expect(left.run.phase).toBe('MAP');

    // Anomaly breach strictly requires HP > 4; when fuel=0 & hp=4 all options unaffordable -> abandon enters SETTLEMENT
    const anomalyNode = Object.values(run.graph.nodes).find((n) => n.type === 'anomaly');
    if (anomalyNode) {
      const stuckRun = {
        ...run,
        currentNodeId: anomalyNode.nodeId,
        phase: 'ENCOUNTER' as const,
        fuel: 0,
        hp: 4,
      };
      expect(resolveV2AnomalyChoice(stuckRun, 'traverse').ok).toBe(false);
      expect(resolveV2AnomalyChoice(stuckRun, 'breach').ok).toBe(false);
      expect(areAllEventOptionsUnaffordable(stuckRun)).toBe(true);
      const ab = abandonV2EventAndReturn(stuckRun);
      expect(ab.ok).toBe(true);
      expect(ab.run.phase).toBe('SETTLEMENT');
      expect(ab.run.graph.nodes[anomalyNode.nodeId].resolved).toBe(false);
    }

    // Engineer first-equipment swap works once and expires on leaving ARRANGE
    const wreckNode = Object.values(run.graph.nodes).find((n) => n.type === 'wreck')!;
    const wreckRun = {
      ...launched.run!,
      currentNodeId: wreckNode.nodeId,
      phase: 'ENCOUNTER' as const,
    };
    const wRes = resolveV2WreckChoice(wreckRun, 'armory', ['core']);
    expect(wRes.ok).toBe(true);
    expect(wRes.run.activeEngineerOffer).not.toBeNull();
    const cand = wRes.run.activeEngineerOffer!.candidates[0];
    const swapped = applyV2EngineerSwap(wRes.run, cand);
    expect(swapped.ok).toBe(true);
    expect(swapped.run.bay.staging[0].item.definitionId).toBe(`equipment.${cand}.common`);
  });

  it('AC07 / AC08 / AC09 / AC10: 重炮日程、无人机成长与装甲、护盾反击与穿盾、多目标快照与同步同归于尽', () => {
    const mkEq = (id: string, kind: Parameters<typeof createV2EquipmentInstance>[0]['kind'], q: 'common' | 'improved' = 'common') =>
      createV2EquipmentInstance({
        instanceId: id,
        kind,
        quality: q,
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });

    // AC07: Heavy without capacitor fires R2, R4; with 2 capacitors still fires R1, R3 (no double acceleration!)
    const bayNoCap = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [{ item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 as const }],
    };
    const simNoCap = simulateV2Combat({
      resultId: 'ac07_nocap',
      bay: bayNoCap,
      startingHp: 30,
      maxHp: 30,
      units: [{ enemyId: 'e1', name: 'Target', spriteArchetype: 'scout', maxHp: 40, damagePerRound: 1, armor: 0, pierceRatio: 0 }],
      targetPolicy: 'weakest',
    });
    expect(simNoCap.rounds[0].playerAttacks.some((a) => a.sourceKind === 'heavy')).toBe(false);
    expect(simNoCap.rounds[1].playerAttacks.some((a) => a.sourceKind === 'heavy' && a.rawDamage === 12)).toBe(true);

    const bayTwoCaps = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 as const },
        { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 as const },
        { item: mkEq('c2', 'capacitor'), x: 1, y: 1, rotation: 0 as const },
      ],
    };
    const simTwoCaps = simulateV2Combat({
      resultId: 'ac07_2cap',
      bay: bayTwoCaps,
      startingHp: 30,
      maxHp: 30,
      units: [{ enemyId: 'e1', name: 'Target', spriteArchetype: 'scout', maxHp: 40, damagePerRound: 1, armor: 0, pierceRatio: 0 }],
      targetPolicy: 'weakest',
    });
    expect(simTwoCaps.rounds[0].playerAttacks.some((a) => a.sourceKind === 'heavy' && a.rawDamage === 12)).toBe(true);
    expect(simTwoCaps.rounds[1].playerAttacks.some((a) => a.sourceKind === 'heavy')).toBe(false);
    expect(simTwoCaps.rounds[2].playerAttacks.some((a) => a.sourceKind === 'heavy' && a.rawDamage === 12)).toBe(true);

    // AC08: Hangar + Relay ramp 1->2->3->4, per-drone armor applied (2 dmg vs armor 2 => 1 dmg per drone!)
    const bayHangar = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('hg1', 'hangar'), x: 0, y: 0, rotation: 0 as const },
        { item: mkEq('rl1', 'relay'), x: 2, y: 0, rotation: 0 as const },
      ],
    };
    const simHangar = simulateV2Combat({
      resultId: 'ac08_hangar',
      bay: bayHangar,
      startingHp: 30,
      maxHp: 30,
      units: [{ enemyId: 'e1', name: 'Armored', spriteArchetype: 'frigate', maxHp: 30, damagePerRound: 1, armor: 2, pierceRatio: 0 }],
      targetPolicy: 'weakest',
    });
    expect(simHangar.rounds[0].droneCountsByHangar['hg1']).toBe(1);
    expect(simHangar.rounds[1].droneCountsByHangar['hg1']).toBe(2);
    expect(simHangar.rounds[2].droneCountsByHangar['hg1']).toBe(3);
    expect(simHangar.rounds[3].droneCountsByHangar['hg1']).toBe(4);
    expect(simHangar.rounds[4].droneCountsByHangar['hg1']).toBe(4);
    const r4DroneHits = simHangar.rounds[3].playerAttacks.filter((a) => a.sourceKind === 'hangar');
    expect(r4DroneHits.length).toBe(4);
    expect(r4DroneHits.every((h) => h.appliedDamage === 1 && h.armorBlocked === 1)).toBe(true);

    // AC09: Counter uses ONLY actual shield absorbed (pierce excluded!), fires ONCE ship-wide, mutual KO = defeat!
    const bayCounter = {
      ...createEmptyV2Bay('shield_cruiser'),
      placed: [
        { item: mkEq('sh1', 'shield'), x: 0, y: 0, rotation: 0 as const },
        { item: mkEq('ct1', 'counter'), x: 1, y: 0, rotation: 0 as const },
        { item: mkEq('ct2', 'counter'), x: 1, y: 2, rotation: 0 as const }, // second counter does NOT fire twice
      ],
    };
    // Piercing Hunter deals 6 dmg with 50% pierce -> 3 pierce directly to HP + 3 absorbed by shield -> floor(3*0.5)=1 counter!
    const simPierce = simulateV2Combat({
      resultId: 'ac09_pierce',
      bay: bayCounter,
      startingHp: 3, // dies from 3 pierce dmg even if counter kills the 1 HP enemy!
      maxHp: 34,
      units: [{ enemyId: 'p1', name: 'Piercer', spriteArchetype: 'interceptor', maxHp: 2, damagePerRound: 6, armor: 0, pierceRatio: 0.5 }],
      targetPolicy: 'weakest',
    });
    expect(simPierce.rounds[0].shieldAbsorbedTotal).toBe(3);
    expect(simPierce.rounds[0].counterAttack?.rawDamage).toBe(1);
    expect(simPierce.rounds[0].enemiesAfter[0].hp).toBe(0); // Counter killed enemy!
    expect(simPierce.outcome).toBe('defeat'); // Mutual KO STILL loses (§8.2 & AC09)!

    // AC10: Multi-target snapshot & overkill consistency + dead enemy still fires in same round!
    const bayOverkill = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 as const },
        { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 as const },
      ],
    };
    const swarmUnits = buildEncounterUnits('swarm', 3, 'test_sw'); // 4× 6HP, 1 dmg each
    const simSwarm = simulateV2Combat({
      resultId: 'ac10_swarm',
      bay: bayOverkill,
      startingHp: 30,
      maxHp: 30,
      units: swarmUnits,
      targetPolicy: 'weakest',
    });
    // Round 1: core(2) + heavy(12) BOTH hit swarm_1 (6HP) -> overkill wasted on swarm_1; swarm_2..4 still at 6HP; ALL 4 shoot for 4 dmg total!
    expect(simSwarm.rounds[0].enemiesAfter[0].hp).toBe(0);
    expect(simSwarm.rounds[0].enemiesAfter[1].hp).toBe(6);
    expect(simSwarm.rounds[0].enemyAttacks.length).toBe(4);
    expect(simSwarm.rounds[0].playerHpAfter).toBe(26);
  });

  it('T09 门槛验证（纯普通品质）: 三套构筑对不同敌人存在显著优劣交换，不存在单一碾压通解', () => {
    const mk = (id: string, kind: Parameters<typeof createV2EquipmentInstance>[0]['kind']) =>
      createV2EquipmentInstance({ instanceId: id, kind, quality: 'common', origin: 'loan', acquiredDepth: 0, location: 'bay' });

    // Budget-6 Common Builds on cannon_skiff / shield_cruiser:
    // Build A (Heavy Burst, budget 6): heavy(3) + capacitor(1) + shield(2)
    const heavyBay = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mk('h1', 'heavy'), x: 0, y: 0, rotation: 0 as const },
        { item: mk('c1', 'capacitor'), x: 1, y: 0, rotation: 0 as const },
        { item: mk('s1', 'shield'), x: 2, y: 0, rotation: 0 as const },
      ],
    };
    // Build B (Drone Hangar + Flak / Relay, budget 6): hangar(3) + relay(1) + repair(2)
    const hangarBay = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mk('hg1', 'hangar'), x: 0, y: 0, rotation: 0 as const },
        { item: mk('rl1', 'relay'), x: 2, y: 0, rotation: 0 as const },
        { item: mk('rp1', 'repair'), x: 2, y: 1, rotation: 0 as const },
      ],
    };
    // Build C (Shield Counter, budget 6 on shield_cruiser): shield(2) + counter(2) + laser(2)
    const counterBay = {
      ...createEmptyV2Bay('shield_cruiser'),
      placed: [
        { item: mk('s1', 'shield'), x: 0, y: 0, rotation: 0 as const },
        { item: mk('ct1', 'counter'), x: 1, y: 0, rotation: 0 as const },
        { item: mk('l1', 'laser'), x: 2, y: 0, rotation: 0 as const },
      ],
    };
    // Build D (Flak Tech, budget 5): flak(3) + laser(2)
    const flakBay = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mk('fl1', 'flak'), x: 0, y: 0, rotation: 0 as const },
        { item: mk('l1', 'laser'), x: 3, y: 0, rotation: 0 as const },
      ],
    };

    const armoredL3 = buildEncounterUnits('armored', 3, 'g_arm'); // 28HP, 3dmg, armor 2
    const swarmL3 = buildEncounterUnits('swarm', 3, 'g_swm'); // 4× 6HP, 1dmg
    const piercerL3 = buildEncounterUnits('piercer', 3, 'g_prc'); // 22HP, 4dmg (50% pierce)

    const heavyVsArmored = simulateV2Combat({ resultId: '1', bay: heavyBay, startingHp: 30, maxHp: 30, units: armoredL3, targetPolicy: 'weakest' });
    const hangarVsArmored = simulateV2Combat({ resultId: '2', bay: hangarBay, startingHp: 30, maxHp: 30, units: armoredL3, targetPolicy: 'weakest' });
    // Heavy beats Armored Frigate WAY faster & cleaner than Drone Hangar (armor 2 halves drones)!
    expect(heavyVsArmored.roundsCount).toBeLessThan(hangarVsArmored.roundsCount);
    expect(heavyVsArmored.finalPlayerHpAfterRepair).toBeGreaterThan(hangarVsArmored.finalPlayerHpAfterRepair);

    const heavyVsSwarm = simulateV2Combat({ resultId: '3', bay: heavyBay, startingHp: 30, maxHp: 30, units: swarmL3, targetPolicy: 'weakest' });
    const flakVsSwarm = simulateV2Combat({ resultId: '4', bay: flakBay, startingHp: 30, maxHp: 30, units: swarmL3, targetPolicy: 'weakest' });
    const counterVsSwarm = simulateV2Combat({ resultId: '5', bay: counterBay, startingHp: 34, maxHp: 34, units: swarmL3, targetPolicy: 'weakest' });
    // Flak & Shield Counter crush Swarm far faster/cleaner than Heavy Burst (which wastes overkill)!
    expect(flakVsSwarm.roundsCount).toBeLessThan(heavyVsSwarm.roundsCount);
    expect(counterVsSwarm.startingPlayerHp - counterVsSwarm.finalPlayerHp).toBeLessThan(
      heavyVsSwarm.startingPlayerHp - heavyVsSwarm.finalPlayerHp
    );

    const heavyVsPiercer = simulateV2Combat({ resultId: '6', bay: heavyBay, startingHp: 30, maxHp: 30, units: piercerL3, targetPolicy: 'weakest' });
    const counterVsPiercer = simulateV2Combat({ resultId: '7', bay: counterBay, startingHp: 34, maxHp: 34, units: piercerL3, targetPolicy: 'weakest' });
    // Piercing Hunter weakens Shield Counter relative to Heavy Burst!
    expect(heavyVsPiercer.roundsCount).toBeLessThan(counterVsPiercer.roundsCount);
    expect(heavyVsPiercer.startingPlayerHp - heavyVsPiercer.finalPlayerHp).toBeLessThan(
      counterVsPiercer.startingPlayerHp - counterVsPiercer.finalPlayerHp
    );
  });

  it('AC11 / AC12 / AC13 / AC14 / AC15 / AC22: 异形5×4货船禁用格、预算、设备库/研究/制造、预设缺件、两胜一败账实一致', () => {
    // AC11: heavy_freighter (5x4) blocks disabled (4,0) and (0,3)
    const freighterBay = createEmptyV2Bay('heavy_freighter');
    expect(validateV2Placement(freighterBay, 'equipment.battery.common', 4, 0, 0).reason).toBe('disabled_cell');
    expect(validateV2Placement(freighterBay, 'equipment.battery.common', 0, 3, 0).reason).toBe('disabled_cell');
    expect(validateV2Placement(freighterBay, 'mission.sealed_reactor', 1, 1, 0).valid).toBe(true);

    // AC12: Budget limit enforced; bankrupt (0 credits, 0 warehouse) still launches free!
    let profile = {
      ...createFreshV2Profile(),
      credits: 0,
      buildings: {
        ...createFreshV2Profile().buildings,
        workbench: true,
        contract_hub: true,
      },
      tutorialCompleted: true,
    };
    const overBudget = validateV2PrepareLoadout(profile, 'cannon_skiff', 'engineer', [
      { slotKey: '1', origin: 'loan', definitionId: 'equipment.laser.common', x: 0, y: 0, rotation: 0 },
      { slotKey: '2', origin: 'loan', definitionId: 'equipment.laser.common', x: 1, y: 0, rotation: 0 },
      { slotKey: '3', origin: 'loan', definitionId: 'equipment.shield.common', x: 2, y: 0, rotation: 0 },
      { slotKey: '4', origin: 'loan', definitionId: 'equipment.battery.common', x: 3, y: 0, rotation: 0 },
    ]); // 2+2+2+1 = 7 > 6
    expect(overBudget.valid).toBe(false);

    const freeSlots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints);
    const run1Launch = launchV2Expedition({
      profile,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: freeSlots,
      seed: 9001,
      allowImproved: false,
    });
    expect(run1Launch.ok).toBe(true);

    // Run 1: Safe return completing transport_std (70¤) + loot cargo (32¤) -> 102¤ + unlocks heavy_kit (heavy gift + capacitor blueprint)!
    let run1 = run1Launch.run!;
    const r1Reactor = createV2CargoInstance({
      instanceId: 'r1_reactor',
      defId: 'mission.sealed_reactor',
      origin: 'mission',
      acquiredDepth: 3,
      location: 'bay',
      missionBinding: run1.contract.contractId,
    });
    const r1Loot = createV2CargoInstance({
      instanceId: 'r1_loot',
      defId: 'cargo.old_engine',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'bay',
    }); // 32¤
    run1 = {
      ...run1,
      bay: {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: [
          { item: r1Reactor, x: 0, y: 0, rotation: 0 },
          { item: r1Loot, x: 2, y: 0, rotation: 0 },
        ],
      },
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const settle1 = applyV2Settlement(run1Launch.profile, run1);
    expect(settle1.ok).toBe(true);
    profile = settle1.profile;
    expect(profile.credits).toBe(102);
    expect(profile.pendingGiftQueue.length).toBe(1);
    expect(profile.blueprints).toContain('capacitor');

    // Build Research Lab (100¤) -> remaining 2¤
    const builtLab = purchaseV2Facility(profile, 'research_lab');
    expect(builtLab.ok).toBe(true);
    profile = builtLab.profile;
    expect(profile.credits).toBe(2);

    // Claim Heavy gift into warehouse!
    const giftId = profile.pendingGiftQueue[0].instanceId;
    const claimedGift = claimV2PendingGiftToWarehouse(profile, giftId);
    expect(claimedGift.ok).toBe(true);
    profile = claimedGift.profile;
    expect(profile.equipmentWarehouse.length).toBe(1);

    // Run 2: Safe return completing survey_std (70¤) + bringing loot equipment stored into warehouse + relic kept!
    const run2Launch = launchV2Expedition({
      profile,
      contractTemplateId: 'survey_std',
      shipId: 'cannon_skiff',
      crewId: 'salvager',
      primaryArchetype: 'laser',
      slots: freeSlots,
      seed: 9002,
      allowImproved: false,
    });
    let run2 = run2Launch.run!;
    const r2LootEq = createV2EquipmentInstance({
      instanceId: 'r2_loot_flak',
      kind: 'flak',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'bay',
    });
    const r2Relic = createV2CargoInstance({
      instanceId: 'r2_nav',
      defId: 'cargo.ancient_navigator',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'bay',
    });
    run2 = {
      ...run2,
      wallet: 20,
      contract: {
        ...run2.contract,
        completedNodeIds: run2.contract.markedNodeIds.slice(0, 2),
      },
      bay: {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: [
          { item: r2LootEq, x: 0, y: 0, rotation: 0 },
          { item: r2Relic, x: 0, y: 2, rotation: 0 },
        ],
      },
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const settle2 = applyV2Settlement(run2Launch.profile, run2, {
      [r2LootEq.instanceId]: 'store',
      [r2Relic.instanceId]: 'keep_relic',
    });
    expect(settle2.ok).toBe(true);
    profile = settle2.profile;
    // AC13: Kept relic + stored loot equipment paid 0 sale credits -> only wallet(20) + survey(70) = +90¤ (2 -> 92¤)!
    expect(profile.credits).toBe(92);
    expect(profile.relics.ancient_navigator.storedCount).toBe(1);
    expect(profile.equipmentWarehouse.length).toBe(2); // heavy gift + stored flak!

    // AC15: Research Heavy from warehouse (consumes 1 instance + 30¤ -> 62¤, unlocks heavy blueprint once!)
    const resHeavy = researchV2Equipment(profile, giftId);
    expect(resHeavy.ok).toBe(true);
    profile = resHeavy.profile;
    expect(profile.credits).toBe(62);
    expect(profile.blueprints).toContain('heavy');
    expect(profile.equipmentWarehouse.length).toBe(1);
    // Double-click research on same instance rejected without deducting credits!
    const dupResearch = researchV2Equipment(profile, giftId);
    expect(dupResearch.ok).toBe(false);
    expect(dupResearch.profile.credits).toBe(62);

    // Craft 1 owned common laser (10 * 3 = 30¤ -> 32¤), save preset referencing it, bring it into Run 3 and DEFEAT!
    const crafted = craftV2CommonEquipment(profile, 'laser', 'c1');
    expect(crafted.ok).toBe(true);
    profile = crafted.profile;
    expect(profile.credits).toBe(32);
    const ownedLaserId = profile.equipmentWarehouse.find((w) => w.definitionId === 'equipment.laser.common')!.instanceId;

    const savedPreset = saveV2LoadoutPreset(profile, {
      name: '重炮混合',
      shipId: 'cannon_skiff',
      crewId: 'navigator',
      primaryArchetype: 'heavy',
      slots: [
        { slotKey: 'p1', origin: 'loan', definitionId: 'equipment.heavy.common', x: 0, y: 0, rotation: 0 },
        { slotKey: 'p2', origin: 'loan', definitionId: 'equipment.capacitor.common', x: 1, y: 0, rotation: 0 },
        { slotKey: 'p3', origin: 'owned', definitionId: 'equipment.laser.common', warehouseInstanceId: ownedLaserId, x: 2, y: 0, rotation: 0 },
      ],
    });
    expect(savedPreset.ok).toBe(true);
    profile = savedPreset.profile;

    // Run 3 launches with owned laser (deducted from warehouse!) -> DEFEAT!
    const run3Launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'navigator',
      primaryArchetype: 'heavy',
      slots: [
        { slotKey: 'p1', origin: 'loan', definitionId: 'equipment.heavy.common', x: 0, y: 0, rotation: 0 },
        { slotKey: 'p2', origin: 'loan', definitionId: 'equipment.capacitor.common', x: 1, y: 0, rotation: 0 },
        { slotKey: 'p3', origin: 'owned', definitionId: 'equipment.laser.common', warehouseInstanceId: ownedLaserId, x: 2, y: 0, rotation: 0 },
      ],
      seed: 9003,
      allowImproved: false,
    });
    expect(run3Launch.ok).toBe(true);
    // Owned laser removed from base warehouse upon launch; unbrought flak stays safe in base warehouse!
    expect(run3Launch.profile.equipmentWarehouse.length).toBe(1);

    const run3Defeat = {
      ...run3Launch.run!,
      hp: 0,
      wallet: 15,
      phase: 'SETTLEMENT' as const,
      settlementReason: 'defeat' as const,
    };
    const settle3 = applyV2Settlement(run3Launch.profile, run3Defeat);
    expect(settle3.ok).toBe(true);
    // AC14: wallet(15) + owned laser(10) = 25 -> floor(25 * 0.4) = 10¤; owned laser lost, base warehouse flak preserved!
    expect(settle3.summary.finalCreditsEarned).toBe(10);
    expect(settle3.summary.lostOwnedCount).toBe(1);
    expect(settle3.profile.credits).toBe(42);
    expect(settle3.profile.equipmentWarehouse.length).toBe(1);

    // Preset now explicitly flags missing owned laser WITHOUT silently replacing it (§6.3)!
    const resolved = resolveV2PresetAgainstWarehouse(
      settle3.profile,
      settle3.profile.loadoutPresets[0]
    );
    const missingSlot = resolved.find((r) => r.missingOwned);
    expect(missingSlot).toBeDefined();
    expect(missingSlot?.canSubstituteCommonLoan).toBe(true);

    // Display + relic restoration check
    const rich = { ...settle3.profile, credits: 200 };
    const withDisplay = purchaseV2Facility(rich, 'display');
    expect(withDisplay.ok).toBe(true);
    const restored = restoreV2Relic(withDisplay.profile, 'ancient_navigator');
    expect(restored.ok).toBe(true);
    expect(restored.profile.relics.ancient_navigator.restored).toBe(true);
    expect(restored.profile.credits).toBe(40);
  });

  it('AC17 / AC18: V2 存档深层语义校验与坏档备份保护、V1 旧档无损保留与含进行中航次迁移幂等', () => {
    const store = new MemoryStorage();

    // 1. Seed a rich V1 save with all 4 relics + active V1 combat expedition!
    let v1 = createFreshSaveData();
    v1 = {
      ...v1,
      progression: {
        ...v1.progression,
        credits: 150,
        tutorialCompleted: true,
        deepestNodeReached: 5,
        buildings: { workbench: true, display: true, drydock: true },
        relics: {
          ancient_navigator: { storedCount: 0, restored: true },
          quantum_core: { storedCount: 1, restored: false },
          cryo_amber: { storedCount: 2, restored: false },
          obsidian_crown: { storedCount: 0, restored: true },
        },
        discoveredItems: ['equipment.laser.improved', 'equipment.drone.common', 'cargo.quantum_core'],
      },
    };
    const v1Exp = selectRoute(
      startExpedition({ loadoutId: 'shield_cruiser', isTutorial: false, seed: 777 }),
      'normal'
    );
    v1 = { ...v1, activeExpedition: v1Exp };
    persistSaveData(store, v1);
    const rawV1Before = store.getItem(PRIMARY_SAVE_KEY);

    // Inspect & migrate to V2!
    const insp = inspectV1SaveForMigration(store);
    expect(insp.hasV1Save).toBe(true);
    expect(insp.v1Valid).toBe(true);
    expect(insp.activeRunPreview).not.toBeNull();
    expect(insp.activeRunPreview!.resolvedAs).toBe('safe_return');
    expect(insp.relicsSummary).toEqual({ stored: 3, restored: 2 });

    const v2Migrated = migrateV1ToV2SaveData(insp.v1Save!);
    expect(v2Migrated.profile.credits).toBe(150 + insp.activeRunPreview!.estimatedCredits);
    expect(v2Migrated.profile.buildings.workbench).toBe(true);
    expect(v2Migrated.profile.buildings.contract_hub).toBe(true);
    expect(v2Migrated.profile.buildings.drydock).toBe(true);
    expect(v2Migrated.profile.buildings.display).toBe(true);
    expect(v2Migrated.profile.unlockedShips).toContain('shield_cruiser');
    // ALL 4 V1 relics preserved intact!
    expect(v2Migrated.profile.relics.ancient_navigator.restored).toBe(true);
    expect(v2Migrated.profile.relics.quantum_core.storedCount).toBe(1);
    expect(v2Migrated.profile.relics.cryo_amber.storedCount).toBe(2);
    expect(v2Migrated.profile.relics.obsidian_crown.restored).toBe(true);
    // Discovery mapped (drone -> repair), NO nonexistent free warehouse items granted!
    expect(v2Migrated.profile.discoveredItems).toContain('equipment.repair.common');
    expect(v2Migrated.profile.discoveredItems).toContain('equipment.laser.improved');
    expect(v2Migrated.profile.equipmentWarehouse.length).toBe(0);

    // Idempotent second migration does NOT double-credit!
    const v2Again = migrateV1ToV2SaveData(insp.v1Save!, v2Migrated);
    expect(v2Again.profile.credits).toBe(v2Migrated.profile.credits);

    // Persist V2 -> V1 raw save stays 100% byte-for-byte untouched!
    expect(persistV2SaveData(store, v2Migrated).ok).toBe(true);
    expect(store.getItem(PRIMARY_SAVE_KEY)).toBe(rawV1Before);

    // 2. Semantic corruption in starline_save_v2 triggers backup recovery without losing valid backup!
    const v2Second = { ...v2Migrated, profile: { ...v2Migrated.profile, credits: 999 } };
    expect(persistV2SaveData(store, v2Second).ok).toBe(true);
    expect(store.getItem(V3_BACKUP_KEY)).not.toBeNull();

    // Corrupt primary with illegal negative wallet in activeRun
    const corrupt = JSON.parse(store.getItem(V2_SAVE_KEY)!);
    corrupt.activeRun = { runId: 'bad', schemaVersion: V2_SCHEMA_VERSION, rulesVersion: V2_RULES_VERSION, shipId: 'cannon_skiff', wallet: -50 };
    store.setItem(V2_SAVE_KEY, JSON.stringify(corrupt));

    expect(validateV2SaveDataDetailed(corrupt).ok).toBe(false);
    const reloaded = loadV2SaveData(store);
    expect(reloaded.status).toBe('corrupt_with_backup');
    if (reloaded.status === 'corrupt_with_backup') {
      expect(reloaded.backup.profile.credits).toBe(v2Migrated.profile.credits);
    }
  });

  it('预览与实战使用同一确定性战斗算法 + 战后奖励拾取与舍弃撤销', () => {
    const profile = createFreshV2Profile();
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: null,
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 5555,
      allowImproved: false,
    });
    let run = launched.run!;
    const combatNodeId = run.graph.startNextNodeIds.find(
      (id) => run.graph.nodes[id].type === 'combat'
    )!;
    const preview = previewV2CombatNode(run, combatNodeId, 'weakest')!;
    const entered = selectV2MapNode(run, combatNodeId);
    expect(entered.ok).toBe(true);
    const started = startV2CombatAtCurrentNode(entered.run, 'weakest');
    expect(started.ok).toBe(true);
    // Exact equality between preview and live simulation!
    expect(started.run.activeCombat!.simulation.outcome).toBe(preview.outcome);
    expect(started.run.activeCombat!.simulation.finalPlayerHpAfterRepair).toBe(
      preview.finalPlayerHpAfterRepair
    );
    expect(started.run.activeCombat!.simulation.roundsCount).toBe(preview.roundsCount);

    const completed = completeV2CombatAtCurrentNode(started.run, ['core']);
    expect(completed.ok).toBe(true);
    expect(completed.run.phase).toBe('REWARD');
    expect(completed.run.wallet).toBe(run.graph.nodes[combatNodeId].combat!.bounty);

    const picked = pickV2CombatReward(completed.run, 'cargo', ['core']);
    expect(picked.ok).toBe(true);
    expect(picked.run.bay.staging.length).toBe(1);
    const stagedId = picked.run.bay.staging[0].item.instanceId;

    // Discard & undo preserves exact item!
    const disc = discardV2Item(picked.run.bay, stagedId);
    expect(disc.ok).toBe(true);
    expect(disc.bay.staging.length).toBe(0);
    const undone = undoV2LastDiscard(disc.bay);
    expect(undone.ok).toBe(true);
    expect(undone.bay.staging[0].item.instanceId).toBe(stagedId);

    // Leaving ARRANGE while staging non-empty is blocked!
    expect(finishV2ArrangeAndProceed(picked.run, 'map').ok).toBe(false);
    // Clearing staging allows proceeding to MAP
    const ready = { ...picked.run, bay: disc.bay };
    const toMap = finishV2ArrangeAndProceed(ready, 'map');
    expect(toMap.ok).toBe(true);
    expect(toMap.run.phase).toBe('MAP');
  });

  it('设备数据完备性: 全部 16 类普通与优良设备价格、预算与商店无套利不变量', () => {
    const all = Object.values(V2_EQUIPMENT_DEFS);
    expect(all.length).toBe(32); // 16 kinds × 2 qualities
    for (const def of all) {
      expect(def.shopBuyPrice).toBeGreaterThan(def.recycleValue);
      expect(Math.floor(def.recycleValue * 0.8)).toBeLessThan(def.shopBuyPrice);
      if (def.quality === 'common') {
        expect(def.craftCost).toBe(def.recycleValue * 3);
      } else {
        expect(def.craftCost).toBe(0);
      }
    }
  });
});
