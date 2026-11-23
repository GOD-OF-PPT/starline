import type { SeededRng } from '../../domain/rng';
import {
  V2_CARGO_DEFS,
  V2_EXTENDED_RELIC_CARGO_KINDS,
  V2_REGULAR_CARGO_KINDS,
  computeV2CargoPrice,
} from './cargo';
import { V2_SHAPES } from './shapes';
import { getV3SectorDef } from './sectors';
import { createV2CargoInstance } from '../domain/itemCatalog';
import type { SectorId, V2AnomalyPayload, V2DistressPayload } from '../domain/types';

export interface SectorEventDrawOptions {
  readonly layer?: number;
  readonly nextUid?: (prefix: string) => string;
  readonly guaranteedRelicDefId?: string | null;
  readonly cargoPriceMult?: number;
}

export interface SectorEventDrawResult {
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
  readonly anomaly?: V2AnomalyPayload;
  readonly distress?: V2DistressPayload;
}

interface EventTemplateMeta {
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
  readonly safeFuelCost?: number;
  readonly breachHpCost?: number;
  readonly rescueFuelCost?: number;
  readonly repairAmount?: number;
}

const SECTOR_ANOMALY_TEMPLATES: Record<SectorId, readonly EventTemplateMeta[]> = {
  near_orbit: [
    {
      eventId: 'evt_near_anom_ion_cloud',
      title: '近轨电离云团',
      description: '残骸带边缘漂浮着微弱放电云团，内藏高价货箱信号。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
    {
      eventId: 'evt_near_anom_relay_drift',
      title: '失联信标漂流带',
      description: '一组旧航道中继器正释放间歇电弧，绕行或强闯均可夺取货件。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
    {
      eventId: 'evt_near_anom_debris_eddy',
      title: '碎铁涡流区',
      description: '高速旋转的船壳碎片环绕着封存货舱，考验耗油绕飞或硬抗冲击。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
  ],
  frozen_graveyard: [
    {
      eventId: 'evt_cryo_anom_frost_storm',
      title: '冰晶磁暴带',
      description: '低温冰晶云团折射出高能货舱回波，强行切入将承受剧烈冰雹刮擦。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
    {
      eventId: 'evt_cryo_anom_frozen_vault',
      title: '封冻军需残舱',
      description: '半凝固的冷却液包裹着旧舰队补给舱，需精准控油或强破外甲。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
    {
      eventId: 'evt_cryo_anom_ion_halo',
      title: '低温电离光环',
      description: '残破反应堆周遭凝结出高密电离环，核心飘浮着高估价打捞品。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
  ],
  stargate_abyss: [
    {
      eventId: 'evt_gate_anom_gravity_well',
      title: '星门引力井边缘',
      description: '残存星门环喷涌周期性引力波，货件在潮汐节点间短暂浮现。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
    {
      eventId: 'evt_gate_anom_echo_rift',
      title: '古星门回响裂隙',
      description: '跃迁残波撕开短暂空洞，显露出旧纪元旗舰留下的高能货柜。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
    {
      eventId: 'evt_gate_anom_obsidian_wake',
      title: '黑曜尾迹乱流',
      description: '大型旗舰跃迁后留下的高能尾流尚未消散，里面夹杂着珍贵构件。',
      safeFuelCost: 1,
      breachHpCost: 4,
    },
  ],
};

const SECTOR_DISTRESS_TEMPLATES: Record<SectorId, readonly EventTemplateMeta[]> = {
  near_orbit: [
    {
      eventId: 'evt_near_dist_freighter',
      title: '近轨民船求救信标',
      description: '一艘动力失灵的矿运船发出抢修请求，亦可直接回收其弃置货箱。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
    {
      eventId: 'evt_near_dist_tugboat',
      title: '轨道拖船故障信号',
      description: '失控拖船的维修队承诺回馈应急焊修，一旁散落着未固定货物。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
    {
      eventId: 'evt_near_dist_survey_pod',
      title: '民用测绘艇求援',
      description: '测绘艇推进器熄火，耗油施救可换取船体抢修或直接打捞漂散货舱。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
  ],
  frozen_graveyard: [
    {
      eventId: 'evt_cryo_dist_icebreaker',
      title: '破冰打捞艇求救',
      description: '冰晶舰冢内一艘破冰艇被冻住舵机，施救可获寒区抢修支援。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
    {
      eventId: 'evt_cryo_dist_convoy',
      title: '失联科考护卫信号',
      description: '深空科考艇在低温区发出低频求援，邻近漂浮着封存货柜。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
    {
      eventId: 'evt_cryo_dist_beacon',
      title: '冰封救生中继',
      description: '应急维修浮标仍有残余能源，可耗油对接抢修或拆走高价样本箱。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
  ],
  stargate_abyss: [
    {
      eventId: 'evt_gate_dist_vanguard',
      title: '先行探测舰求援',
      description: '深入星门禁区的探测艇遭遇引力剪切，对接施救可换取应急装甲修补。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
    {
      eventId: 'evt_gate_dist_archivist',
      title: '遗物考古艇信号',
      description: '星门考古队被困潮汐区，施救换取修复或零油耗回收其外挂货舱。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
    {
      eventId: 'evt_gate_dist_relay',
      title: '古星门维护坞残端',
      description: '半自动维修坞仍响应对接码，可消耗 1 燃料快速修船或直接打捞仓储。',
      rescueFuelCost: 1,
      repairAmount: 10,
    },
  ],
};

function computeScaledCargoValue(defId: string, layer: number, cargoPriceMult: number): number {
  const base = computeV2CargoPrice(defId, layer);
  if (cargoPriceMult === 1) return base;
  return Math.max(1, Math.round(base * cargoPriceMult));
}

function pickSectorEventCargoDefId(
  sectorId: SectorId,
  layer: number,
  rng: SeededRng,
  isHighTierAnomaly: boolean,
  guaranteedRelicDefId?: string | null
): string {
  if (guaranteedRelicDefId && Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, guaranteedRelicDefId)) {
    return guaranteedRelicDefId;
  }
  const sector = getV3SectorDef(sectorId);
  if (layer >= 4) {
    const extProb = isHighTierAnomaly
      ? Math.min(0.4, sector.relicDropChanceDeep + 0.1)
      : sector.relicDropChanceDeep;
    if (rng.nextFloat() < extProb) {
      if (sector.signatureRelicIds.length > 0 && rng.nextFloat() < 0.7) {
        const relicId = rng.pick(sector.signatureRelicIds);
        const sigDefId = `cargo.${relicId}`;
        if (Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, sigDefId)) {
          return sigDefId;
        }
      }
      return `cargo.${rng.pick(V2_EXTENDED_RELIC_CARGO_KINDS)}`;
    }
  }
  return `cargo.${rng.pick(V2_REGULAR_CARGO_KINDS)}`;
}

/**
 * Interface Contract #3 Pluggable Sector Event Registry Hook.
 * Called by `routeGenerator.ts` so M2 ships sector-aware non-repeating Anomaly/Distress pools
 * and M4 can expand to 16+ narrative events strictly inside `src/v2/data/events.ts`.
 */
export function drawSectorEventPayload(
  sectorId: SectorId,
  nodeType: 'anomaly' | 'distress',
  usedEventIds: readonly string[],
  rng: SeededRng,
  options?: SectorEventDrawOptions
): SectorEventDrawResult {
  const sector = getV3SectorDef(sectorId);
  const layer = options?.layer ?? 2;
  const priceMult = options?.cargoPriceMult ?? sector.cargoPriceMult;
  let seq = 1;
  const nextUid = options?.nextUid ?? ((prefix: string) => `${prefix}_${layer}_${seq++}`);

  const pool =
    nodeType === 'anomaly'
      ? SECTOR_ANOMALY_TEMPLATES[sectorId] ?? SECTOR_ANOMALY_TEMPLATES.near_orbit
      : SECTOR_DISTRESS_TEMPLATES[sectorId] ?? SECTOR_DISTRESS_TEMPLATES.near_orbit;

  const unused = pool.filter((e) => !usedEventIds.includes(e.eventId));
  const chosen = unused.length > 0 ? rng.pick(unused) : rng.pick(pool);

  if (nodeType === 'anomaly') {
    const defId = pickSectorEventCargoDefId(
      sectorId,
      layer,
      rng,
      layer >= 4,
      options?.guaranteedRelicDefId
    );
    const def = V2_CARGO_DEFS[defId] ?? V2_CARGO_DEFS['cargo.alloy_bar'];
    const unitVal = computeScaledCargoValue(def.defId, layer, priceMult);
    const safeCargoItem = createV2CargoInstance({
      instanceId: nextUid('anom_safe'),
      defId: def.defId,
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
      fixedValueOverride: unitVal,
    });
    const breach1 = createV2CargoInstance({
      instanceId: nextUid('anom_b1'),
      defId: def.defId,
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
      fixedValueOverride: unitVal,
    });
    const breach2 = createV2CargoInstance({
      instanceId: nextUid('anom_b2'),
      defId: def.defId,
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
      fixedValueOverride: unitVal,
    });
    const payload: V2AnomalyPayload = {
      cargoCategoryLabel: `${def.name}（${V2_SHAPES[def.shapeId].label} · 单件 ${unitVal}¤）`,
      safeFuelCost: chosen.safeFuelCost ?? 1,
      safeCargoItem,
      breachHpCost: chosen.breachHpCost ?? 4,
      breachCargoItems: [breach1, breach2],
      chosenOption: null,
    };
    return {
      eventId: chosen.eventId,
      title: chosen.title,
      description: chosen.description,
      anomaly: payload,
    };
  }

  const defId = pickSectorEventCargoDefId(
    sectorId,
    layer,
    rng,
    false,
    options?.guaranteedRelicDefId
  );
  const def = V2_CARGO_DEFS[defId] ?? V2_CARGO_DEFS['cargo.alloy_bar'];
  const unitVal = computeScaledCargoValue(def.defId, layer, priceMult);
  const haulCargoItem = createV2CargoInstance({
    instanceId: nextUid('dist_cg'),
    defId: def.defId,
    origin: 'loot',
    acquiredDepth: layer,
    location: 'staging',
    fixedValueOverride: unitVal,
  });
  const payload: V2DistressPayload = {
    rescueFuelCost: chosen.rescueFuelCost ?? 1,
    repairAmount: chosen.repairAmount ?? 10,
    haulCargoItem,
    chosenOption: null,
  };
  return {
    eventId: chosen.eventId,
    title: chosen.title,
    description: chosen.description,
    distress: payload,
  };
}
