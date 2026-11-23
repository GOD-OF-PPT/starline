import { V2_CREW, V2_CREW_ORDER, type V2CrewId } from './crew';
import { V2_RELICS, V2_RELIC_ORDER } from './facilities';
import { V3_FACTIONS, V3_FACTION_LEVEL_THRESHOLDS, V3_FACTION_ORDER } from './factions';
import type { EndingId, FactionId, V2ProfileState } from '../domain/types';

export interface V3EndingDef {
  readonly id: EndingId;
  readonly title: string;
  readonly subtitle: string;
  readonly factionTheme: FactionId;
  readonly tagline: string;
  readonly summary: string;
  readonly openingQuote: string;
  readonly coreParagraphs: readonly string[];
  readonly crewFarewells: Record<V2CrewId, string>;
  readonly postGameNotice: string;
}

export const V3_ENDING_ORDER: readonly EndingId[] = [
  'stargate_reignited',
  'free_haven',
  'fleet_heir',
];

export const V3_ENDINGS: Record<EndingId, V3EndingDef> = {
  stargate_reignited: {
    id: 'stargate_reignited',
    title: '星门重燃',
    subtitle: '重启古代星门网络 · 恢复跨星域航道',
    factionTheme: 'deep_institute',
    tagline: '以古星门遗物校准共振环，令失落百年的远航航道再度点亮。',
    summary:
      '将全部遗物共振频率注入星门核心，与深空研究院联合重启星门主环，让拆解站成为新纪元星际远征的第一座跃迁灯塔。',
    openingQuote: '「当星门外环的蓝白电弧再度合拢，沉寂百年的深空终于听见了回声。」',
    coreParagraphs: [
      '黑曜利维坦的残骸在引力潮汐中缓缓沉降，失活百年的古代星门露出了完整的环状核心。随着星门通讯塔向禁区发射同步脉冲，陈列在收藏展台上的古代遗物产生了跨越星域的共鸣。',
      '星门主环被彻底重燃，跨星域跃迁航道重新向整个轨道群开放。深空研究院将拆解站升格为星门观测枢纽，来自遥远星海的商船与科考舰队正顺着你点亮的坐标鱼贯驶入。',
    ],
    crewFarewells: {
      engineer:
        '船长，星门主环的能量读数稳得像教科书一样！拆解站的船坞很快就要迎来整条星际航线的旗舰大修了。',
      navigator:
        '星图上终于不再只有三条孤立的近轨航路了。我已经标出了星门彼端的第一批深空信标，随时可以启航。',
      salvager:
        '以前我们只能在旧残骸里淘零件，现在星门重燃，连未知星域的传奇遗物都在等着咱们去发掘呢！',
    },
    postGameNotice: '星门彼端的无尽深渊（威压 1–10）航标已全面解锁，返回基地即可整备出航。',
  },
  free_haven: {
    id: 'free_haven',
    title: '自由港湾',
    subtitle: '关闭旧帝国收编信标 · 建立独立中立自由港',
    factionTheme: 'free_salvagers',
    tagline: '切断中心星域的强制接管协议，把拆解站打造成属于流浪拾荒者的独立港湾。',
    summary:
      '拆解黑曜利维坦的帝国控制模块，屏蔽来自核心星区的收编指令，与自由拾荒团共同将轨道拆解站建设为自治中立的自由港湾。',
    openingQuote: '「我们不需要任何旧帝国的许可——这座用残骸焊起来的港湾，只向自由航行者敞开。」',
    coreParagraphs: [
      '你在黑曜利维坦的舰桥中截获了旧帝国留下的强制收编密钥。没有选择交出星门控制权，你亲手熔断了收编信标，将古代星门的跃迁权限锁定在轨道拆解站本地节点。',
      '消息传遍近轨残骸带与冰晶舰冢，自由拾荒团与独立商船纷纷靠泊致敬。曾经濒临废弃的轨道拆解站浴火重生，化作无人能够垄断的独立中立自由港湾，每一支小舰队都能在此公平交易、整备远行。',
    ],
    crewFarewells: {
      engineer:
        '干得漂亮，船长！再也不用看核心星区官僚的脸色了，咱们自由港的工坊以后永远对所有实干派敞开。',
      navigator:
        '独立航标网络已经部署完毕。没有帝国封锁线的星图，才是真正属于每一位领航员的星海。',
      salvager:
        '哈哈，自由拾荒团那边已经开香槟庆祝了！从今天起，这片星区最响亮的招牌就是咱们的自由港湾！',
    },
    postGameNotice: '自由港的深空侦察网已定位无尽深渊（威压 1–10），返回基地即可自由挑战。',
  },
  fleet_heir: {
    id: 'fleet_heir',
    title: '旧舰队继承者',
    subtitle: '接管古舰队指挥核心 · 承继远征星海遗产',
    factionTheme: 'starport_guild',
    tagline: '解析黑曜利维坦的旗舰授权码，成为失落旧舰队正统指挥体系的继承者。',
    summary:
      '从黑曜利维坦主控室提取完整的旧舰队指挥密钥，联合星港行会重建深空远征舰队秩序，以继承者之名统御星门航道。',
    openingQuote: '「旧纪元的舰队并未真正消逝，它只是在星门深处等待一位配得上舰桥的继承者。」',
    coreParagraphs: [
      '在黑曜利维坦熄火前的最后一刻，旗舰自律主机向你的船体发射了最高权限的指挥认证。沉睡在古代星门禁区深处的旧舰队补给坞与战术档案库随之解除封存，正式承认你为旧舰队的新任指挥官。',
      '星港行会迅速与你缔结了最高等级的远征同盟。凭借旧舰队的精密设计蓝图与完整的星门防卫体系，轨道拆解站蜕变为深空远征总部，而你的旗帜将成为整片星域航运安全的绝对象征。',
    ],
    crewFarewells: {
      engineer:
        '旧舰队封存的船体架构图纸全解锁了……船长，给我一点时间，我能把咱们的巡洋舰改造成真正的传奇旗舰！',
      navigator:
        '旧舰队百年未公开的深空航道日志全部载入主机了，这下连最危险的高威压深渊也无处遁形。',
      salvager:
        '从废船拆解队一路打成旧舰队正统继承者——这段传奇够星港酒馆传唱整整一个世纪了！',
    },
    postGameNotice: '旧舰队加密深渊航图（威压 1–10）已解封，返回基地即可率队出征。',
  },
};

