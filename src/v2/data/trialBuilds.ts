import { buildEncounterUnits, type V2EnemyUnitSpec } from './enemies';
import type { V2ArchetypeId, V2EquipmentKind } from './equipment';
import type { V2ShipId } from './ships';
import type { V2PrepareSlotEntry } from '../domain/loadout';
import type { V2TrialBuildId } from '../domain/types';

export interface V2TrialBuildSpec {
  readonly id: V2TrialBuildId;
  readonly name: string;
  readonly shortName: string;
  readonly archetypeId: V2ArchetypeId;
  readonly tagline: string;
  readonly advantage: string;
  readonly tradeoff: string;
  readonly allowedKinds: readonly V2EquipmentKind[];
  readonly demoEnemyTitle: string;
  readonly demoHint: string;
}

export const V2_TRIAL_BUILD_ORDER: readonly V2TrialBuildId[] = [
  'trial_heavy',
  'trial_hangar',
  'trial_counter',
];

export const V2_TRIAL_BUILDS: Record<V2TrialBuildId, V2TrialBuildSpec> = {
  trial_heavy: {
    id: 'trial_heavy',
    name: '重炮破甲方案',
    shortName: '重炮破甲',
    archetypeId: 'heavy',
    tagline: '重炮 + 蓄能器抢占第 1 轮先手，单发高伤击穿重甲',
    advantage: '克制装甲护卫舰 · 首轮即轰出 12 点重炮直伤',
    tradeoff: '遇 4 目标蜂群易过量溢出，且偶数轮进入蓄能空窗',
    allowedKinds: ['heavy', 'capacitor', 'shield'],
    demoEnemyTitle: '装甲护卫舰（护甲 2）',
    demoHint: '蓄能器贴邻重炮 → 第 1、3 轮直接破甲重击',
  },
  trial_hangar: {
    id: 'trial_hangar',
    name: '无人机编队方案',
    shortName: '无人机编队',
    archetypeId: 'hangar',
    tagline: '无人机库 + 编队中继每轮扩编，满编 4 架持续压制',
    advantage: '中长战越打越猛 · 蜂群与常规敌舰通吃',
    tradeoff: '首轮仅升空 1 架输出偏薄，遇重甲逐发受减伤',
    allowedKinds: ['hangar', 'relay', 'shield'],
    demoEnemyTitle: '巡逻拾荒艇（20 耐久）',
    demoHint: '每轮机库开门递增 1→2→3→4 架编队齐射',
  },
  trial_counter: {
    id: 'trial_counter',
    name: '护盾反击方案',
    shortName: '护盾反击',
    archetypeId: 'counter',
    tagline: '双护盾板夹护反击器，硬吃齐射并将能量电弧劈回敌舰',
    advantage: '高盾低战损 · 接敌火力越猛反击回射越痛',
    tradeoff: '遇 50% 穿盾猎手时吸收锐减，反击收益显著下降',
    allowedKinds: ['shield', 'counter'],
    demoEnemyTitle: '双巡逻快艇（齐射 6 伤）',
    demoHint: '护盾吸收实伤后立即回流至反击环劈出电弧',
  },
};

/**
 * Builds an exact, orthogonally linked, budget-legal common borrowed loadout for the selected trial build.
 * Strictly obeys ship loadoutBudget (6 on 4×4 hulls, 5 on 5×4 heavy freighter) and hull disabledCells.
 */
