// PDD 商家聊天工作台 —— 消息列表 DOM 提取(transport 无关,只读渲染结果)。
//
// 页面为 Vue2 应用,结构经 2026-09-08 真机校准:
//   #msgListContainer > ul.msg-list > li.onemsg[id="middlePanel_list_<毫秒号>"]
//     > div.merchantMessage
//         > p.message-time?                        (分组时间,"2026年09月08日 17:30:17")
//         > div.cs-item[.isread][.callback]        客服消息(含机器人回复 callback)
//         > div.buyer-item                         买家消息
//         > div.system-msg-31 等                   系统/提示行(跳过)
// 正文:角色容器内 div[currentuid] > .msg-content > p.msg-content-box
//        —— 图片消息另走一条:div.msg-content.image-msg > .msg-img-container > img.img-msg-thumb
//        (商品卡/表情仍无文本节点,继续跳过)
//   会话键:消息容器 [currentuid] 属性 = 买家 uid(与列表项 data-random 同源)。
//
// 提取规则为启发式且全 DOM 字段可观测;页面改版只影响个别类名,
// 文本语义(li.onemsg / 双角色类 / msg-content-box)足以自适应大部分结构变化。
// 纯函数不依赖 chrome API,便于 happy-dom 单测。
import type { ImageAttachment } from '../types/memory'
import { IMAGE_PLACEHOLDER } from '../shared/constants'

/** 重新导出:捕获侧沿用 dom-parser 的导入路径,常量的唯一出处是 shared/constants */
export { IMAGE_PLACEHOLDER }

export interface DomMessage {
  role: 'buyer' | 'agent'
  text: string
  /** 图片附件;纯图片消息的 text 为空串(占位符由 ingest 给买家侧补,见 IMAGE_PLACEHOLDER) */
  attachments?: ImageAttachment[]
  /** 买家 uid(消息容器 currentuid 属性);缺失时回退调用方上下文 */
  sessionKey?: string
  /** 行 id middlePanel_list_ 后的平台毫秒号(消息级幂等键) */
  msgId?: string
  /** 消息时间(毫秒):message-time 文本 → 行 id 数字兜底 */
  ts?: number
}


/** 单条文本过长视为商品页/异常节点,跳过 */
const MAX_TEXT_CHARS = 4000

const TIME_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/

/** 解析页内时间文本("2026年09月08日 17:30:17")为本地毫秒时间戳 */
export function parseTimeText(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const m = TIME_RE.exec(raw)
  if (!m) return undefined
  const [, y, mo, d, h, mi, s] = m
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
  ).getTime()
}

/** 提取消息行内正文文本节点(非文本消息无 .msg-content-box → undefined) */
function pickTextBox(side: Element): string | undefined {
  const box = side.querySelector('.msg-content-box')
  if (!box) return undefined
  const text = (box.textContent ?? '').trim()
  if (!text || text.length > MAX_TEXT_CHARS) return undefined
  return text
}

/**
 * 图片消息的地址 → 只留原图 base。
 *
 * 平台给的是七牛式处理后的地址(`…jpeg?imageMogr2/thumbnail/800x800gt;`),
 * 处理参数不是鉴权、只是缩放指令:剥掉后同一 URL 返回原图,展示侧再按需拼小图。
 * 解析不出(相对路径/非法地址)就整条丢弃 —— 存一个坏地址比不存更糟。
 */
export function normalizeImageUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined
  try {
    const u = new URL(src)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return undefined
  }
}

/** 图片消息 → 附件;商品卡/表情没有 `.image-msg` 这一层,不会误收 */
function pickImageAttachments(side: Element): ImageAttachment[] | undefined {
  const img = side.querySelector('.msg-content.image-msg img.img-msg-thumb')
  const url = normalizeImageUrl(img?.getAttribute('src'))
  return url ? [{ type: 'image', url }] : undefined
}

/**
 * 从消息列表容器(ul.msg-list)提取全部文本消息。
 * 按 DOM 顺序返回(时间升序)。ctx.sessionKey 为消息缺省会话键时的兜底。
 */
export function extractMessages(
  list: Element,
  ctx?: { sessionKey?: string },
): DomMessage[] {
  const out: DomMessage[] = []
  for (const li of list.querySelectorAll('li.onemsg')) {
    // ── 角色:客服优先(系统行两角色类都没有 → 跳过) ──
    const cs = li.querySelector('.cs-item')
    const side = cs ?? li.querySelector('.buyer-item')
    if (!side) continue

    const text = pickTextBox(side)
    const attachments = pickImageAttachments(side)
    // 纯图片消息没有正文,但它是真实消息:给占位符,别让 ingest 当成"无文本"丢掉
    if (!text && !attachments) continue

    // 会话键:消息容器 currentuid 属性;页面改版后由调用方上下文兜底
    const uidEl = side.querySelector('[currentuid]')
    const sessionKey =
      uidEl?.getAttribute('currentuid')?.trim() || ctx?.sessionKey

    // 行 id = middlePanel_list_<平台毫秒号> → 消息级幂等键
    const idMatch = /middlePanel_list_(\d+)/.exec(li.id ?? '')
    const msgId = idMatch ? idMatch[1] : undefined

    // 时间:分组时间文本 → 行 id 数字兜底
    const timeEl = li.querySelector('.message-time')
    const ts =
      parseTimeText(timeEl?.textContent) ??
      (msgId ? Number(msgId) : undefined)

    out.push({
      role: cs ? 'agent' : 'buyer',
      // 图片消息没有正文:这里给空串,占位符只由 ingest 给**买家**补(见 pddCapture)
      text: text ?? '',
      ...(attachments ? { attachments } : {}),
      sessionKey,
      msgId,
      ts,
    })
  }
  return out
}
