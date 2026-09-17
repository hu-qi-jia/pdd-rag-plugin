/**
 * AI 接口表单的**草稿**存储(2026-09-17 第四十八轮用户反馈:
 * "配置模型信息时,只要点击窗口外面的部分窗口就会关闭,会导致已填充的内容不见")。
 *
 * 工具栏弹窗失焦即被 Chrome 销毁,扩展没有任何 API 能拦 —— 所以不去对抗它,
 * 改成**边填边存**:没点保存就关掉,下次打开原样接着填。
 *
 * 与正式配置(`pddcs:settings`)严格分开的两个键:
 *   pddcs:settings  = 点了「保存」才写,是真正会拿去发请求的那份;
 *   pddcs:llmDraft  = 每次敲键盘就写,只是"框里现在写着什么"。
 * 分开的意义:半途而废的密钥不会变成生效配置 —— 不点保存就永远不出网。
 *
 * 保存成功后草稿即清除(它已经等于正式配置了);不这么做的话,
 * 后台对 baseUrl 的夹取(去尾斜杠等)会让草稿与正式配置永远差一点点,
 * 于是「有未保存的修改」凭空常驻。
 *
 * 第五十一轮自 `pdd/llm-draft.ts` 迁到 `popup/`(工程审查):`pdd/` 那一层的契约是
 * "纯逻辑,不触碰 chrome/Dexie"(见同目录 ui-logic.ts / segmenter.ts 的文件头),
 * 而这个文件从头到尾只有 chrome.storage 的读/写/删 —— 唯一的使用者就是设置页,
 * 放在被它服务的这一层才对。纯逻辑那一半(`pdd/llm-form.ts`)原地不动。
 */
import { loadFromChrome, removeFromChrome, saveToChrome } from '../shared/chrome-storage'
import { LLM_DRAFT_STORAGE_KEY } from '../shared/constants'
import type { LlmFormFields } from '../pdd/llm-form'

/**
 * 落草稿的防抖间隔。取 300ms 是两头夹出来的:
 * 上限是"人手从键盘移到窗口外点一下"的时间(几百毫秒起),再长就会丢字;
 * 下限是别每敲一个字符写一次 chrome.storage(那是个跨进程调用)。
 */
export const LLM_DRAFT_DEBOUNCE_MS = 300

function isLlmDraft(v: unknown): v is LlmFormFields {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return typeof d.baseUrl === 'string' && typeof d.apiKey === 'string' && typeof d.model === 'string'
}

export function loadLlmDraft(): Promise<LlmFormFields | null> {
  return loadFromChrome<LlmFormFields>(LLM_DRAFT_STORAGE_KEY, isLlmDraft)
}

export function saveLlmDraft(fields: LlmFormFields): Promise<void> {
  return saveToChrome(LLM_DRAFT_STORAGE_KEY, {
    baseUrl: fields.baseUrl,
    apiKey: fields.apiKey,
    model: fields.model,
  })
}

export function clearLlmDraft(): Promise<void> {
  return removeFromChrome(LLM_DRAFT_STORAGE_KEY)
}
