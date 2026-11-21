import { describe, expect, it } from 'vitest';
import { FIRST_EXPEDITION_BONUS_CREDITS } from '../src/data/buildings';
import { computeCargoPrice, getRouteSpec } from '../src/data/nodes';
import { SHAPES, getRotatedShapeCells, type Rotation } from '../src/data/shapes';
import { calculateBuildStats } from '../src/domain/buildStats';
import { simulateCombat } from '../src/domain/combat';
import {
  applyExpeditionSettlement,
  calculateSettlement,
  purchaseBuilding,
  restoreRelic,
} from '../src/domain/economy';
import {
  completeCombat,
  getRoutePreview,
  initiateSafeReturn,
  proceedToNextNode,
  selectReward,
  selectRoute,
  startExpedition,
  updateArrangeBay,
} from '../src/domain/expedition';
import {
  checkPlacement,
  createEmptyCargoBay,
  discardItem,
  movePlacedItem,
  placeFromStaging,
  rotatePlacedItemInPlace,
  undoDiscard,
  type CargoBayState,
  type ItemInstance,
} from '../src/domain/inventory';
import {
  BACKUP_SAVE_KEY,
  PRIMARY_SAVE_KEY,
  createFreshSaveData,
  loadSaveData,
  persistSaveData,
  type StorageLike,
} from '../src/domain/persistence';
import { createInitialProgression } from '../src/domain/progression';

function makeItem(
  instanceId: string,
  defId: string,
  value = 10,
  isBorrowed = false
): ItemInstance {
  return { instanceId, defId, value, isBorrowed, acquiredNode: 1 };
}

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  public failWrites = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error('QuotaExceededError');
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('§11 规则边界 — 形状、旋转与占格', () => {
  it('L 形与 T 形旋转 4 次严格还原原始占格', () => {
    for (const shapeId of ['L3', 'T4', '1x2', '1x3', '2x2', '1x1'] as const) {
      const orig = getRotatedShapeCells(shapeId, 0);
      const after4 = getRotatedShapeCells(shapeId, ((0 + 4) % 4) as Rotation);
      expect(after4).toEqual(orig);
      expect(orig.length).toBe(SHAPES[shapeId].cells.length);
    }

    // L3 explicit step-by-step check
    const r0 = getRotatedShapeCells('L3', 0);
    const r1 = getRotatedShapeCells('L3', 1);
    const r2 = getRotatedShapeCells('L3', 2);
    const r3 = getRotatedShapeCells('L3', 3);
    expect(r0).not.toEqual(r1);
    expect(r1).not.toEqual(r2);
    expect(r2).not.toEqual(r3);
  });

  it('所有形状越界与重叠均严格拒绝', () => {
    const bay: CargoBayState = {
      ...createEmptyCargoBay(),
      placed: [
        { item: makeItem('a', 'equipment.laser.common'), x: 1, y: 1, rotation: 0 }, // (1,1),(1,2)
      ],
    };

    // Out of bounds
    const oob = checkPlacement(bay, 'cargo.coolant_tank', 0, 2, 0); // needs y=2,3,4
    expect(oob.valid).toBe(false);
    expect(oob.reason).toBe('out_of_bounds');

    // Overlap
    const overlap = checkPlacement(bay, 'cargo.old_engine', 0, 1, 0); // (0,1),(1,1),(0,2),(1,2)
    expect(overlap.valid).toBe(false);
    expect(overlap.reason).toBe('overlap');

    // Valid adjacent
    const ok = checkPlacement(bay, 'cargo.data_box', 0, 1, 0);
    expect(ok.valid).toBe(true);

    // Move failure leaves bay completely unchanged (no item duplication)
    const moveRes = movePlacedItem(bay, 'a', 3, 3, 0);
    expect(moveRes.ok).toBe(false);
    expect(moveRes.bay.placed.length).toBe(1);
    expect(moveRes.bay.placed[0].x).toBe(1);
    expect(moveRes.bay.placed[0].y).toBe(1);
  });

  it('旋转 4 次后还原且不会在边缘损坏状态', () => {
    let bay: CargoBayState = {
      ...createEmptyCargoBay(),
      placed: [{ item: makeItem('d1', 'equipment.drone.common'), x: 1, y: 1, rotation: 0 }],
    };
    for (let i = 0; i < 4; i++) {
      const res = rotatePlacedItemInPlace(bay, 'd1');
      expect(res.ok).toBe(true);
      bay = res.bay;
    }
    expect(bay.placed[0].rotation).toBe(0);
    expect(bay.placed[0].x).toBe(1);
    expect(bay.placed[0].y).toBe(1);
  });
});