export interface V3EndingEpilogue {
  readonly ending: V3EndingDef;
  readonly topFactionId: FactionId;
  readonly topFactionName: string;
  readonly topFactionRep: number;
  readonly restoredRelicsCount: number;
  readonly paragraphs: readonly string[];
  readonly crewFarewells: readonly {
    readonly crewId: V2CrewId;
    readonly name: string;
    readonly roleTitle: string;
    readonly quote: string;
  }[];
}

export function buildDynamicEndingEpilogue(
  endingId: EndingId,
  profile: V2ProfileState
): V3EndingEpilogue {
  const ending = V3_ENDINGS[endingId] ?? V3_ENDINGS.stargate_reignited;

  // Determine top faction reputation (tie-breaking toward ending's signature faction)
  let topFactionId: FactionId = ending.factionTheme;
  let topFactionRep = profile.factionRep[topFactionId] ?? 0;
  for (const fid of V3_FACTION_ORDER) {
    const rep = profile.factionRep[fid] ?? 0;
    if (rep > topFactionRep) {
      topFactionRep = rep;
      topFactionId = fid;
    }
  }
  const topFactionDef = V3_FACTIONS[topFactionId];
  const topRankTitle =
    topFactionRep >= V3_FACTION_LEVEL_THRESHOLDS[2]
      ? 'Lv.3 崇高盟友'
      : topFactionRep >= V3_FACTION_LEVEL_THRESHOLDS[1]
      ? 'Lv.2 信赖伙伴'
      : 'Lv.1 合作签约';

  const restoredNames = V2_RELIC_ORDER.filter((rid) => Boolean(profile.relics[rid]?.restored)).map(
    (rid) => V2_RELICS[rid]?.name ?? rid
  );
  const restoredRelicsCount = restoredNames.length;

  const factionParagraph =
    topFactionId === 'deep_institute'
      ? `在这场跨越三幕的远征中，「深空研究院」与你缔结了「${topRankTitle}」级别的信任（声望 ${topFactionRep}）。研究院的星门学者们进驻了拆解站观测台，将你的航行数据编入星门重启典籍，见证人类重返深空。`
      : topFactionId === 'free_salvagers'
      ? `在这场跨越三幕的远征中，「自由拾荒团」对你报以「${topRankTitle}」级别的敬意（声望 ${topFactionRep}）。数十支穿梭在残骸带与舰冢间的民间打捞队自发集结在拆解站外轨，为你守护新航道的每一寸空间。`
      : `在这场跨越三幕的远征中，「星港行会」授予你「${topRankTitle}」级别的崇高徽章（声望 ${topFactionRep}）。行会商团承诺为拆解站提供世代不绝的物资补给与优先航权，让这座轨道基地永远灯火通明。`;

  const relicParagraph =
    restoredRelicsCount >= 4
      ? `展台中全部 4/4 件古代遗物（${restoredNames.join('、')}）悉数复原并达成满频共振，为星门主环注入了超越预期的稳定余量，使此次结局成为星港史册上毫无缺憾的完美篇章。`
      : restoredRelicsCount > 0
      ? `收藏展台中已修复的 ${restoredRelicsCount}/4 件古代遗物（${restoredNames.join('、')}）为星门校准提供了决定性支点；其余散落在深空的古星门遗物仍等待你日后继续寻回。`
      : `尽管本次远征尚未在展台集齐古代遗物，你的舰队仍凭借钢铁意志撕裂了禁区防线，为拆解站赢得了继续探索 4 件星门遗物的宝贵未来。`;

  const paragraphs: readonly string[] = [
    ...ending.coreParagraphs,
    factionParagraph,
    relicParagraph,
  ];

  const crewFarewells = V2_CREW_ORDER.map((cid) => ({
    crewId: cid,
    name: V2_CREW[cid].name,
    roleTitle: V2_CREW[cid].roleTitle,
    quote: ending.crewFarewells[cid],
  }));

  return {
    ending,
    topFactionId,
    topFactionName: topFactionDef.name,
    topFactionRep,
    restoredRelicsCount,
    paragraphs,
    crewFarewells,
  };
}