export function buildTrialPrepareSlots(
  trialId: V2TrialBuildId,
  shipId: V2ShipId
): readonly V2PrepareSlotEntry[] {
  const isFreighter = shipId === 'heavy_freighter';

  if (trialId === 'trial_heavy') {
    const base: V2PrepareSlotEntry[] = [
      {
        slotKey: 'trial_heavy_1',
        origin: 'loan',
        definitionId: 'equipment.heavy.common', // 1x3, budget 3 -> (0,0),(0,1),(0,2)
        x: 0,
        y: 0,
        rotation: 0,
      },
      {
        slotKey: 'trial_heavy_2',
        origin: 'loan',
        definitionId: 'equipment.capacitor.common', // 1x1, budget 1 -> (1,0) adjacent!
        x: 1,
        y: 0,
        rotation: 0,
      },
    ];
    if (!isFreighter) {
      base.push({
        slotKey: 'trial_heavy_3',
        origin: 'loan',
        definitionId: 'equipment.shield.common', // 1x2, budget 2 -> (2,0),(2,1) (total 6/6)
        x: 2,
        y: 0,
        rotation: 0,
      });
    }
    return base;
  }

  if (trialId === 'trial_hangar') {
    const base: V2PrepareSlotEntry[] = [
      {
        slotKey: 'trial_hangar_1',
        origin: 'loan',
        definitionId: 'equipment.hangar.common', // 2x2, budget 3 -> (0,0),(1,0),(0,1),(1,1)
        x: 0,
        y: 0,
        rotation: 0,
      },
      {
        slotKey: 'trial_hangar_2',
        origin: 'loan',
        definitionId: 'equipment.relay.common', // 1x1, budget 1 -> (2,0) adjacent!
        x: 2,
        y: 0,
        rotation: 0,
      },
    ];
    if (!isFreighter) {
      base.push({
        slotKey: 'trial_hangar_3',
        origin: 'loan',
        definitionId: 'equipment.shield.common', // 1x2, budget 2 -> (3,0),(3,1) (total 6/6)
        x: 3,
        y: 0,
        rotation: 0,
      });
    }
    return base;
  }

  // trial_counter
  const base: V2PrepareSlotEntry[] = [
    {
      slotKey: 'trial_counter_1',
      origin: 'loan',
      definitionId: 'equipment.shield.common', // 1x2, budget 2 -> (0,0),(0,1)
      x: 0,
      y: 0,
      rotation: 0,
    },
    {
      slotKey: 'trial_counter_2',
      origin: 'loan',
      definitionId: 'equipment.counter.common', // 1x2, budget 2 -> (1,0),(1,1) adjacent!
      x: 1,
      y: 0,
      rotation: 0,
    },
  ];
  if (!isFreighter) {
    base.push({
      slotKey: 'trial_counter_3',
      origin: 'loan',
      definitionId: 'equipment.shield.common', // 1x2, budget 2 -> (2,0),(2,1) (total 6/6)
      x: 2,
      y: 0,
      rotation: 0,
    });
  }
  return base;
}

/**
 * Checks whether a common-quality loan equipment kind is authorized as part of an active trial kit.
 * Trial kits NEVER allow improved quality, NEVER exceed budget, and NEVER allow mixing non-kit locked parts.
 */
export function isKindAuthorizedByTrialBuild(
  trialBuildId: V2TrialBuildId | null | undefined,
  kind: V2EquipmentKind
): boolean {
  if (!trialBuildId) return false;
  const spec = V2_TRIAL_BUILDS[trialBuildId];
  return Boolean(spec && spec.allowedKinds.includes(kind));
}

/**
 * Returns a deterministic short live-demo encounter tailored to visibly showcase the chosen trial archetype
 * during the 5-second skippable PREPARE preview in V2CombatScene.
 */
export function getTrialDemoUnits(trialId: V2TrialBuildId): readonly V2EnemyUnitSpec[] {
  if (trialId === 'trial_heavy') {
    return buildEncounterUnits('armored', 3, 'demo_heavy');
  }
  if (trialId === 'trial_hangar') {
    return buildEncounterUnits('patrol', 3, 'demo_hangar');
  }
  // trial_counter: two scout raiders dealing 6 total/round so shield absorption + counter arc trigger immediately!
  return [
    {
      enemyId: 'demo_counter_1',
      name: '突袭快艇 A',
      spriteArchetype: 'scout',
      maxHp: 11,
      damagePerRound: 3,
      armor: 0,
      pierceRatio: 0,
    },
    {
      enemyId: 'demo_counter_2',
      name: '突袭快艇 B',
      spriteArchetype: 'scout',
      maxHp: 11,
      damagePerRound: 3,
      armor: 0,
      pierceRatio: 0,
    },
  ];
}