describe('§11 规则边界 — 电池邻接、上限与暂存撤销', () => {
  it('两块电池对同一门炮只取最高值；对角不触发；单电池可服务多门炮', () => {
    const bay: CargoBayState = {
      ...createEmptyCargoBay(),
      placed: [
        // Laser 1 at (1,1)-(1,2)
        { item: makeItem('l1', 'equipment.laser.common'), x: 1, y: 1, rotation: 0 },
        // Laser 2 at (3,1)-(3,2)
        { item: makeItem('l2', 'equipment.laser.common'), x: 3, y: 1, rotation: 0 },
        // Common battery (+2) at (0,1) -> adjacent to l1
        { item: makeItem('b_common', 'equipment.battery.common'), x: 0, y: 1, rotation: 0 },
        // Improved battery (+3) at (2,1) -> adjacent to BOTH l1 and l2
        { item: makeItem('b_imp', 'equipment.battery.improved'), x: 2, y: 1, rotation: 0 },
        // Diagonal battery at (0,0) -> diagonal to l1 (1,1), NOT orthogonally adjacent to l1
        { item: makeItem('b_diag', 'equipment.battery.improved'), x: 0, y: 0, rotation: 0 },
      ],
    };

    const stats = calculateBuildStats(bay);
    // Base 4 + l1(3+3) + l2(3+3) = 16 (l1 does NOT stack +2 and +3!)
    expect(stats.totalAttack).toBe(16);
    expect(stats.batteryBonusAttack).toBe(6);
    expect(stats.links.length).toBe(2);
    expect(stats.links.every((l) => l.batteryInstanceId === 'b_imp')).toBe(true);

    // Pure diagonal test
    const diagOnlyBay: CargoBayState = {
      ...createEmptyCargoBay(),
      placed: [
        { item: makeItem('l1', 'equipment.laser.common'), x: 1, y: 1, rotation: 0 },
        { item: makeItem('b_diag', 'equipment.battery.improved'), x: 0, y: 0, rotation: 0 },
      ],
    };
    const diagStats = calculateBuildStats(diagOnlyBay);
    expect(diagStats.batteryBonusAttack).toBe(0);
    expect(diagStats.totalAttack).toBe(7);
  });

  it('护盾上限 18、维修上限 4 且正确提示溢出', () => {
    const bay: CargoBayState = {
      ...createEmptyCargoBay(),
      placed: [
        { item: makeItem('s1', 'equipment.shield.improved'), x: 0, y: 0, rotation: 0 }, // +9
        { item: makeItem('s2', 'equipment.shield.improved'), x: 1, y: 0, rotation: 0 }, // +9
        { item: makeItem('s3', 'equipment.shield.common'), x: 2, y: 0, rotation: 0 }, // +6 -> raw 24
        { item: makeItem('d1', 'equipment.drone.improved'), x: 0, y: 2, rotation: 0 }, // +3
        { item: makeItem('d2', 'equipment.drone.common'), x: 2, y: 2, rotation: 0 }, // +2 -> raw 5
      ],
    };
    const stats = calculateBuildStats(bay);
    expect(stats.rawShield).toBe(24);
    expect(stats.effectiveShield).toBe(18);
    expect(stats.shieldCapped).toBe(true);
    expect(stats.shieldOverflow).toBe(6);

    expect(stats.rawRepair).toBe(5);
    expect(stats.effectiveRepair).toBe(4);
    expect(stats.repairCapped).toBe(true);
    expect(stats.repairOverflow).toBe(1);
  });

  it('暂存物品不加战力、不计卖价；舍弃撤销准确还原 ID、形状与坐标', () => {
    let bay: CargoBayState = {
      placed: [{ item: makeItem('c1', 'cargo.alloy_bar', 25), x: 2, y: 1, rotation: 1 }],
      staging: [
        { item: makeItem('l_stage', 'equipment.laser.improved', 16), rotation: 0 },
        { item: makeItem('g_stage', 'cargo.old_engine', 50), rotation: 0 },
      ],
      discardedThisArrange: [],
    };

    const stats = calculateBuildStats(bay);
    expect(stats.totalAttack).toBe(4); // staging laser excluded
    expect(stats.totalBayValue).toBe(25); // staging items excluded

    // Discard placed cargo c1, then undo
    const dRes = discardItem(bay, 'c1');
    expect(dRes.ok).toBe(true);
    expect(dRes.bay.placed.length).toBe(0);
    expect(dRes.bay.discardedThisArrange.length).toBe(1);

    const uRes = undoDiscard(dRes.bay);
    expect(uRes.ok).toBe(true);
    expect(uRes.restoredTo).toBe('grid');
    expect(uRes.bay.placed.length).toBe(1);
    expect(uRes.bay.placed[0].item.instanceId).toBe('c1');
    expect(uRes.bay.placed[0].x).toBe(2);
    expect(uRes.bay.placed[0].y).toBe(1);
    expect(uRes.bay.placed[0].rotation).toBe(1);
  });
});

