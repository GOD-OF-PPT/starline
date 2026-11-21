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
    routeHint: '教学第 1 站：舱内已装入外围打捞货（卖钱但占格）。查看预计战后耐久，点击「确认进入交火」。',
    rewardHint: '胜利三选一：激光炮加火力，合金条卖信用点，维修不占格。选激光炮试试旋转摆放！',
    arrangeHint: '把暂存区激光炮旋转 90° 后放入底部空位 (0,3)-(1,3)，摆好后前往第 2 站。',
  },
  2: {
    node: 2,
    equipment: { kind: 'battery', quality: 'common' },
    cargo: 'data_box',
    routeHint: '教学第 2 站：火力越高交火越短、战损越少。确认进入第 2 战。',
    rewardHint: '出现「能量电池」(1×1)！选它放入激光炮正交相邻格，感受火力跳升。',
    arrangeHint: '将电池放入 (2,2) 紧贴借用激光炮（上下左右有效，斜角无效），观察攻击力与连线！',
  },
  3: {
    node: 3,
    equipment: { kind: 'shield', quality: 'common' },
    cargo: 'old_engine',
    routeHint: '教学第 3 站：船舱已接近满载。普通航路稳健，危险航路敌强但回报 ×1.6。',
    rewardHint: '护盾板 (1×2) 与高价旧引擎 (2×2) 已现身，但剩余舱格装不下全部物品——挑一件进入空间取舍！',
    arrangeHint:
      '舱格已满！必须舍弃部分旧货腾出空间，或放弃新奖励直接点击「安全返航」，回港修复拆解工作台！',
  },
};

export const TUTORIAL_MAX_RECOMMENDED_NODE = 3;
