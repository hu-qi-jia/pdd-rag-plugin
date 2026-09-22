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
}

/** 单次整合超时的可配置区间(毫秒):下限防误填 0 变成秒断,上限防变成事实上的无限等待 */
export const LLM_TIMEOUT_MIN_MS = 2000
export const LLM_TIMEOUT_MAX_MS = 30000

export const SETTINGS_STORAGE_KEY = 'pddcs:settings'

/** AI 接口表单草稿(边填边存):弹窗失焦会被 Chrome 销毁,没保存的内容靠它续上。
 *  与 SETTINGS_STORAGE_KEY 分开 —— 草稿不是生效配置,半途而废的密钥不会出网。 */
export const LLM_DRAFT_STORAGE_KEY = 'pddcs:llmDraft'

/** 同一问题可保留的标准回答条数上限(用户指定:合计最多 3 条)。
 *  后台写入口径与聊天页 UI 提示共用同一个数字。 */
export const MAX_GOLDENS_PER_QUESTION = 3