// ============================================================================
// Curated Sci-Fi Worldbuilding Lore Archive
// ============================================================================

export interface V3LoreEntryDef {
  readonly id: string;
  readonly category: '世界观' | '阵营档案' | '星区考据' | '遗物秘闻';
  readonly title: string;
  readonly unlockHint: string;
  readonly isUnlocked: (profile: V2ProfileState) => boolean;
  readonly body: string;
}

export const V3_LORE_ENTRIES: readonly V3LoreEntryDef[] = [
  {
    id: 'lore_stargate_network',
    category: '世界观',
    title: '古星门网络与大停摆纪元',
    unlockHint: '初始解锁',
    isUnlocked: () => true,
    body: '百年前，横跨七大旋臂的古代星门网络因一次未知的引力共振风暴同步熄火。外环殖民星系瞬间失去补给与通讯，唯独残留的轨道拆解站依托旧舰队漂流残骸，在近轨残骸带勉强维系着工业火种。',
  },
  {
    id: 'lore_old_fleet',
    category: '世界观',
    title: '旧舰队远征残卷',
    unlockHint: '完成首航教学解锁',
    isUnlocked: (p) => p.tutorialCompleted || p.totalRuns >= 1,
    body: '在大停摆前夕，旧帝国第七深空舰队奉命驶向星门禁区执行封锁任务，随后全员失联。如今分布在三大星区的模块化武器、异形船舱与自律护航舰，皆是那支庞大舰队解体后的遗产。',
  },
  {
    id: 'lore_faction_guild',
    category: '阵营档案',
    title: '星港行会 · 轨道商路秩序',
    unlockHint: '默认开放',
    isUnlocked: () => true,
    body: '由旧时代港口调度官与重型货轮船主组成的星港行会，掌管着近轨基础贸易与悬赏清剿协议。他们讲究契约精神与高效运力，也是拆解站最稳定的信用点来源。',
  },
  {
    id: 'lore_faction_institute',
    category: '阵营档案',
    title: '深空研究院 · 星门测绘学者',
    unlockHint: '建成研究台或声望达标解锁',
    isUnlocked: (p) => p.buildings.research_lab || (p.factionRep.deep_institute ?? 0) >= 30,
    body: '深空研究院由执着于重启星门的物理学家与考古工程师创立。他们持续资助星区测绘委托，并坚信只有复原散落的古代星门遗物，人类才能重新迈出孤岛星系。',
  },
  {
    id: 'lore_faction_salvagers',
    category: '阵营档案',
    title: '自由拾荒团 · 残骸带互助盟',
    unlockHint: '完成任意正式委托或声望达标解锁',
    isUnlocked: (p) =>
      p.completedContractIds.length >= 1 || (p.factionRep.free_salvagers ?? 0) >= 30,
    body: '游走于高危废船与信号盲区的民间打捞联盟。他们厌恶官僚管制，擅长高风险的多刀残骸切割与遇险救援，掌握着精密零件提纯的独门手艺。',
  },
  {
    id: 'lore_sector_near_orbit',
    category: '星区考据',
    title: '近轨残骸带与「铁砧号」封锁线',
    unlockHint: '击败第一幕首领「铁砧号」解锁',
    isUnlocked: (p) =>
      p.campaign.defeatedBossIds.includes('boss_anvil') ||
      p.campaign.unlockedSectors.includes('frozen_graveyard'),
    body: '「铁砧号」原为旧舰队的移动轨道船坞旗舰，在失去主控指令后仍机械执行着近轨封锁协议。击溃铁砧号，意味着拆解站终于拿回了通往外环舰冢的自由航权。',
  },
  {
    id: 'lore_sector_frozen',
    category: '星区考据',
    title: '冰晶舰冢带的低温电离异象',
    unlockHint: '击败第二幕首领「铁壁无畏」解锁',
    isUnlocked: (p) =>
      p.campaign.defeatedBossIds.includes('boss_dreadnought') ||
      p.campaign.unlockedSectors.includes('stargate_abyss'),
    body: '破碎的冰核卫星与泄漏的舰载冷却剂在此凝结成绵延数百万公里的低温电离云，持续侵蚀能量护盾。重甲旗舰「铁壁无畏」曾长期镇守此地，阻拦一切试图逼近古星门的船只。',
  },
  {
    id: 'lore_relics_resonance',
    category: '遗物秘闻',
    title: '四件星门遗物的共振矩阵',
    unlockHint: '在收藏展台修复至少 2 件古代遗物解锁',
    isUnlocked: (p) =>
      V2_RELIC_ORDER.filter((rid) => Boolean(p.relics[rid]?.restored)).length >= 2,
    body: '古代星盘校正空间坐标，冰晶琥珀稳定船体结构，量子核心突破舰载供能上限，黑曜冠徽则记录着星门防卫密钥。四件遗物并非孤立古董，而是古代星门主环的四枚相位钥匙。',
  },
  {
    id: 'lore_leviathan_protocol',
    category: '星区考据',
    title: '古代星门禁区与「黑曜利维坦」',
    unlockHint: '解锁第三幕终局任务或击败「黑曜利维坦」解锁',
    isUnlocked: (p) =>
      p.campaign.finalMissionUnlocked ||
      p.campaign.defeatedBossIds.includes('boss_leviathan') ||
      p.campaign.endingsUnlocked.length > 0,
    body: '引力潮汐是失活星门残余奇点产生的周期性脉动。守望在星门核心前的「黑曜利维坦」拥有三阶段自律防卫协议——唯有通过它的终极试炼，舰长才配决定古代星门的归属。',
  },
  {
    id: 'lore_endless_abyss',
    category: '世界观',
    title: '无尽深渊 · 星门彼端的回响',
    unlockHint: '达成任意终局结局解锁',
    isUnlocked: (p) => p.campaign.endlessUnlocked || p.campaign.endingsUnlocked.length > 0,
    body: '星门深处的空间褶皱并未止步于已知星图。随着威压等级逐级攀升，电离过载、偏导矩阵与重甲编队等异常词条将接连涌现，唯有真正成熟的旗舰配装与战术指挥方能在此铭刻传奇。',
  },
];

