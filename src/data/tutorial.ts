import type { CargoKind, EquipmentKind, EquipmentQuality } from './items';
import type { Rotation } from './shapes';

export interface TutorialNodeScript {
  readonly node: number;
  readonly equipment: { readonly kind: EquipmentKind; readonly quality: EquipmentQuality };
  readonly cargo: CargoKind;
  readonly routeHint: string;
  readonly rewardHint: string;
  readonly arrangeHint: string;
}

export interface TutorialPreloadedCargo {
  readonly cargoKind: CargoKind;
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly value: number;
}

/**
 * Isolated pre-loaded salvage in the tutorial skiff (11 cargo cells + 2 borrowed laser = 13/16 cells).
 * Purpose (Blueprint §3 & F05):
 * - Node 1 immediately shows how valuable cargo occupies real space alongside equipment (3 open cells).
 * - Node 1 reward (1x2 laser) -> 15/16 cells; Node 2 reward (1x1 battery at (2,2)) -> 16/16 FULL bay.
 * - Node 3 reward (1x2 shield OR 2x2 high-value old_engine) mathematically CANNOT fit alongside
 *   everything already in the bay -> forces the authentic "keep cargo vs fit equipment / return now" dilemma!
 * Normal expeditions (isTutorial === false) NEVER load this list.
 */
export const TUTORIAL_INITIAL_CARGO: readonly TutorialPreloadedCargo[] = [
  { cargoKind: 'coolant_tank', x: 0, y: 0, rotation: 0, value: 16 }, // (0,0),(0,1),(0,2)
  { cargoKind: 'data_box', x: 1, y: 0, rotation: 0, value: 10 }, // (1,0)
  { cargoKind: 'old_engine', x: 2, y: 0, rotation: 0, value: 20 }, // (2,0),(3,0),(2,1),(3,1)
  { cargoKind: 'folding_antenna', x: 2, y: 2, rotation: 3, value: 18 }, // (3,2),(2,3),(3,3)
];

/**
 * Isolated tutorial configuration for the player's first expedition (Blueprint §3: First 5 Minutes).
 * Does not alter normal expedition RNG rules.
 */
export const TUTORIAL_SCRIPT: Record<number, TutorialNodeScript> = {
  1: {
    node: 1,
    equipment: { kind: 'laser', quality: 'common' },
    cargo: 'alloy_bar',
    routeHint: '选择普通航道跃迁交火',
    rewardHint: '三选一：激光炮 +攻 · 合金条 换钱 · 维修 +血',
    arrangeHint: '旋转激光炮 90° 放入底部空位',
  },
  2: {
    node: 2,
    equipment: { kind: 'battery', quality: 'common' },
    cargo: 'data_box',
    routeHint: '火力提升，进入第 2 站交火',
    rewardHint: '选取能量电池，邻接激光炮可 +2 攻',
    arrangeHint: '把电池放至激光炮上下左右相邻格',
  },
  3: {
    node: 3,
    equipment: { kind: 'shield', quality: 'common' },
    cargo: 'old_engine',
    routeHint: '普通稳健 · 危险回报 ×1.6',
    rewardHint: '选取一件战利品，体验满舱取舍',
    arrangeHint: '舱满！舍弃旧货腾格，或舍弃新奖安全返航',
  },
};

export const TUTORIAL_MAX_RECOMMENDED_NODE = 3;