describe('§11 规则边界 — 同步交火与策划书算例校验', () => {
  it('策划书 §2 核心算例：敌 30/4，我 13/7 5轮战败；换炮变 13/10 3轮险胜剩 1 血', () => {
    const enemy = {
      name: '测试敌舰',
      archetype: 'frigate' as const,
      isDanger: false,
      maxHp: 30,
      damagePerRound: 4,
    };

    const lose = simulateCombat(
      { maxHp: 30, totalAttack: 7, effectiveShield: 0, effectiveRepair: 0 },
      13,
      enemy,
      12
    );
    expect(lose.outcome).toBe('defeat');
    expect(lose.roundsCount).toBe(4); // 4 rounds * 4 dmg = 16 >= 13 HP -> dies on round 4 before finishing 5th round!
    expect(lose.finalPlayerHp).toBe(0);

    const win = simulateCombat(
      { maxHp: 30, totalAttack: 10, effectiveShield: 0, effectiveRepair: 0 },
      13,
      enemy,
      12
    );
    expect(win.outcome).toBe('victory');
    expect(win.roundsCount).toBe(3);
    expect(win.totalHpLoss).toBe(12);
    expect(win.finalPlayerHp).toBe(1);
  });

  it('同归于尽判失败；护盾先扣；胜利维修晚于胜负判定且不超上限', () => {
    const enemy = {
      name: '同归于尽测试',
      archetype: 'scout' as const,
      isDanger: false,
      maxHp: 10,
      damagePerRound: 10,
    };

    // Mutual destruction: player HP 10, shield 0, ATK 10, repair 4 -> BOTH reach 0 on round 1 -> DEFEAT, repair does NOT revive!
    const mutual = simulateCombat(
      { maxHp: 30, totalAttack: 10, effectiveShield: 0, effectiveRepair: 4 },
      10,
      enemy,
      10
    );
    expect(mutual.outcome).toBe('defeat');
    expect(mutual.repairApplied).toBe(0);
    expect(mutual.finalPlayerHp).toBe(0);
    expect(mutual.bountyEarned).toBe(0);

    // Shield absorbs first, then victory repair caps at maxHp 30
    const shielded = simulateCombat(
      { maxHp: 30, totalAttack: 10, effectiveShield: 8, effectiveRepair: 4 },
      29,
      enemy,
      10
    );
    expect(shielded.outcome).toBe('victory');
    expect(shielded.totalShieldAbsorbed).toBe(8);
    expect(shielded.totalHpLoss).toBe(2);
    expect(shielded.hpBeforeRepair).toBe(27);
    expect(shielded.repairApplied).toBe(3); // capped at 30
    expect(shielded.finalPlayerHp).toBe(30);
  });
});

