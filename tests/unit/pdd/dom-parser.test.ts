import { describe, it, expect } from 'vitest'
import {
  extractMessages,
  parseTimeText,
  type DomMessage,
} from '../../../src/pdd/dom-parser'

/**
 * 夹具取材于 2026-09-08 真机校准的 PDD chat-merchant DOM(逐字还原关键结构,
 * 仅省略 data-v 哈希与头像长 src)。
 */

const AGENT_ROW = `<li id="middlePanel_list_1788858534944" class="clearfix onemsg">
  <div class="merchantMessage">
    <p class="message-time">
  2026年09月08日 17:12:14
</p>
    <div class="cs-item isread">
      <span><img src="http://t16img.yangkeduo.com/x.png" class="avatar"><p class="nickname"><span>主账号</span></p></span>
      <div index="1" messagelist="[object Object]" userinfo="[object Object]" currentuid="1875210170836" csinfosmap="[object Object]">
        <div class="msg-content"><p class="msg-content-box">亲，咱们这款是大疆 DJI Mic Mini 迷你无线麦克风哦～发射器约10克超轻巧，搭配充电盒续航约48小时，还有强弱两挡降噪，户外和室内收音都清晰，日常拍摄很方便哒～</p> <!----></div>
        <div style="clear: both;"></div>
      </div>
    </div>
  </div>
</li>`

const BUYER_ROW = `<li id="middlePanel_list_1788772174060" class="clearfix onemsg">
  <div class="merchantMessage">
    <div class="buyer-item">
      <span><img src="https://savatar.pddpic.com/a/y.png"></span>
      <div index="1" messagelist="[object Object]" userinfo="[object Object]" currentuid="1875210170836">
        <div class="msg-content"><p class="msg-content-box">商品重量是多少</p> <!----></div>
        <div style="clear: both;"></div>
      </div>
    </div>
  </div>
</li>`

/** 图片消息:角色容器有 .msg-content 但无 .msg-content-box 文本 */
const IMAGE_ROW = `<li id="middlePanel_list_1788858679999" class="clearfix onemsg">
  <div class="merchantMessage">
    <div class="buyer-item">
      <span><img src="https://savatar.pddpic.com/a/y.png"></span>
      <div currentuid="1875210170836">
        <div class="msg-content"><img src="https://img.pddpic.com/p.jpg"></div>
      </div>
    </div>
  </div>
</li>`

/** 系统/提示行:无 cs-item/buyer-item */
const SYSTEM_ROW = `<li id="middlePanel_list_1788858535343" class="clearfix onemsg">
  <div class="merchantMessage">
    <div class="system-msg-31" index="7" messagelist="[object Object],[object Object]">
      <span>您接待过此消费者，为避免插嘴、抢答，机器人已暂停接待，点此【立即恢复接待】</span>
    </div>
  </div>
</li>`

/** 机器人回复行:cs-item.callback */
const ROBOT_ROW = `<li id="middlePanel_list_1788858504022" class="clearfix onemsg">
  <div class="merchantMessage">
    <div class="cs-item isread callback">
      <span><p class="nickname"><span>机器人</span></p></span>
      <div currentuid="1875210170836">
        <div class="msg-content"><p class="msg-content-box">亲，这个问题的答案在这里~</p></div>
      </div>
    </div>
  </div>
</li>`

function wrap(...rows: string[]): Element {
  document.body.innerHTML = `<div id="msgListContainer"><ul class="msg-list">${rows.join('')}</ul></div>`
  return document.querySelector('ul.msg-list')!
}

describe('parseTimeText: 页内时间文本 → 本地毫秒', () => {
  it('解析完整日期时间', () => {
    const t = parseTimeText('  2026年09月08日 17:12:14\n')
    expect(t).toBe(new Date(2026, 8, 8, 17, 12, 14).getTime())
  })

  it('无秒可解析(降级 0 秒)', () => {
    expect(parseTimeText('2026年1月2日 3:04')).toBe(new Date(2026, 0, 2, 3, 4, 0).getTime())
  })

  it('垃圾输入返回 undefined', () => {
    expect(parseTimeText('2026/01/02 03:04')).toBeUndefined()
    expect(parseTimeText('')).toBeUndefined()
    expect(parseTimeText(null)).toBeUndefined()
  })
})

describe('extractMessages: 真机消息列表 DOM → 文本消息流', () => {
  it('客服行:正文/会话键/时间/行 id 全部提取', () => {
    const msgs = extractMessages(wrap(AGENT_ROW))
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual({
      role: 'agent',
      text: '亲，咱们这款是大疆 DJI Mic Mini 迷你无线麦克风哦～发射器约10克超轻巧，搭配充电盒续航约48小时，还有强弱两挡降噪，户外和室内收音都清晰，日常拍摄很方便哒～',
      sessionKey: '1875210170836',
      msgId: '1788858534944',
      ts: new Date(2026, 8, 8, 17, 12, 14).getTime(),
    })
  })

  it('买家行(无分组时间)ts 回退行 id 毫秒号', () => {
    const msgs = extractMessages(wrap(BUYER_ROW))
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual({
      role: 'buyer',
      text: '商品重量是多少',
      sessionKey: '1875210170836',
      msgId: '1788772174060',
      ts: 1788772174060,
    })
  })

  it('图片消息(无 .msg-content-box)跳过', () => {
    expect(extractMessages(wrap(IMAGE_ROW))).toEqual([])
  })

  it('系统提示行(无角色容器)跳过', () => {
    expect(extractMessages(wrap(SYSTEM_ROW))).toEqual([])
  })

  it('机器人回复(cs-item.callback)按客服计', () => {
    const msgs = extractMessages(wrap(ROBOT_ROW))
    expect(msgs[0].role).toBe('agent')
    expect(msgs[0].text).toContain('答案在这里')
  })

  it('多行按 DOM 顺序(时间升序)输出', () => {
    const msgs = extractMessages(wrap(BUYER_ROW, AGENT_ROW, IMAGE_ROW, SYSTEM_ROW))
    expect(msgs.map((m) => m.role)).toEqual(['buyer', 'agent'])
    expect(msgs[0].msgId).toBe('1788772174060')
  })

  it('会话键缺失(currentuid 不在)时回退调用方上下文', () => {
    const row = BUYER_ROW.replace('currentuid="1875210170836"', '')
    const msgs = extractMessages(wrap(row), { sessionKey: 'ctx-fallback' })
    expect(msgs[0].sessionKey).toBe('ctx-fallback')
  })

  it('正文两端空白清理、行内文本保留', () => {
    const row = AGENT_ROW.replace(
      '日常拍摄很方便哒～',
      '日常拍摄很方便哒～\n            第二行',
    )
    const msgs = extractMessages(wrap(row))
    expect(msgs[0].text.startsWith('亲，')).toBe(true)
    expect(msgs[0].text).toContain('第二行')
  })

  it('非 onemsg 容器/空列表安全返回空', () => {
    expect(extractMessages(wrap())).toEqual([])
    const div = document.createElement('div')
    div.id = 'other'
    expect(extractMessages(div)).toEqual([])
  })

  it('类型收窄:extractMessages 返回值满足 DomMessage', () => {
    const msgs: DomMessage[] = extractMessages(wrap(BUYER_ROW))
    expect(msgs.every((m) => m.role === 'buyer' || m.role === 'agent')).toBe(true)
  })
})