// ============================================================================
// Enemy Bestiary & Boss Dossier Tactical Notes
// ============================================================================

export interface V3BestiaryNote {
  readonly kind: string;
  readonly lore: string;
  readonly counterTip: string;
}

export const V3_BESTIARY_NOTES: Record<string, V3BestiaryNote> = {
  patrol: {
    kind: 'patrol',
    lore: '旧舰队标准近轨巡逻编队，负责在浅层航道驱离无证打捞船。',
    counterTip: '常规激光或基础炮艇核心火力即可快速清场，适合保留护盾应对后续深层战斗。',
  },
  swarm: {
    kind: 'swarm',
    lore: '高机动轻型无人机蜂群，虽护甲薄弱但多目标齐射易快速削薄护盾。',
    counterTip: '防空阵列、齐射导弹舱或舰体范围战术指令能一回合蒸发整队蜂群。',
  },
  armored: {
    kind: 'armored',
    lore: '厚甲护卫炮艇，外壳装甲可逐次削减低单发伤害武器。',
    counterTip: '重炮爆发、激光贴邻电池或「聚焦校准」无视护甲指令可高效击穿重甲。',
  },
  piercer: {
    kind: 'piercer',
    lore: '装备穿盾激光阵列的高危袭扰编队，部分伤害直接穿透护盾打击船体。',
    counterTip: '优先集火秒杀穿盾单位，并在关键回合使用「紧急护盾」令穿盾比例减半。',
  },
  artillery: {
    kind: 'artillery',
    lore: '搭载重型轨道炮的远程火力舰，奇数回合蓄力、偶数回合发射穿盾齐射。',
    counterTip: '利用奇数回合蓄力窗口全力集火击沉，或在偶数回合前提前补盾防爆发。',
  },
  shield_regen: {
    kind: 'shield_regen',
    lore: '配备双回路护盾发生器的工程舰，每隔一回合便会再生偏导护盾。',
    counterTip: 'EMP 干扰器能提前剥离敌方护盾，或以高单轮直击一举击破避免拉锯。',
  },
  drone_carrier: {
    kind: 'drone_carrier',
    lore: '可循环放出护航无人机的轻型母舰，拖延越久敌方火力越密集。',
    counterTip: '切换「优先最大威胁」直斩母舰，或配合防空阵列压制召唤无人机。',
  },
  emp_disruptor: {
    kind: 'emp_disruptor',
    lore: '专精电子战的干扰舰，会周期性释放 EMP 脉冲剥离我方护盾。',
    counterTip: '装配 EMP 干扰器可大幅抵消护盾削减，远航货船专属「舱壁抢修」可免疫 EMP。',
  },
  rammer: {
    kind: 'rammer',
    lore: '强化舰首撞角的突击艇，首轮加速蓄势、次轮发动高额穿盾撞击。',
    counterTip: '趁其奇数回合加速尚未撞击前优先集火击毁，或留足紧急护盾硬抗撞击轮。',
  },
  elite: {
    kind: 'elite',
    lore: '深层航道常见的高规格旗舰编队，兼具重甲防线与双护航截击机。',
    counterTip: '先清薄血护航减少每轮总伤，再集中核心火力配合战术指令击破主舰。',
  },
  boss_anvil: {
    kind: 'boss_anvil',
    lore: '第一幕首领：旧舰队重甲轨道船坞旗舰，半血后展开无人机船坞实施双线压制。',
    counterTip: '第 1 阶段先清护航机；半血进入第 2 阶段后保留战术充能，迅速清理召唤无人机并打穿蓄盾。',
  },
  boss_dreadnought: {
    kind: 'boss_dreadnought',
    lore: '第二幕首领：冰晶舰冢重甲旗舰，自带高护盾与厚甲，半血散热卸甲并蓄能 50% 穿盾主炮光束。',
    counterTip: '第 2 阶段护甲归零是绝佳爆发窗口，但必须在主炮蓄力后的光束回合启用「紧急护盾」减半穿盾伤害。',
  },
  boss_leviathan: {
    kind: 'boss_leviathan',
    lore: '第三幕终局首领：古星门三阶段守护旗舰，历经护航阵列、反应炉暴露与星渊终极齐射三重考验。',
    counterTip: '合理分配 2–3 次战术充能：前期清护航，第 2 阶段趁反应炉破甲猛攻，第 3 阶段抢在终极齐射前收官！',
  },
};