describe('§11 规则边界 — 出航状态机、奖励防重抽、节点边界与幂等结算', () => {
  it('预测与实战完全一致；第 6 节点禁止越界进入第 7 层', () => {
    let exp = startExpedition({ loadoutId: 'cannon_skiff', seed: 424242, isTutorial: false });
    // Equip a strong test loadout so the ship clears all 6 nodes to test the node-6 boundary
    exp = {
      ...exp,
      bay: {
        ...exp.bay,
        placed: [
          ...exp.bay.placed,
          { item: makeItem('t_l2', 'equipment.laser.improved', 16), x: 2, y: 1, rotation: 0 },
          { item: makeItem('t_b1', 'equipment.battery.improved', 12), x: 0, y: 1, rotation: 0 },
          { item: makeItem('t_s1', 'equipment.shield.improved', 16), x: 3, y: 0, rotation: 0 },
        ],
      },
    };

    for (let node = 1; node <= 6; node++) {
      expect(exp.currentNode).toBe(node);
      const preview = getRoutePreview(exp, 'normal');
      exp = selectRoute(exp, 'normal');
      expect(exp.activeCombat?.simulation).toEqual(preview.prediction);

      exp = completeCombat(exp);
      expect(exp.phase).toBe('REWARD');
      exp = selectReward(exp, 'repair');
      expect(exp.phase).toBe('ARRANGE');
      expect(exp.bay.staging.length).toBe(0);

      if (node < 6) {
        exp = proceedToNextNode(exp);
      } else {
        // Node 6 MUST refuse proceeding to node 7
        expect(() => proceedToNextNode(exp)).toThrow();
        exp = initiateSafeReturn(exp);
        expect(exp.phase).toBe('SETTLEMENT');
      }
    }
    expect(exp.completedNodes).toBe(6);
  });

  it('连续两次设备类型相同，第三次必从其余三种抽取；相同种子状态产生相同奖励', () => {
    let exp1 = startExpedition({ loadoutId: 'cannon_skiff', seed: 998877, maxNodes: 6 });
    let exp2 = startExpedition({ loadoutId: 'cannon_skiff', seed: 998877, maxNodes: 6 });

    exp1 = completeCombat(selectRoute(exp1, 'normal'));
    exp2 = completeCombat(selectRoute(exp2, 'normal'));
    expect(exp1.pendingRewards).toEqual(exp2.pendingRewards);

    // Check anti-3-peat across 40 consecutive simulated draws
    let run = startExpedition({ loadoutId: 'cannon_skiff', seed: 12345, maxNodes: 6 });
    const history: string[] = [];
    for (let i = 0; i < 40; i++) {
      // Force back to node 1 route select while preserving rngCursor & recentEquipmentKinds
      run = { ...run, currentNode: 1, currentHp: 30, phase: 'ROUTE_SELECT' };
      run = completeCombat(selectRoute(run, 'normal'));
      const eq = run.pendingRewards?.find((r) => r.kind === 'equipment');
      expect(eq).toBeTruthy();
      if (eq && eq.kind === 'equipment') {
        const kind = eq.item.defId.split('.')[1];
        history.push(kind);
        if (history.length >= 3) {
          const n = history.length;
          const threeInARow =
            history[n - 1] === history[n - 2] && history[n - 2] === history[n - 3];
          expect(threeInARow).toBe(false);
        }
      }
    }
  });

  it('满舱可舍弃新奖励继续；借用设备不计收益；收藏保留不重复卖钱；重复结算幂等', () => {
    let prog = createInitialProgression();
    let exp = startExpedition({ loadoutId: 'cannon_skiff', seed: 777, isTutorial: false });
    exp = completeCombat(selectRoute(exp, 'normal'));
    exp = selectReward(exp, 'cargo');

    // Discard staging item and proceed cleanly
    const stagedId = exp.bay.staging[0].item.instanceId;
    const d = discardItem(exp.bay, stagedId);
    expect(d.ok).toBe(true);
    exp = updateArrangeBay(exp, d.bay);

    // Move starter laser to (0,0)-(0,1) so T4 ancient_navigator fits cleanly at (1,0) rotated or (1,2)
    const moved = movePlacedItem(exp.bay, exp.bay.placed[0].item.instanceId, 0, 0, 0);
    expect(moved.ok).toBe(true);
    exp = updateArrangeBay(exp, moved.bay);

    // Add an ancient_navigator (T4) at (1,2) -> cells (1,2),(2,2),(3,2),(2,3)
    const navPrice = computeCargoPrice('ancient_navigator', 3, 'normal');
    const navItem = makeItem('nav_1', 'cargo.ancient_navigator', navPrice, false);
    const placeRes = placeFromStaging(
      { ...exp.bay, staging: [{ item: navItem, rotation: 0 }] },
      'nav_1',
      1,
      2,
      0
    );
    expect(placeRes.ok).toBe(true);
    exp = {
      ...exp,
      bay: placeRes.bay,
      discoveredDuringRun: [...exp.discoveredDuringRun, 'cargo.ancient_navigator'],
    };
    exp = initiateSafeReturn(exp);

    // Keep navigator -> 0 credits for navigator, +1 stored relic; borrowed laser = 0 credits
    const keptPreview = calculateSettlement(exp, prog, ['nav_1']);
    expect(keptPreview.cargoCredits).toBe(0);
    expect(keptPreview.equipmentRecycleCredits).toBe(0);
    expect(keptPreview.bountyCredits).toBe(5);
    expect(keptPreview.finalCreditsEarned).toBe(5);
    expect(keptPreview.keptRelicCount).toBe(1);

    // Sell navigator -> pays navPrice
    const sellPreview = calculateSettlement(exp, prog, []);
    expect(sellPreview.finalCreditsEarned).toBe(5 + navPrice);
    expect(sellPreview.keptRelicCount).toBe(0);

    // Idempotent settlement: applying twice NEVER pays twice
    const s1 = applyExpeditionSettlement(prog, exp, ['nav_1']);
    expect(s1.alreadySettled).toBe(false);
    expect(s1.progression.credits).toBe(5);
    expect(s1.progression.relics.ancient_navigator.storedCount).toBe(1);

    const s2 = applyExpeditionSettlement(s1.progression, exp, ['nav_1']);
    expect(s2.alreadySettled).toBe(true);
    expect(s2.progression.credits).toBe(5);
    expect(s2.progression.relics.ancient_navigator.storedCount).toBe(1);

    // Defeat settlement: 40% floor, NO physical relic stored, discovery retained
    const defeatExp = {
      ...exp,
      expeditionId: 'exp_defeat_test',
      settlementReason: 'defeat' as const,
    };
    const dSettle = applyExpeditionSettlement(createInitialProgression(), defeatExp, ['nav_1']);
    expect(dSettle.summary.finalCreditsEarned).toBe(Math.floor((5 + navPrice) * 0.4));
    expect(dSettle.progression.relics.ancient_navigator.storedCount).toBe(0);
    expect(dSettle.progression.discoveredItems).toContain('cargo.ancient_navigator');
  });

  it('教学局第 3 站安全返航至少获得 40 信用点（足够立即修复工作台）', () => {
    const prog = createInitialProgression();
    let exp = startExpedition({ loadoutId: 'cannon_skiff', isTutorial: true, seed: 1001 });

    // Worst case: player picks repair all 3 nodes (only bounties 5+8+12=25 + 15 first-run bonus = 40)
    for (let n = 1; n <= 3; n++) {
      exp = completeCombat(selectRoute(exp, 'normal'));
      exp = selectReward(exp, 'repair');
      if (n < 3) exp = proceedToNextNode(exp);
    }
    exp = initiateSafeReturn(exp);
    const settled = applyExpeditionSettlement(prog, exp);
    expect(settled.summary.tutorialBonusCredits).toBe(FIRST_EXPEDITION_BONUS_CREDITS);
    expect(settled.progression.credits).toBeGreaterThanOrEqual(40);

    const buildRes = purchaseBuilding(settled.progression, 'workbench');
    expect(buildRes.ok).toBe(true);
    expect(buildRes.progression.buildings.workbench).toBe(true);
  });

  it('基地建设前置条件与藏品修复流转', () => {
    let prog = { ...createInitialProgression(), credits: 500 };
    // Cannot build display before workbench
    expect(purchaseBuilding(prog, 'display').ok).toBe(false);

    prog = purchaseBuilding(prog, 'workbench').progression;
    prog = purchaseBuilding(prog, 'display').progression;
    prog = purchaseBuilding(prog, 'drydock').progression;

    // Cannot restore relic before bringing one back
    expect(restoreRelic(prog, 'ancient_navigator').ok).toBe(false);

    // With 1 stored relic -> restores cleanly
    prog = {
      ...prog,
      relics: { ancient_navigator: { storedCount: 1, restored: false } },
    };
    const r = restoreRelic(prog, 'ancient_navigator');
    expect(r.ok).toBe(true);
    expect(r.progression.relics.ancient_navigator.restored).toBe(true);
    expect(r.progression.relics.ancient_navigator.storedCount).toBe(0);
  });
});

