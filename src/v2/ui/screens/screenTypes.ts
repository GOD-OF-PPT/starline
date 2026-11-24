import type { SectorBgIndex } from '../../../data/nodes';
import { CAMPAIGN_CHAPTERS } from '../../data/campaign';
import type { V2CrewId } from '../../data/crew';
import type { V2EnemyUnitSpec } from '../../data/enemies';
import {
  getV2EquipmentDefByKind,
  type V2ArchetypeId,
  type V2EquipmentKind,
} from '../../data/equipment';
import { V3_SECTORS } from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import type { V2ShipId } from '../../data/ships';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2PrepareSlotEntry, V2ResolvedPresetSlot } from '../../domain/loadout';
import type { V2ShipVisualSpec } from '../../domain/shipVisualSpec';
import type {
  CampaignActId,
  SectorId,
  V2CargoBayState,
  V2NodeType,
  V2RunState,
  V2TrialBuildId,
} from '../../domain/types';
import { crewPortraitSvg, svgIcon, type V2IconName } from '../icons';

/**
 * Stateful PhaseView lifecycle contract (PROJECT.md § Interface Contracts #6).
 * - `mount(host)` creates persistent DOM skeleton and binds delegated/static listeners once.
 * - `update(props, actions)` reconciles dynamic text, attributes, classes, and keyed children in-place.
 * - `unmount()` removes all event listeners, detaches DOM cleanly, and releases references.
 */
export interface PhaseView<P, A> {
  mount(host: HTMLElement): void;
  update(props: P, actions: A): void;
  unmount(): void;
}

export interface V2PrepareDraft {
  contractTemplateId: string;
  sectorId: SectorId;
  shipId: V2ShipId;
  crewId: V2CrewId | null;
  primaryArchetype: V2ArchetypeId;
  trialBuildId: V2TrialBuildId | null;
  playingDemo: boolean;
  demoPlaybackKey: string | null;
  slots: V2PrepareSlotEntry[];
  missingPresetEntries: readonly V2ResolvedPresetSlot[];
  presetNotice: string | null;
  isFinalCampaignRun: boolean;
  endlessThreat: number;
  customSeedInput: string;
  defaultSeed: number;
}

export interface V2ReturnDockingNotice {
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  readonly earnedCredits: number;
  readonly earnedParts?: number;
  readonly contractCompleted: boolean;
  readonly unlockedText: string | null;
  readonly crateCount: number;
  readonly hasKeptRelic: boolean;
  readonly wasDefeat: boolean;
  animating: boolean;
  progress: number;
}

export interface NextBaseGoal {
  readonly title: string;
  readonly detail: string;
  readonly actionKind: 'facilities' | 'warehouse' | 'relics';
  readonly targetCost?: number;
  readonly ready: boolean;
}

export const NODE_TYPE_META: Record<
  V2NodeType,
  { readonly label: string; readonly icon: V2IconName; readonly cls: string }
> = {
  combat: { label: '敌舰巡逻', icon: 'combat', cls: 'node-combat' },
  elite: { label: '精英旗舰', icon: 'elite', cls: 'node-elite' },
  boss: { label: '星区首领', icon: 'boss', cls: 'node-boss' },
  wreck: { label: '废船打捞', icon: 'wreck', cls: 'node-wreck' },
  merchant: { label: '流动商人', icon: 'merchant', cls: 'node-merchant' },
  anomaly: { label: '异常星区', icon: 'anomaly', cls: 'node-anomaly' },
  distress: { label: '求救信号', icon: 'distress', cls: 'node-distress' },
};

export const ARCHETYPE_ORDER: readonly V2ArchetypeId[] = ['laser', 'heavy', 'hangar', 'counter'];

export const CAMPAIGN_ACT_LABELS: Record<CampaignActId, string> = {
  prologue: CAMPAIGN_CHAPTERS.prologue.title,
  act1: CAMPAIGN_CHAPTERS.act1.title,
  act2: CAMPAIGN_CHAPTERS.act2.title,
  act3: CAMPAIGN_CHAPTERS.act3.title,
  endless: CAMPAIGN_CHAPTERS.endless.title,
};

export const SECTOR_DISPLAY_NAMES: Record<
  SectorId,
  { readonly name: string; readonly brief: string }
> = {
  near_orbit: {
    name: V3_SECTORS.near_orbit.name,
    brief: V3_SECTORS.near_orbit.envModifier.shortBadge,
  },
  frozen_graveyard: {
    name: V3_SECTORS.frozen_graveyard.name,
    brief: V3_SECTORS.frozen_graveyard.envModifier.shortBadge,
  },
  stargate_abyss: {
    name: V3_SECTORS.stargate_abyss.name,
    brief: V3_SECTORS.stargate_abyss.envModifier.shortBadge,
  },
};

export function findEngineerSwapTargetInBay(
  bay: V2CargoBayState,
  targetInstanceId: string
): { readonly name: string; readonly quality: 'common' | 'improved' } | null {
  const staged = bay.staging.find((s) => s.item.instanceId === targetInstanceId);
  if (staged) {
    return {
      name: getAnyV2ItemDef(staged.item.definitionId)?.name ?? staged.item.definitionId,
      quality: staged.item.quality,
    };
  }
  const placed = bay.placed.find((p) => p.item.instanceId === targetInstanceId);
  if (placed) {
    return {
      name: getAnyV2ItemDef(placed.item.definitionId)?.name ?? placed.item.definitionId,
      quality: placed.item.quality,
    };
  }
  return null;
}

