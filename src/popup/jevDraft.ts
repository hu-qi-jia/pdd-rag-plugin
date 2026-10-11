/**
 * 问题自动分类(jev)接口表单的**草稿**存储 —— `llmDraft.ts` 的同构副本。
 *
 * 工具栏弹窗失焦即被 Chrome 销毁,扩展没有任何 API 能拦 —— 所以不去对抗它,
 * 改成**边填边存**:没点保存就关掉,下次打开原样接着填。
 *
 * 与正式配置(`pddcs:settings`)严格分开的两个键:
 *   pddcs:settings  = 点了「保存」才写,是真正会拿去发请求的那份;
 *   pddcs:jevDraft  = 每次敲键盘就写,只是"框里现在写着什么"。
 * 分开的意义:半途而废的密钥不会变成生效配置 —— 不点保存就永远不出网。
 *
 * 为什么不与 llm 草稿共用一份:那是两套互不相干的配置(baseUrl/key/model 各填各的),
 * 共用一份键会让后保存的一方覆盖另一方 —— 用户的 AI 整合草稿会被分类配置悄悄顶掉。
 *
 * 保存成功后草稿即清除(它已经等于正式配置了);不这么做的话,
 * 后台对 baseUrl 的夹取(去尾斜杠等)会让草稿与正式配置永远差一点点,
 * 于是「有未保存的修改」凭空常驻。
 *
 * 照第五十一轮的教训与 `llmDraft.ts` 一样落在 `popup/`:`pdd/` 那一层的契约是
 * "纯逻辑,不触碰 chrome/Dexie",而这个文件从头到尾只有 chrome.storage 的读/写/删 ——
 * 唯一的使用者就是设置页,放在被它服务的这一层才对。纯逻辑那一半(`pdd/jev-form.ts`)原地不动。
 */
import { loadFromChrome, removeFromChrome, saveToChrome } from '../shared/chrome-storage'
import { JEV_DRAFT_STORAGE_KEY } from '../shared/constants'
import type { JevFormFields } from '../pdd/jev-form'

/**
 * 落草稿的防抖间隔。取 300ms 是两头夹出来的:
 * 上限是"人手从键盘移到窗口外点一下"的时间(几百毫秒起),再长就会丢字;
 * 下限是别每敲一个字符写一次 chrome.storage(那是个跨进程调用)。
 */
export const JEV_DRAFT_DEBOUNCE_MS = 300

function isJevDraft(v: unknown): v is JevFormFields {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return typeof d.baseUrl === 'string' && typeof d.apiKey === 'string' && typeof d.model === 'string'
}

export function loadJevDraft(): Promise<JevFormFields | null> {
  return loadFromChrome<JevFormFields>(JEV_DRAFT_STORAGE_KEY, isJevDraft)
}

export function saveJevDraft(fields: JevFormFields): Promise<void> {
  return saveToChrome(JEV_DRAFT_STORAGE_KEY, {
    baseUrl: fields.baseUrl,
    apiKey: fields.apiKey,
    model: fields.model,
  })
}

export function clearJevDraft(): Promise<void> {
  return removeFromChrome(JEV_DRAFT_STORAGE_KEY)
}
