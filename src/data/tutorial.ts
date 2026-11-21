import type { CargoKind, EquipmentKind, EquipmentQuality } from './items';

export interface TutorialNodeScript {
  readonly node: number;
  readonly equipment: { readonly kind: EquipmentKind; readonly quality: EquipmentQuality };
  readonly cargo: CargoKind;
  readonly routeHint: string;
  readonly rewardHint: string;
  readonly arrangeHint: string;
}

/**
 * Isolated tutorial configuration for the player's first expedition (Blueprint §3: First 5 Minutes).
 * Does not alter normal expedition RNG rules.
 */
export const TUTORIAL_SCRIPT: Record<number, TutorialNodeScript> = {
  1: {
    node: 1,
    equipment: { kind: 'laser', quality: 'common' },
    cargo: 'alloy_bar',
    routeHint: '教学第 1 站：查看敌舰属性与预计战后耐久，点击「进入交火」开始自动战斗。',
    rewardHint: '胜利后三选一：激光炮增强火力，合金条可带回卖钱，维修直接回复耐久。',
    arrangeHint: '把暂存区物品拖入或点选放入 4×4 船舱，点击可旋转。摆好后继续下一站。',
  },
  2: {
    node: 2,
    equipment: { kind: 'battery', quality: 'common' },
    cargo: 'folding_antenna',
    routeHint: '教学第 2 站：注意上方预计损耗。火力越高，交火轮数越少、掉血越少。',
    rewardHint: '本次出现「能量电池」！推荐选它体验贴近激光炮后的火力联动。',
    arrangeHint: '试着把能量电池放在激光炮上下左右相邻一格（斜角无效），观察攻击力跳升！',
  },
  3: {
    node: 3,
    equipment: { kind: 'shield', quality: 'common' },
    cargo: 'old_engine',
    routeHint: '教学第 3 站：普通航路稳健，危险航路敌更强但悬赏与货价 ×1.6。',
    rewardHint: '旧引擎占 2×2 格但非常值钱；护盾板能稳住血线。挑一件带走吧！',
    arrangeHint:
      '舱格开始紧张了：是扔掉旧货装装备，还是见好就收？现在可直接点击「安全返航」，回港修好拆解工作台！',
  },
};

export const TUTORIAL_MAX_RECOMMENDED_NODE = 3;