/**
 * Shared Engineer Swap banner rendered identically in both SHOP and ARRANGE phases.
 * Guards against stale/sold targetInstanceId so dead banners never appear after merchant sellback.
 */
export function renderEngineerSwapBannerHtml(run: V2RunState, readOnly: boolean): string {
  const offer = run.activeEngineerOffer;
  if (!offer || offer.used) return '';
  const target = findEngineerSwapTargetInBay(run.bay, offer.targetInstanceId);
  if (!target) return '';

  const preservesImproved =
    run.crewId === 'engineer' &&
    (run.crewMasteryTier ?? 0) >= 2 &&
    target.quality === 'improved';
  const qualityForButtons = preservesImproved ? 'improved' : 'common';

  return `<div class="v2-engineer-banner" data-testid="engineer-swap-banner">
    <div class="v2-eng-title">${crewPortraitSvg('engineer', 20)} ${svgIcon('swap', 14)} 林工 · 工程师现场改装（每趟 1 次 · 可将「${target.name}」改为${
    preservesImproved ? '优良件' : ''
  }）</div>
    <div class="v2-eng-btns">
      ${offer.candidates
        .map((kind) => {
          const def = getV2EquipmentDefByKind(kind, qualityForButtons);
          return `<button type="button" class="btn btn-sm btn-secondary" data-eng-swap="${kind}" ${
            readOnly ? 'disabled' : ''
          }>改为 ${def.name}${preservesImproved ? '（良）' : ''} (${V2_SHAPES[def.shapeId].label})</button>`;
        })
        .join('')}
    </div>
  </div>`;
}

export function bindEngineerSwapHandlers(
  root: HTMLElement,
  onSwap: (kind: V2EquipmentKind) => void
): void {
  root.querySelectorAll<HTMLButtonElement>('[data-eng-swap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.engSwap as V2EquipmentKind;
      onSwap(kind);
    });
  });
}

export type V2StaticStageMode =
  | 'prepare'
  | 'wreck'
  | 'pre_combat'
  | 'event'
  | 'map'
  | 'shop'
  | 'reward'
  | 'arrange'
  | 'settlement';

export interface V2StaticStageKeyInput {
  readonly mode: V2StaticStageMode;
  readonly runId: string;
  readonly nodeId: string;
  readonly shipId: V2ShipId;
  readonly sectorId: SectorId;
  readonly sectorIndex: SectorBgIndex;
  readonly eventBackdrop: 'wreck' | 'merchant' | 'anomaly' | 'distress' | null;
  readonly units: readonly V2EnemyUnitSpec[];
}

export function buildV2EnemyFormationKey(units: readonly V2EnemyUnitSpec[]): string {
  if (units.length === 0) return 'none';
  return units
    .map(
      (u) =>
        `${u.enemyId}:${u.spriteArchetype}:${u.maxHp}:${u.damagePerRound}:${u.armor}:${Math.round(
          u.pierceRatio * 100
        )}:${u.initialShield ?? 0}:${u.maxShield ?? u.initialShield ?? 0}:${u.isBoss ? 1 : 0}:${
          u.role ?? ''
        }:${u.name}`
    )
    .join(',');
}

export function buildV2StaticStagePlaybackKey(input: V2StaticStageKeyInput): string {
  return [
    input.mode,
    input.runId,
    input.nodeId,
    input.shipId,
    input.sectorId,
    String(input.sectorIndex),
    input.eventBackdrop ?? 'none',
    buildV2EnemyFormationKey(input.units),
  ].join('|');
}

export interface V2StaticStageHostLike<P> {
  isV2StageMode(): boolean;
  showV2Stage(playback: P): void;
  updateV2ShipVisualSpec(spec: V2ShipVisualSpec | null): void;
}

/**
 * Stateful controller-side deduplicator for static V2CombatScene stages (F02).
 * Pure TS (zero Phaser/DOM imports) so V2AppController and Vitest share the exact same logic.
 */
export class V2StaticStageSyncTracker {
  private activeKey: string | null = null;

  getActiveKey(): string | null {
    return this.activeKey;
  }

  reset(): void {
    this.activeKey = null;
  }

  sync<
    P extends {
      readonly playbackKey?: string;
      readonly shipVisualSpec?: V2ShipVisualSpec | null;
    }
  >(
    host: V2StaticStageHostLike<P>,
    keyInput: V2StaticStageKeyInput,
    visualSpec: V2ShipVisualSpec | null,
    buildPlayback: (playbackKey: string) => P
  ): { readonly key: string; readonly reused: boolean } {
    const key = buildV2StaticStagePlaybackKey(keyInput);
    if (this.activeKey === key && host.isV2StageMode()) {
      host.updateV2ShipVisualSpec(visualSpec);
      return { key, reused: true };
    }
    this.activeKey = key;
    host.showV2Stage(buildPlayback(key));
    return { key, reused: false };
  }
}
