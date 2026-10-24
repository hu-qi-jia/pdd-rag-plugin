// ─── 跨上下文共享的运行时常量 ──────────────────────────────────────────────────
// SW / popup / content script 都要读的常量单处维护;2026-09-16 工程审查③自
// types/memory.ts 迁出,types/ 回归纯类型。存储 schema/DAO 见 background/db.ts。

import type { HotkeyConfig, PddSettings } from '../types/memory'
/** 预置默认文件夹固定 id(豁免保留期、导入幂等跳过) */
export const UNCATEGORIZED_FOLDER_ID = 'uncategorized'
/** 预置默认夹显示名(2026-09-15 第十八轮由「未分类」改名;id 不变,存量由 ensurePresetFolders 迁移) */
export const UNCATEGORIZED_FOLDER_NAME = '默认文件夹'

/** 自检(示例)数据专用会话标识:统计时排除、一键清理 */
export const SELF_TEST_SESSION_KEY = '__pddcs_selftest__'

/**
 * 纯图片消息的正文占位符。
 *
 * 捕获(dom-parser)、落盘(ingest 的"无文本"判据)与面板展示三处必须同一口径:
 * 空串会被 ingest 当成"无文本"整条丢掉,纯图片回复就再也进不了记忆。
 */
export const IMAGE_PLACEHOLDER = '[图片]'

/** 推荐回复快捷键(主键取 KeyboardEvent.key,如 Enter / a / ArrowDown)默认值 */
export const DEFAULT_HOTKEY: HotkeyConfig = {
  ctrl: true,
  alt: false,
  shift: false,
  key: 'Enter',
}

/** 推荐面板「下一候选」键默认 Tab(第二十二轮:↑↓ 与平台切换会话冲突,让位) */
export const DEFAULT_PANEL_NAV_HOTKEY: HotkeyConfig = {
  ctrl: false,
  alt: false,
  shift: false,
  key: 'Tab',
}

export const DEFAULT_SETTINGS: PddSettings = {
  directFillEnabled: false,
  simThreshold: 0.5,
  goldenThreshold: 0.4,
  kbThreshold: 0.4,
  retentionDays: 90,
  goldenPriorityEnabled: true,
  autoReplyHotkey: DEFAULT_HOTKEY,
  panelNavHotkey: DEFAULT_PANEL_NAV_HOTKEY,
  // AI 整合默认关:不配置、不开启时扩展保持完全本地(ADR-0006)
  aiIntegrateEnabled: false,
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  llmTimeoutMs: 8000,
  // 问题自动分类默认关:不配置、不开启时扩展保持完全本地(ADR-0007)
  classifyEnabled: false,
  jevBaseUrl: 'https://api.typesafe.ai',
  jevApiKey: '',
  jevModel: 'jev-latest',
  jevTimeoutMs: 3000,
  // 打标门槛:八类里存在重叠对(如「商品信息」与「库存与规格」、「退换货」与「质量与维修」),
  // 0.2 太松、误标多 —— 默认抬到 0.5
  classifyProbThreshold: 0.5,
}

/** 问答记录保留期的下限、上限与固定快捷档位 */
export const RETENTION_MIN_DAYS = 7
export const RETENTION_MAX_DAYS = 365
export const RETENTION_PRESETS = [7, 30, 90] as const

/** 单次整合超时的可配置区间(毫秒):下限防误填 0 变成秒断,上限防变成事实上的无限等待 */
export const LLM_TIMEOUT_MIN_MS = 2000
export const LLM_TIMEOUT_MAX_MS = 30000

/** 单次分类超时的可配置区间(毫秒)：分类是检索链路的一环，等太久不如不筛 */
export const JEV_TIMEOUT_MIN_MS = 1000
export const JEV_TIMEOUT_MAX_MS = 30000

/**
 * 「低置信」线 —— 机器打标的概率低于它就标出来,提示人工看一眼。
 *
 * **为什么是一个固定值,而不是跟着 `classifyProbThreshold` 走**:
 * 那个阈值是用户可调的门槛(默认 0.5,即"低于它就不打标")。若低置信线按它换算,
 * 用户把门槛调高之后,所有打上的标都"不低置信"了 —— 可是"模型自己都不够确定"
 * 是个**绝对**判断,不该随调参消失。
 *
 * 取 0.65 的语义是"过线了,但也只是刚够用"。它是不是太松,取决于 jev 实际给的概率分布:
 * 若绝大多数条目都被标成低置信,那不是这条线错了,而是 `classifyProbThreshold`
 * 该再往上提 —— 一屏全是"低置信"本身就是结论。
 *
 * 复核线必须**严格大于** DEFAULT_SETTINGS.classifyProbThreshold ——
 * 否则 isLowConfidenceCategory 判的（p < 线）与"过阈值"（p ≥ 阈值）永不同时成立，
 * 「低置信」标记整个失效（不是少标几条，是永远不显示）。见 spec M9。
 */
export const LOW_CONFIDENCE_LINE = 0.65

/**
 * 这条分类结果算不算"勉强过线"。
 *
 * 三类记录天然不是低置信,不参与标记:
 *   - 非机器打标(`inherit` 继承自来源问答 / `manual` 人工摆放)—— 那是**确定**的分类;
 *   - 没有概率值的(继承与人工路径都不写 confidence,见 db.setGoldenCategoryManual);
 *   - 概率达标但缺失的旧数据。
 */
export function isLowConfidenceCategory(r: {
  categorySource?: string
  categoryConfidence?: number
}): boolean {
  return (
    r.categorySource === 'jev' &&
    typeof r.categoryConfidence === 'number' &&
    r.categoryConfidence < LOW_CONFIDENCE_LINE
  )
}

