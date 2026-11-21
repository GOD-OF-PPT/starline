export type BuildingId = 'workbench' | 'display' | 'drydock';

export interface BuildingDefinition {
  readonly id: BuildingId;
  readonly name: string;
  readonly cost: number;
  readonly prerequisite: BuildingId | null;
  readonly benefit: string;
  readonly sceneChange: string;
  readonly wornDescription: string;
  readonly repairedDescription: string;
}

export const BUILDINGS: Record<BuildingId, BuildingDefinition> = {
  workbench: {
    id: 'workbench',
    name: '拆解工作台',
    cost: 40,
    prerequisite: null,
    benefit: '解锁图鉴与设备说明，开启站内正式建设列表',
    sceneChange: '工作灯亮起、工具墙就位、电焊机器人开始运转',
    wornDescription: '断电停工、缺工具、机械臂折叠。',
    repairedDescription: '面板完整、暖色灯亮、电焊臂持续作业。',
  },
  display: {
    id: 'display',
    name: '收藏展台',
    cost: 100,
    prerequisite: 'workbench',
    benefit: '存放并修复带回的古代导航仪，点亮展示角',
    sceneChange: '移除封存罩布，展开玻璃展示柜与定向展示灯',
    wornDescription: '封存底座覆盖防尘布，尚未通电。',
    repairedDescription: '防爆玻璃展柜启用，支持修复与展示稀有废宝。',
  },
  drydock: {
    id: 'drydock',
    name: '船坞扩建',
    cost: 120,
    prerequisite: 'workbench',
    benefit: '解锁第二方案「护盾工程艇」（开局携带普通护盾板）',
    sceneChange: '第二泊位导轨修复、引导灯点亮、护盾艇停泊可见',
    wornDescription: '封闭泊位，导轨锈蚀损坏。',
    repairedDescription: '双泊位展开，可自由切换炮艇或护盾艇出航。',
  },
};

export const BUILDING_ORDER: readonly BuildingId[] = ['workbench', 'display', 'drydock'];

export interface RelicDefinition {
  readonly id: string;
  readonly cargoDefId: string;
  readonly name: string;
  readonly restoreCost: number;
  readonly description: string;
  readonly lore: string;
}

export const RELICS: Record<string, RelicDefinition> = {
  ancient_navigator: {
    id: 'ancient_navigator',
    cargoDefId: 'cargo.ancient_navigator',
    name: '古代导航仪',
    restoreCost: 60,
    description: '从深空残骸带回的古老环形星图仪，可在收藏展台支付修复费永久展示。',
    lore: '外壳刻有早已废弃的旧航线标尺，通电后内部星环仍能稳定指向星门坐标。',
  },
};

export const FIRST_EXPEDITION_BONUS_CREDITS = 15;