describe('§11 规则边界 — 存档备份恢复与存储异常提示', () => {
  it('主存档损坏时自动检测并提供备份恢复；写入失败诚实返回错误', () => {
    const storage = new MemoryStorage();
    const save1 = createFreshSaveData();
    const save2 = {
      ...save1,
      progression: { ...save1.progression, credits: 123 },
    };

    expect(persistSaveData(storage, save1).ok).toBe(true);
    expect(persistSaveData(storage, save2).ok).toBe(true);

    // Primary has 123, backup has 0
    expect(storage.getItem(PRIMARY_SAVE_KEY)).toContain('"credits":123');
    expect(storage.getItem(BACKUP_SAVE_KEY)).toContain('"credits":0');

    // Corrupt primary
    storage.setItem(PRIMARY_SAVE_KEY, '{corrupt json!!!');
    const loaded = loadSaveData(storage);
    expect(loaded.status).toBe('corrupt_with_backup');
    if (loaded.status === 'corrupt_with_backup') {
      expect(loaded.backup.progression.credits).toBe(0);
    }

    // Storage write failure
    storage.failWrites = true;
    const writeFail = persistSaveData(storage, save2);
    expect(writeFail.ok).toBe(false);
    expect(writeFail.error).toBeTruthy();
  });

  it('危险航路数值公式校验', () => {
    const n3 = getRouteSpec(3, 'normal');
    const d3 = getRouteSpec(3, 'danger');
    expect(d3.enemy.maxHp).toBe(Math.ceil(n3.enemy.maxHp * 1.3));
    expect(d3.enemy.damagePerRound).toBe(n3.enemy.damagePerRound + 1);
    expect(d3.bounty).toBe(Math.round(n3.bounty * 1.6));
    expect(d3.improvedEquipmentProb).toBeCloseTo(0.45, 5);

    const d6 = getRouteSpec(6, 'danger');
    expect(d6.improvedEquipmentProb).toBe(0.75); // capped at 75%
  });
});