export const SETTINGS_STORAGE_KEY = 'pddcs:settings'

/** AI 接口表单草稿(边填边存):弹窗失焦会被 Chrome 销毁,没保存的内容靠它续上。
 *  与 SETTINGS_STORAGE_KEY 分开 —— 草稿不是生效配置,半途而废的密钥不会出网。 */
export const LLM_DRAFT_STORAGE_KEY = 'pddcs:llmDraft'

/** jev 表单草稿(边填边存):与 llm 草稿分开,理由同上 —— 半途而废的密钥不会出网 */
export const JEV_DRAFT_STORAGE_KEY = 'pddcs:jevDraft'

/** 同一问题可保留的标准回答条数上限(用户指定:合计最多 3 条)。
 *  后台写入口径与聊天页 UI 提示共用同一个数字。 */
export const MAX_GOLDENS_PER_QUESTION = 3

// ─── 问题自动分类(第五十六轮) ────────────────────────────────────────────────

/** 未分类类型固定 id:兜底容器,不可改名/删,恒在检索池中(filterable=false) */
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized'

/** 未分类的显示名与排序位(恒排最后) */
export const UNCATEGORIZED_CATEGORY_NAME = '未分类'
export const UNCATEGORIZED_CATEGORY_POSITION = 9999

export interface PresetCategoryDef {
  id: string
  name: string
  /** 原样作为 jev 的 criteria 选项描述 */
  criteria: string
  route: 'retrieve' | 'size'
}

/**
 * 九个预置问题类型 —— 名称与判定说明写死,不可改名/删/改(设计 D3)。
 *
 * 判据是**答案从哪来**,不是话题:
 *  - size 路由的答案依赖买家个体参数,历史回复不可复用,必须现场生成;
 *  - retrieve 路由的答案模板化,历史与标准回答可直接复用。
 *
 * 判定说明必须彼此可区分 —— jev 的 choice 只从给定选项里选,选项描述含糊时
 * **全部类型**的判断质量一起下降,不只是写得差的那一条。每条末尾的"不含…（那走…）"
 * 是划边用的,不是客套:它让相邻两类读一遍就能判出该走谁。
 *
 * 前八条是**记录级**(route='retrieve'),即捕获/补分类打标时的选项集,
 * 排序即 售前→售中→售后→其他。末条 preset:size 是**查询级专用**(route='size'),
 * 理由见其上方注释。
 */
export const PRESET_CATEGORIES: readonly PresetCategoryDef[] = [
  {
    id: 'preset:attribute',
    name: '商品信息',
    criteria:
      '买家在询问商品本身的客观信息：参数、材质、产地、颜色、型号规格、尺寸、配件清单、怎么使用、能不能连接某个设备。包括"介绍一下商品/产品"这类泛泛的询问。不含价格与优惠、不含是否有货、不含下单之后的物流与售后。',
    route: 'retrieve',
  },
  {
    id: 'preset:price',
    name: '价格优惠',
    criteria:
      '买家在询问价格与优惠：多少钱、优惠券、满减、有没有活动、有没有赠品、能不能便宜、讲价、是否包邮。不含改价（那属于付款）、不含是否有货。',
    route: 'retrieve',
  },
  {
    id: 'preset:stock',
    name: '库存与规格',
    criteria:
      '买家在购买前询问是否有货：现在有没有货、某个颜色或型号或规格还有没有、什么时候补货、能不能拍下、能不能换成别的规格。与商品信息的区别是这里问的是"有没有"而不是"是什么"。不含已下单包裹的物流。',
    route: 'retrieve',
  },
  {
    id: 'preset:payment',
    name: '支付与发票',
    criteria:
      '买家在询问付款与票据：能用什么方式付款、能不能用某个支付方式、改价、开发票、开票流程、发票抬头与内容。不含退款（那走退换货）。',
    route: 'retrieve',
  },
  {
    id: 'preset:order',
    name: '发货与物流',
    criteria:
      '买家在询问已经下单的包裹：什么时候发货、催发货、用哪家快递、要运单号、物流停滞不更新、大概多久到货、修改收货地址。不含退货寄回（那走退换货）。',
    route: 'retrieve',
  },
  {
    id: 'preset:aftersale',
    name: '退换货',
    criteria:
      '买家在问退换与退款：要退货、要换货、要退款、运费险、七天无理由、不想要了。不含因商品损坏或功能故障引发的问题（那走质量与维修）。',
    route: 'retrieve',
  },
  {
    id: 'preset:quality',
    name: '质量与维修',
    criteria:
      '买家在反映商品本身有问题：收到就是坏的、破损、少发漏发、功能故障、用不了、要维修、问保修期限。不含非质量原因的不想要了（那走退换货）。',
    route: 'retrieve',
  },
  {
    id: 'preset:other',
    name: '其他',
    criteria:
      '买家的消息不属于上面任何一类时选它：打招呼、感谢、表情或乱码、闲聊、与本次交易无关的问题。注意：仅仅因为你没把握而选它是错的——只有确实不属于任何业务类型时才选它。',
    route: 'retrieve',
  },
  // 尺码是**查询级专用**(route='size'):记录级打标的选项集
  // (filterable && route==='retrieve')不含它,不会有记录被打上尺码标签;
  // 它仍留在数组里(排在业务类之后),供每次检索的意图识别使用。
  {
    id: 'preset:size',
    name: '尺码推荐',
    criteria:
      '买家在询问自己该选哪个尺码或规格:给出身高、体重、三围、鞋码等个人参数,或问偏大偏小、是否合适、自己穿几码。答案取决于买家的个体参数。',
    route: 'size',
  },
] as const
