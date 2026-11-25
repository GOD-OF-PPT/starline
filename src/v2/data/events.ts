import type { SeededRng } from '../../domain/rng';
import {
  V2_CARGO_DEFS,
  V2_EXTENDED_RELIC_CARGO_KINDS,
  V2_REGULAR_CARGO_KINDS,
  computeV2CargoPrice,
} from './cargo';
import type { V2CrewId } from './crew';
import {
  getUnlockedEquipmentKinds,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from './equipment';
import { getV3SectorDef } from './sectors';
import { V2_SHAPES } from './shapes';
import { createV2CargoInstance, createV2EquipmentInstance } from '../domain/itemCatalog';
import { withV2Stream } from '../domain/rngStreams';
import type {
  FactionId,
  SectorId,
  V2AnomalyPayload,
  V2DistressPayload,
  V2EventOptionState,
  V2EventState,
  V2ItemInstance,
  V2RunState,
} from '../domain/types';

export interface SectorEventDrawOptions {
  readonly layer?: number;
  readonly nextUid?: (prefix: string) => string;
  readonly guaranteedRelicDefId?: string | null;
  readonly cargoPriceMult?: number;
  readonly unlockedFamilies?: readonly V2UnlockFamilyId[];
  readonly nodeId?: string;
}

export interface SectorEventDrawResult {
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
  readonly anomaly?: V2AnomalyPayload;
  readonly distress?: V2DistressPayload;
  readonly eventState: V2EventState;
}

export interface V3EventOptionTemplate {
  readonly label: string;
  readonly costSummary: string;
  readonly rewardSummary: string;
  readonly requiredCrewId?: V2CrewId;
  readonly fuelCost?: number;
  readonly hpCost?: number;
  readonly walletCost?: number;
  readonly isFallback?: boolean;
  readonly rewardCredits?: number;
  readonly rewardParts?: number;
  readonly rewardFuel?: number;
  readonly rewardHp?: number;
  readonly rewardFactionId?: FactionId;
  readonly rewardFactionRep?: number;
  /** Spawn 1-2 loot cargo items (receives guaranteedRelicDefId on first cargo when marked) */
  readonly grantCargoCount?: number;
  /** Spawn 1 unlocked equipment item (common or improved in deep layers) */
  readonly grantEquipment?: boolean;
  readonly preferImprovedEquipment?: boolean;
}

export interface V3EventTemplate {
  readonly eventId: string;
  readonly sectorId: SectorId;
  readonly nodeType: 'anomaly' | 'distress';
  readonly title: string;
  readonly description: string;
  readonly flavorTag: string;
  readonly options: readonly V3EventOptionTemplate[];
}

/**
 * 18 distinct sci-fi salvage & tactical dilemma events (F12):
 * - 6 per sector (near_orbit, frozen_graveyard, stargate_abyss)
 * - 9 anomaly + 9 distress
 * - Every event includes a guaranteed zero-cost `isFallback: true` safe exit option
 * - Crew-specific bonus options distributed evenly across 林工 (engineer), 陆衡 (navigator), 苏岚 (salvager)
 */
export const V3_EVENT_CATALOG: readonly V3EventTemplate[] = [
  // ==================== NEAR ORBIT (6 events: 3 anomaly, 3 distress) ====================
  {
    eventId: 'evt_blackbox_decode',
    sectorId: 'near_orbit',
    nodeType: 'anomaly',
    title: '漂流黑匣破译',
    description:
      '电离碎片带中央漂浮着一只旧纪元加密航行黑匣，外甲焊死但数据总线仍在低频闪烁。强行切割费油，或许工程师能直接接入总线。',
    flavorTag: '近轨异常 · 加密黑匣',
    options: [
      {
        label: '强行撬开外壳（耗 1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '+18¤ 信用点 · +6 精密零件 · 1 件回收货箱',
        fuelCost: 1,
        rewardCredits: 18,
        rewardParts: 6,
        grantCargoCount: 1,
      },
      {
        label: '林工专线解码（工程师专属）',
        costSummary: '无资源消耗（林工专属）',
        rewardSummary: '+25¤ · +6 精密零件 · 1 件完整设备模块',
        requiredCrewId: 'engineer',
        rewardCredits: 25,
        rewardParts: 6,
        grantEquipment: true,
      },
      {
        label: '记录坐标后安全撤离',
        costSummary: '无消耗',
        rewardSummary: '安全离开并返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_smuggler_dock',
    sectorId: 'near_orbit',
    nodeType: 'anomaly',
    title: '黑市走私浮坞',
    description:
      '一艘关闭识别码的私掠驳船停泊在残骸阴影中，船主闪烁暗语灯号，愿用未登记的舰载件交换现款或情报。',
    flavorTag: '近轨异常 · 暗市交易',
    options: [
      {
        label: '现款买下暗仓盲箱（20¤）',
        costSummary: '消耗 20¤ 航行钱包',
        rewardSummary: '获得 1 件随机舰载设备 + 8 精密零件',
        walletCost: 20,
        rewardParts: 8,
        grantEquipment: true,
      },
      {
        label: '苏岚暗语压价（打捞师专属）',
        costSummary: '无消耗（苏岚专属）',
        rewardSummary: '拾荒团声望 +15 · +12 精密零件 · 1 件高价货',
        requiredCrewId: 'salvager',
        rewardParts: 12,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 15,
        grantCargoCount: 1,
      },
      {
        label: '拒绝对接并悄然驶离',
        costSummary: '无消耗',
        rewardSummary: '安全撤离至航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_unstable_reactor',
    sectorId: 'near_orbit',
    nodeType: 'anomaly',
    title: '失控微堆核心',
    description:
      '半截驱逐舰尾部反应堆仍在临界脉动，冷却管道渗出高纯度推进剂与精密阀件，随时可能释放热浪。',
    flavorTag: '近轨异常 · 临界反应堆',
    options: [
      {
        label: '硬抗热浪拆走核心阀件（-4 耐久）',
        costSummary: '承受 4 点船体热浪伤害',
        rewardSummary: '+14 精密零件 · 2 件高价打捞货物',
        hpCost: 4,
        rewardParts: 14,
        grantCargoCount: 2,
      },
      {
        label: '林工紧急降压抽油（工程师专属）',
        costSummary: '无消耗（林工专属）',
        rewardSummary: '安全抽取 +2 燃料 · +10 精密零件',
        requiredCrewId: 'engineer',
        rewardFuel: 2,
        rewardParts: 10,
      },
      {
        label: '保持安全距离绕行',
        costSummary: '无消耗',
        rewardSummary: '无损返回星际航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_drifting_convoy',
    sectorId: 'near_orbit',
    nodeType: 'distress',
    title: '漂流护航货队',
    description:
      '两艘星港行会补给驳船在碎铁区熄火求援，船长承诺只要协助拖离险区，便立刻焊修我舰并上报行会嘉奖。',
    flavorTag: '近轨求救 · 行会护航',
    options: [
      {
        label: '耗油协助拖航护送（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '恢复 +6 船体耐久 · +16¤ · 星港行会声望 +20',
        fuelCost: 1,
        rewardHp: 6,
        rewardCredits: 16,
        rewardFactionId: 'starport_guild',
        rewardFactionRep: 20,
      },
      {
        label: '陆衡规划惯性牵引（领航员专属）',
        costSummary: '无消耗（陆衡专属）',
        rewardSummary: '恢复 +5 耐久 · +22¤ · 星港行会声望 +25',
        requiredCrewId: 'navigator',
        rewardHp: 5,
        rewardCredits: 22,
        rewardFactionId: 'starport_guild',
        rewardFactionRep: 25,
      },
      {
        label: '打捞其弃置外挂货箱后离去',
        costSummary: '无消耗',
        rewardSummary: '获取 1 件漂流货物并整理装舱',
        grantCargoCount: 1,
      },
      {
        label: '转发求救频段后继续航行',
        costSummary: '无消耗',
        rewardSummary: '零损耗返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_rival_scavengers',
    sectorId: 'near_orbit',
    nodeType: 'distress',
    title: '受困拾荒小队',
    description:
      '一支自由拾荒团快艇被残骸钢梁卡住引擎，对方挥舞应急信号灯，愿意用拆解零件换取燃料或切割支援。',
    flavorTag: '近轨求救 · 拾荒互助',
    options: [
      {
        label: '拨出燃料助其脱困（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '+12 精密零件 · 自由拾荒团声望 +20 · 1 件货物',
        fuelCost: 1,
        rewardParts: 12,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 20,
        grantCargoCount: 1,
      },
      {
        label: '苏岚精准切梁联手分赃（打捞师专属）',
        costSummary: '无消耗（苏岚专属）',
        rewardSummary: '+15 精密零件 · +15¤ · 拾荒团声望 +25',
        requiredCrewId: 'salvager',
        rewardParts: 15,
        rewardCredits: 15,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 25,
      },
      {
        label: '广播位置给搜救队后离开',
        costSummary: '无消耗',
        rewardSummary: '安全脱离节点',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_auto_drydock',
    sectorId: 'near_orbit',
    nodeType: 'distress',
    title: '失联自动维修坞',
    description:
      '一座旧式轨道快修浮坞漂泊在航道侧翼，机械臂仍可响应付费维护指令，外围仓库也堆满未清理零件。',
    flavorTag: '近轨求救 · 自动浮坞',
    options: [
      {
        label: '启动付费快速焊修（15¤）',
        costSummary: '消耗 15¤ 航行钱包',
        rewardSummary: '恢复 +8 船体耐久 · +8 精密零件',
        walletCost: 15,
        rewardHp: 8,
        rewardParts: 8,
      },
      {
        label: '耗油对接拆取备用料箱（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '+10 精密零件 · 1 件高价货物',
        fuelCost: 1,
        rewardParts: 10,
        grantCargoCount: 1,
      },
      {
        label: '林工重刷维护权限（工程师专属）',
        costSummary: '无消耗（林工专属）',
        rewardSummary: '免费恢复 +6 耐久 · +12 精密零件',
        requiredCrewId: 'engineer',
        rewardHp: 6,
        rewardParts: 12,
      },
      {
        label: '断开对接信号继续前航',
        costSummary: '无消耗',
        rewardSummary: '安全返回航图',
        isFallback: true,
      },
    ],
  },

  // ==================== FROZEN GRAVEYARD (6 events: 3 anomaly, 3 distress) ====================
  {
    eventId: 'evt_cryo_vault_beacon',
    sectorId: 'frozen_graveyard',
    nodeType: 'anomaly',
    title: '冰封军需金库',
    description:
      '低温冰层包裹着半截战列舰军需舱，扫描仪显示内部封存着完好的军械模块与寒区合金。',
    flavorTag: '冰晶异常 · 封冻金库',
    options: [
      {
        label: '低温等离子破冰（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '1 件舰载设备 + 8 精密零件',
        fuelCost: 1,
        rewardParts: 8,
        grantEquipment: true,
      },
      {
        label: '顶着冰屑硬撞开舱（-5 耐久）',
        costSummary: '承受 5 点船体刮擦伤害',
        rewardSummary: '2 件深区高价货物 + 12 精密零件',
        hpCost: 5,
        rewardParts: 12,
        grantCargoCount: 2,
      },
      {
        label: '苏岚循冰裂纹无损剥离（打捞师专属）',
        costSummary: '无消耗（苏岚专属）',
        rewardSummary: '1 件优良倾向设备 + 10 精密零件',
        requiredCrewId: 'salvager',
        rewardParts: 10,
        grantEquipment: true,
        preferImprovedEquipment: true,
      },
      {
        label: '标记冰库坐标后撤离',
        costSummary: '无消耗',
        rewardSummary: '安全离开并返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_ion_storm_shelter',
    sectorId: 'frozen_graveyard',
    nodeType: 'anomaly',
    title: '电离风暴避风港',
    description:
      '磁暴冰云正在合拢，风暴眼中却静静悬停着一列无人货运舱。精准控舵可趁间隙突入收货。',
    flavorTag: '冰晶异常 · 磁暴风眼',
    options: [
      {
        label: '全速加力穿越风墙（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '1 件高价货物 + 20¤ 航道数据补贴',
        fuelCost: 1,
        rewardCredits: 20,
        grantCargoCount: 1,
      },
      {
        label: '陆衡贴浪滑行直入风眼（领航员专属）',
        costSummary: '无消耗（陆衡专属）',
        rewardSummary: '零油耗带走 2 件货物 · +1 备用燃料',
        requiredCrewId: 'navigator',
        rewardFuel: 1,
        grantCargoCount: 2,
      },
      {
        label: '沿风暴外缘安全绕过',
        costSummary: '无消耗',
        rewardSummary: '零损耗返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_cryo_puzzle_cache',
    sectorId: 'frozen_graveyard',
    nodeType: 'anomaly',
    title: '低温加密货匣',
    description:
      '一只带有研究院徽记的低温样本密封匣漂浮在冰晶带中，外壳有三道热敏锁，暴力拆解易触发自毁电弧。',
    flavorTag: '冰晶异常 · 科研密匣',
    options: [
      {
        label: '承受电弧强拆样本锁（-4 耐久）',
        costSummary: '承受 4 点船体电弧伤害',
        rewardSummary: '1 件高价样本货 + 14 精密零件',
        hpCost: 4,
        rewardParts: 14,
        grantCargoCount: 1,
      },
      {
        label: '苏岚低温拆锁保真提取（打捞师专属）',
        costSummary: '无消耗（苏岚专属）',
        rewardSummary: '深空研究院声望 +25 · +20¤ · 1 件高价货',
        requiredCrewId: 'salvager',
        rewardCredits: 20,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 25,
        grantCargoCount: 1,
      },
      {
        label: '留存封条原地撤离',
        costSummary: '无消耗',
        rewardSummary: '安全脱离异常区',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_frozen_medbay',
    sectorId: 'frozen_graveyard',
    nodeType: 'distress',
    title: '冰封医疗急救舱',
    description:
      '一艘破冰搜救艇被冻死在冰脊之间，舱内医疗与工程机器人仍在运转，对方呼救请求破冰脱困。',
    flavorTag: '冰晶求救 · 寒区搜救',
    options: [
      {
        label: '喷射推进焰融冰施救（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '恢复 +8 耐久 · 自由拾荒团声望 +20 · +8 精密零件',
        fuelCost: 1,
        rewardHp: 8,
        rewardParts: 8,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 20,
      },
      {
        label: '陆衡引流冰脊重力裂缝（领航员专属）',
        costSummary: '无消耗（陆衡专属）',
        rewardSummary: '免费恢复 +6 耐久 · 拾荒团声望 +25 · +15¤',
        requiredCrewId: 'navigator',
        rewardHp: 6,
        rewardCredits: 15,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 25,
      },
      {
        label: '打捞外舱物资包',
        costSummary: '无消耗',
        rewardSummary: '获取 1 件冰区货物',
        grantCargoCount: 1,
      },
      {
        label: '发出救援转发信标后离开',
        costSummary: '无消耗',
        rewardSummary: '零损耗返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_institute_probe',
    sectorId: 'frozen_graveyard',
    nodeType: 'distress',
    title: '失落科考探针',
    description:
      '深空研究院遗失的冰区星门探测探针发来加密求援，回收其遥测芯片可获丰厚科研声望与零件报酬。',
    flavorTag: '冰晶求救 · 研究院探针',
    options: [
      {
        label: '耗油对接同步数据（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '深空研究院声望 +25 · +14 精密零件 · +18¤',
        fuelCost: 1,
        rewardParts: 14,
        rewardCredits: 18,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 25,
      },
      {
        label: '林工离线提取完整核心（工程师专属）',
        costSummary: '无消耗（林工专属）',
        rewardSummary: '深空研究院声望 +30 · +16 精密零件 · 1 件设备模块',
        requiredCrewId: 'engineer',
        rewardParts: 16,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 30,
        grantEquipment: true,
      },
      {
        label: '仅上传坐标并安全撤离',
        costSummary: '无消耗',
        rewardSummary: '安全返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_rogue_salvage_drone',
    sectorId: 'frozen_graveyard',
    nodeType: 'distress',
    title: '失控拆解无人机群',
    description:
      '一组旧矿业自动拆解无人机在低温中进入死循环，反复切割一艘废弃货轮并不断喷出高纯精密零件。',
    flavorTag: '冰晶求救 · 失控机群',
    options: [
      {
        label: '硬抗切割光束抢收零件（-4 耐久）',
        costSummary: '承受 4 点船体伤害',
        rewardSummary: '+20 精密零件 · 1 件漂流货物',
        hpCost: 4,
        rewardParts: 20,
        grantCargoCount: 1,
      },
      {
        label: '林工改写停机频段接管机群（工程师专属）',
        costSummary: '无消耗（林工专属）',
        rewardSummary: '+18 精密零件 · 1 件随机舰载设备',
        requiredCrewId: 'engineer',
        rewardParts: 18,
        grantEquipment: true,
      },
      {
        label: '避开机群工作半径撤离',
        costSummary: '无消耗',
        rewardSummary: '安全返回航图',
        isFallback: true,
      },
    ],
  },

  // ==================== STARGATE ABYSS (6 events: 3 anomaly, 3 distress) ====================
  {
    eventId: 'evt_stargate_echo',
    sectorId: 'stargate_abyss',
    nodeType: 'anomaly',
    title: '古星门跃迁回响',
    description:
      '残破星门环释放出周期性时空涟漪，每一次波峰都会将旧纪元舰队的补给舱短暂推入实空间。',
    flavorTag: '星门异常 · 跃迁回响',
    options: [
      {
        label: '耗油切入波峰截获货柜（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '1 件禁区高价货 + 12 精密零件 + 研究院声望 +15',
        fuelCost: 1,
        rewardParts: 12,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 15,
        grantCargoCount: 1,
      },
      {
        label: '陆衡锁定潮汐相位顺流捕获（领航员专属）',
        costSummary: '无消耗（陆衡专属）',
        rewardSummary: '+1 燃料 · +25¤ · 1 件禁区高价货',
        requiredCrewId: 'navigator',
        rewardFuel: 1,
        rewardCredits: 25,
        grantCargoCount: 1,
      },
      {
        label: '观测完毕后脱离引力边缘',
        costSummary: '无消耗',
        rewardSummary: '安全返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_obsidian_cache',
    sectorId: 'stargate_abyss',
    nodeType: 'anomaly',
    title: '黑曜残片密舱',
    description:
      '黑曜舰队旗舰脱落的装甲舱段悬浮在重力潮汐中，舱内的高能武装阵列与精密部件价值连城。',
    flavorTag: '星门异常 · 黑曜密舱',
    options: [
      {
        label: '强行顶盾破拆黑曜舱门（-6 耐久）',
        costSummary: '承受 6 点船体伤害',
        rewardSummary: '1 件优良倾向设备 + 18 精密零件',
        hpCost: 6,
        rewardParts: 18,
        grantEquipment: true,
        preferImprovedEquipment: true,
      },
      {
        label: '苏岚逆向拆解黑曜锁栓（打捞师专属）',
        costSummary: '无消耗（苏岚专属）',
        rewardSummary: '1 件优良倾向设备 + 16 精密零件 + 拾荒团声望 +20',
        requiredCrewId: 'salvager',
        rewardParts: 16,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 20,
        grantEquipment: true,
        preferImprovedEquipment: true,
      },
      {
        label: '撤出潮汐危险区',
        costSummary: '无消耗',
        rewardSummary: '零损耗返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_gravity_slingshot',
    sectorId: 'stargate_abyss',
    nodeType: 'anomaly',
    title: '引力弹弓航道',
    description:
      '两座星门残环之间形成了一条天然重力走廊，精准切入可白嫖推进势能，失误则会刮伤装甲。',
    flavorTag: '星门异常 · 引力弹弓',
    options: [
      {
        label: '硬抗潮汐剪切冲过走廊（-4 耐久）',
        costSummary: '承受 4 点船体剪切伤害',
        rewardSummary: '回收 +2 燃料 · +24¤ 航道测绘赏金',
        hpCost: 4,
        rewardFuel: 2,
        rewardCredits: 24,
      },
      {
        label: '陆衡精确计算弹弓轨道（领航员专属）',
        costSummary: '无消耗（陆衡专属）',
        rewardSummary: '无伤获得 +2 燃料 · +20¤ · 研究院声望 +20',
        requiredCrewId: 'navigator',
        rewardFuel: 2,
        rewardCredits: 20,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 20,
      },
      {
        label: '改走常规安全航道',
        costSummary: '无消耗',
        rewardSummary: '无损返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_guild_checkpoint',
    sectorId: 'stargate_abyss',
    nodeType: 'distress',
    title: '旧航港补给浮标',
    description:
      '星港行会早年部署在星门禁区边缘的应急补给浮标电量告急，可用钱包兑换深空急修或协助重启信标。',
    flavorTag: '星门求救 · 行会浮标',
    options: [
      {
        label: '支付维护费启用应急补给（20¤）',
        costSummary: '消耗 20¤ 航行钱包',
        rewardSummary: '恢复 +8 耐久 · +2 燃料 · 行会声望 +15',
        walletCost: 20,
        rewardHp: 8,
        rewardFuel: 2,
        rewardFactionId: 'starport_guild',
        rewardFactionRep: 15,
      },
      {
        label: '林工更换备用电容重启浮标（工程师专属）',
        costSummary: '无消耗（林工专属）',
        rewardSummary: '星港行会声望 +30 · 恢复 +6 耐久 · +14 精密零件',
        requiredCrewId: 'engineer',
        rewardHp: 6,
        rewardParts: 14,
        rewardFactionId: 'starport_guild',
        rewardFactionRep: 30,
      },
      {
        label: '记录浮标频段后离开',
        costSummary: '无消耗',
        rewardSummary: '安全返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_ancient_memory_core',
    sectorId: 'stargate_abyss',
    nodeType: 'distress',
    title: '旧舰队记忆核心',
    description:
      '一枚古星门守卫舰的战术记忆核心正在循环广播最后日志，耗油稳定信号即可导出珍贵星门档案。',
    flavorTag: '星门求救 · 古舰记忆核',
    options: [
      {
        label: '耗油稳定供能导出档案（-1 燃料）',
        costSummary: '消耗 1 燃料',
        rewardSummary: '深空研究院声望 +30 · +18 精密零件 · 1 件高价货',
        fuelCost: 1,
        rewardParts: 18,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 30,
        grantCargoCount: 1,
      },
      {
        label: '林工零耗镜像拷贝核心（工程师专属）',
        costSummary: '无消耗（林工专属）',
        rewardSummary: '深空研究院声望 +35 · +22 精密零件 · +22¤',
        requiredCrewId: 'engineer',
        rewardParts: 22,
        rewardCredits: 22,
        rewardFactionId: 'deep_institute',
        rewardFactionRep: 35,
      },
      {
        label: '静默封存信标并撤离',
        costSummary: '无消耗',
        rewardSummary: '安全返回航图',
        isFallback: true,
      },
    ],
  },
  {
    eventId: 'evt_abyss_scrap_auction',
    sectorId: 'stargate_abyss',
    nodeType: 'distress',
    title: '深渊拾荒暗市',
    description:
      '几艘胆大的深渊打捞艇聚在星门残骸背阴处交换战利品，只要掏得出航行钱包，便能当场截胡稀缺模块。',
    flavorTag: '星门求救 · 深渊暗市',
    options: [
      {
        label: '高价买断禁区优良模块（30¤）',
        costSummary: '消耗 30¤ 航行钱包',
        rewardSummary: '1 件优良倾向设备 · 拾荒团声望 +15',
        walletCost: 30,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 15,
        grantEquipment: true,
        preferImprovedEquipment: true,
      },
      {
        label: '苏岚以废料行情置换零件（打捞师专属）',
        costSummary: '无消耗（苏岚专属）',
        rewardSummary: '+20 精密零件 · +20¤ · 自由拾荒团声望 +25',
        requiredCrewId: 'salvager',
        rewardParts: 20,
        rewardCredits: 20,
        rewardFactionId: 'free_salvagers',
        rewardFactionRep: 25,
      },
      {
        label: '挥手致意后继续深潜',
        costSummary: '无消耗',
        rewardSummary: '零损耗返回航图',
        isFallback: true,
      },
    ],
  },
];

const EVENT_BY_ID: Record<string, V3EventTemplate> = Object.fromEntries(
  V3_EVENT_CATALOG.map((tpl) => [tpl.eventId, tpl])
);

export function getEventTemplateById(eventId: string): V3EventTemplate | undefined {
  return EVENT_BY_ID[eventId];
}

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
  if (
    guaranteedRelicDefId &&
    Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, guaranteedRelicDefId)
  ) {
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

function pickEventEquipment(
  unlockedFamilies: readonly V2UnlockFamilyId[],
  layer: number,
  preferImproved: boolean,
  rng: SeededRng,
  instanceId: string
): V2ItemInstance {
  const pool = getUnlockedEquipmentKinds(
    unlockedFamilies.length > 0 ? unlockedFamilies : ['core']
  );
  const kind: V2EquipmentKind = rng.pick(pool);
  const quality =
    preferImproved && (layer >= 3 || rng.nextFloat() < 0.65)
      ? 'improved'
      : layer >= 5 && rng.nextFloat() < 0.35
      ? 'improved'
      : 'common';
  return createV2EquipmentInstance({
    instanceId,
    kind,
    quality,
    origin: 'loot',
    acquiredDepth: layer,
    location: 'staging',
  });
}

function buildEventStateFromTemplate(
  tpl: V3EventTemplate,
  params: {
    readonly nodeId: string;
    readonly sectorId: SectorId;
    readonly layer: number;
    readonly priceMult: number;
    readonly nextUid: (prefix: string) => string;
    readonly rng: SeededRng;
    readonly guaranteedRelicDefId?: string | null;
    readonly unlockedFamilies: readonly V2UnlockFamilyId[];
  }
): V2EventState {
  let relicAssigned = false;
  const options: V2EventOptionState[] = tpl.options.map((opt, index) => {
    const rewardItems: V2ItemInstance[] = [];
    if (opt.grantCargoCount && opt.grantCargoCount > 0) {
      for (let i = 0; i < opt.grantCargoCount; i++) {
        const useRelic = !relicAssigned && Boolean(params.guaranteedRelicDefId);
        const defId = pickSectorEventCargoDefId(
          params.sectorId,
          params.layer,
          params.rng,
          params.layer >= 4,
          useRelic ? params.guaranteedRelicDefId : null
        );
        if (useRelic) relicAssigned = true;
        const unitVal = computeScaledCargoValue(defId, params.layer, params.priceMult);
        rewardItems.push(
          createV2CargoInstance({
            instanceId: params.nextUid(`evt_cg_${index}_${i}`),
            defId,
            origin: 'loot',
            acquiredDepth: params.layer,
            location: 'staging',
            fixedValueOverride: unitVal,
          })
        );
      }
    }
    if (opt.grantEquipment) {
      rewardItems.push(
        pickEventEquipment(
          params.unlockedFamilies,
          params.layer,
          Boolean(opt.preferImprovedEquipment),
          params.rng,
          params.nextUid(`evt_eq_${index}`)
        )
      );
    }

    // Ensure concrete item name/value is visible in reward summary if items exist
    let rewardSummary = opt.rewardSummary;
    if (rewardItems.length > 0 && params.guaranteedRelicDefId && relicAssigned) {
      const relicItem = rewardItems.find((it) => it.definitionId === params.guaranteedRelicDefId);
      const relicDef = relicItem ? V2_CARGO_DEFS[relicItem.definitionId] : undefined;
      if (relicDef && !rewardSummary.includes(relicDef.name)) {
        rewardSummary = `${rewardSummary}（含遗物：${relicDef.name}）`;
      }
    }

    return {
      index,
      label: opt.label,
      costSummary: opt.costSummary,
      rewardSummary,
      ...(opt.requiredCrewId ? { requiredCrewId: opt.requiredCrewId } : {}),
      ...(opt.fuelCost !== undefined ? { fuelCost: opt.fuelCost } : {}),
      ...(opt.hpCost !== undefined ? { hpCost: opt.hpCost } : {}),
      ...(opt.walletCost !== undefined ? { walletCost: opt.walletCost } : {}),
      ...(opt.isFallback ? { isFallback: true } : {}),
      ...(opt.rewardCredits !== undefined ? { rewardCredits: opt.rewardCredits } : {}),
      ...(opt.rewardParts !== undefined ? { rewardParts: opt.rewardParts } : {}),
      ...(opt.rewardFuel !== undefined ? { rewardFuel: opt.rewardFuel } : {}),
      ...(opt.rewardHp !== undefined ? { rewardHp: opt.rewardHp } : {}),
      ...(opt.rewardFactionId ? { rewardFactionId: opt.rewardFactionId } : {}),
      ...(opt.rewardFactionRep !== undefined ? { rewardFactionRep: opt.rewardFactionRep } : {}),
      ...(rewardItems.length > 0 ? { rewardItems } : {}),
    };
  });

  return {
    nodeId: params.nodeId,
    eventId: tpl.eventId,
    title: tpl.title,
    description: tpl.description,
    resolved: false,
    chosenIndex: null,
    options,
    flavorTag: tpl.flavorTag,
  };
}

/**
 * Resolves concrete rewards for minimal seeded E2E `activeEvent.options` entries that omit embedded
 * rewardCredits / rewardParts / rewardItems fields (looking up by eventId + option.index).
 */
export function resolveFallbackOptionEffects(
  eventId: string,
  option: V2EventOptionState,
  run: V2RunState,
  unlockedFamilies: readonly V2UnlockFamilyId[]
): {
  readonly rewardCredits: number;
  readonly rewardParts: number;
  readonly rewardFuel: number;
  readonly rewardHp: number;
  readonly rewardFactionId?: FactionId;
  readonly rewardFactionRep: number;
  readonly rewardItems: readonly V2ItemInstance[];
  readonly nextStreams: V2RunState['rngStreams'];
} {
  // If option already carries explicit reward fields OR is a safe fallback, honor them directly!
  const hasExplicitReward =
    option.rewardCredits !== undefined ||
    option.rewardParts !== undefined ||
    option.rewardFuel !== undefined ||
    option.rewardHp !== undefined ||
    option.rewardFactionRep !== undefined ||
    (option.rewardItems !== undefined && option.rewardItems.length > 0);

  if (option.isFallback || hasExplicitReward) {
    return {
      rewardCredits: option.rewardCredits ?? 0,
      rewardParts: option.rewardParts ?? 0,
      rewardFuel: option.rewardFuel ?? 0,
      rewardHp: option.rewardHp ?? 0,
      rewardFactionId: option.rewardFactionId,
      rewardFactionRep: option.rewardFactionRep ?? 0,
      rewardItems: option.rewardItems ?? [],
      nextStreams: run.rngStreams,
    };
  }

  const tpl = getEventTemplateById(eventId);
  const tplOpt = tpl?.options[option.index];
  if (!tplOpt) {
    // Unknown custom seeded non-fallback event option: grant clean credit + parts reward
    return {
      rewardCredits: 15,
      rewardParts: 5,
      rewardFuel: 0,
      rewardHp: 0,
      rewardFactionRep: 0,
      rewardItems: [],
      nextStreams: run.rngStreams,
    };
  }

  const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
  const layer = node?.layer ?? 2;
  const sector = getV3SectorDef(run.sectorId);
  const draw = withV2Stream(run.rngStreams, 'events', (rng) => {
    const items: V2ItemInstance[] = [];
    if (tplOpt.grantCargoCount && tplOpt.grantCargoCount > 0) {
      for (let i = 0; i < tplOpt.grantCargoCount; i++) {
        const defId = pickSectorEventCargoDefId(
          run.sectorId,
          layer,
          rng,
          layer >= 4,
          i === 0 ? node?.relicSignalDefId ?? null : null
        );
        const unitVal = computeScaledCargoValue(defId, layer, sector.cargoPriceMult);
        items.push(
          createV2CargoInstance({
            instanceId: `${run.runId}_evtfb_cg_${node?.nodeId ?? 'n'}_${option.index}_${i}`,
            defId,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
            fixedValueOverride: unitVal,
          })
        );
      }
    }
    if (tplOpt.grantEquipment) {
      const pool = getUnlockedEquipmentKinds(
        unlockedFamilies.length > 0 ? unlockedFamilies : ['core']
      );
      const kind = rng.pick(pool);
      const def = getV2EquipmentDefByKind(kind, 'common');
      items.push(
        createV2EquipmentInstance({
          instanceId: `${run.runId}_evtfb_eq_${node?.nodeId ?? 'n'}_${option.index}`,
          kind: def.kind,
          quality: tplOpt.preferImprovedEquipment && layer >= 3 ? 'improved' : 'common',
          origin: 'loot',
          acquiredDepth: layer,
          location: 'staging',
        })
      );
    }
    return items;
  });

  return {
    rewardCredits: tplOpt.rewardCredits ?? 0,
    rewardParts: tplOpt.rewardParts ?? 0,
    rewardFuel: tplOpt.rewardFuel ?? 0,
    rewardHp: tplOpt.rewardHp ?? 0,
    rewardFactionId: tplOpt.rewardFactionId,
    rewardFactionRep: tplOpt.rewardFactionRep ?? 0,
    rewardItems: draw.value,
    nextStreams: draw.nextStreams,
  };
}

/**
 * Interface Contract #3 Pluggable Sector Event Registry Hook.
 * Called by `routeGenerator.ts`: draws non-repeating sector-aware events from the 18-event deck,
 * honoring guaranteedRelicDefId and returning BOTH rich `eventState` AND backward-compatible
 * legacy `anomaly` / `distress` payloads for unit test parity!
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
  const nodeId = options?.nodeId ?? `L${layer}A`;
  const unlockedFamilies = options?.unlockedFamilies ?? ['core'];

  const sectorPool = V3_EVENT_CATALOG.filter(
    (e) => e.sectorId === sectorId && e.nodeType === nodeType
  );
  const unusedSector = sectorPool.filter((e) => !usedEventIds.includes(e.eventId));
  let chosen: V3EventTemplate;
  if (unusedSector.length > 0) {
    chosen = rng.pick(unusedSector);
  } else {
    const unusedAnySector = V3_EVENT_CATALOG.filter(
      (e) => e.nodeType === nodeType && !usedEventIds.includes(e.eventId)
    );
    chosen =
      unusedAnySector.length > 0
        ? rng.pick(unusedAnySector)
        : rng.pick(sectorPool.length > 0 ? sectorPool : V3_EVENT_CATALOG);
  }

  const eventState = buildEventStateFromTemplate(chosen, {
    nodeId,
    sectorId,
    layer,
    priceMult,
    nextUid,
    rng,
    guaranteedRelicDefId: options?.guaranteedRelicDefId,
    unlockedFamilies,
  });

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
      safeFuelCost: 1,
      safeCargoItem,
      breachHpCost: 4,
      breachCargoItems: [breach1, breach2],
      chosenOption: null,
    };
    return {
      eventId: chosen.eventId,
      title: chosen.title,
      description: chosen.description,
      anomaly: payload,
      eventState,
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
    rescueFuelCost: 1,
    repairAmount: 6,
    haulCargoItem,
    chosenOption: null,
  };
  return {
    eventId: chosen.eventId,
    title: chosen.title,
    description: chosen.description,
    distress: payload,
    eventState,
  };
}
