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
  classifyProbThreshold: 0.2,
}

/** 单次整合超时的可配置区间(毫秒):下限防误填 0 变成秒断,上限防变成事实上的无限等待 */
export const LLM_TIMEOUT_MIN_MS = 2000
export const LLM_TIMEOUT_MAX_MS = 30000

/** 单次分类超时的可配置区间(毫秒)：分类是检索链路的一环，等太久不如不筛 */
export const JEV_TIMEOUT_MIN_MS = 1000
export const JEV_TIMEOUT_MAX_MS = 30000

export const SETTINGS_STORAGE_KEY = 'pddcs:settings'

/** AI 接口表单草稿(边填边存):弹窗失焦会被 Chrome 销毁,没保存的内容靠它续上。
 *  与 SETTINGS_STORAGE_KEY 分开 —— 草稿不是生效配置,半途而废的密钥不会出网。 */
export const LLM_DRAFT_STORAGE_KEY = 'pddcs:llmDraft'

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
 * 六个预置问题类型 —— 名称与判定说明写死,不可改名/删/改(设计 D3)。
 *
 * 判据是**答案从哪来**,不是话题:
 *  - size 路由的答案依赖买家个体参数,历史回复不可复用,必须现场生成;
 *  - retrieve 路由的答案模板化,历史与标准回答可直接复用。
 *
 * 判定说明必须彼此可区分 —— jev 的 choice 只从给定选项里选,选项描述含糊时
 * **全部类型**的判断质量一起下降,不只是写得差的那一条。
 */
export const PRESET_CATEGORIES: readonly PresetCategoryDef[] = [
  {
    id: 'preset:size',
    name: '尺码推荐',
    criteria:
      '买家在询问自己该选哪个尺码或规格:给出身高、体重、三围、鞋码等个人参数,或问偏大偏小、是否合适、自己穿几码。答案取决于买家的个体参数。',
    route: 'size',
  },
  {
    id: 'preset:order',
    name: '订单物流',
    criteria:
      '询问发货时间、催发货、快递公司、运单号、物流停滞不更新、修改收货地址、大概多久到货。围绕已经下单的包裹在路上或还没发出。',
    route: 'retrieve',
  },
  {
    id: 'preset:aftersale',
    name: '售后退换',
    criteria:
      '退换货、退款、运费险、七天无理由、商品质量问题、破损、少发漏发、需要维修。围绕成交之后的问题。',
    route: 'retrieve',
  },
  {
    id: 'preset:price',
    name: '价格优惠',
    criteria: '询问价格、优惠券、满减、议价讲价、能不能便宜、是否包邮、有没有活动或赠品。',
    route: 'retrieve',
  },
  {
    id: 'preset:attribute',
    name: '商品属性',
    criteria:
      '询问商品本身的客观属性:材质成分、产地、尺码表以外的规格型号、颜色、配件清单、洗涤保养方式。',
    route: 'retrieve',
  },
  {
    id: 'preset:stock',
    name: '库存发货',
    criteria:
      '购买前询问库存:现在有没有货、某个颜色或某个尺码还有没有、什么时候补货、能不能拍下。与订单物流的区别是这里还没下单。',
    route: 'retrieve',
  },
] as const
