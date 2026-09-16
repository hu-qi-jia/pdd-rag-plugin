// PDD 商家聊天工作台 —— 消息列表 DOM 提取(transport 无关,只读渲染结果)。
//
// 页面为 Vue2 应用,结构经 2026-09-08 真机校准:
//   #msgListContainer > ul.msg-list > li.onemsg[id="middlePanel_list_<毫秒号>"]
//     > div.merchantMessage
//         > p.message-time?                        (分组时间,"2026年09月08日 17:30:17")
//         > div.cs-item[.isread][.callback]        客服消息(含机器人回复 callback)
//         > div.buyer-item                         买家消息
//         > div.system-msg-31 等                   系统/提示行(跳过)
//   正文:角色容器内 div[currentuid] > .msg-content > p.msg-content-box
//        —— 图片/商品卡等非文本消息无此文本节点,自动跳过。
//   会话键:消息容器 [currentuid] 属性 = 买家 uid(与列表项 data-random 同源)。
//
// 提取规则为启发式且全 DOM 字段可观测;页面改版只影响个别类名,
// 文本语义(li.onemsg / 双角色类 / msg-content-box)足以自适应大部分结构变化。
// 纯函数不依赖 chrome API,便于 happy-dom 单测。

export interface DomMessage {
  role: 'buyer' | 'agent'
  text: string
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
    if (!text) continue

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

    out.push({ role: cs ? 'agent' : 'buyer', text, sessionKey, msgId, ts })
  }
  return out
}
