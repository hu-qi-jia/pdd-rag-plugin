import { describe, it, expect } from 'vitest'
import { isPddImageHost, thumbUrl } from '../../../src/shared/images'

describe('thumbUrl:只给拼多多图片域拼处理参数', () => {
  it('聊天图片域 → 拼 thumbnail(原图 base 保持不动)', () => {
    expect(thumbUrl('https://chat-img.pddugc.com/chat-pic-mall-cs-v1/2026-10-23/a.jpeg', 200)).toBe(
      'https://chat-img.pddugc.com/chat-pic-mall-cs-v1/2026-10-23/a.jpeg?imageMogr2/thumbnail/200x200',
    )
  })

  it('商品图域(img.pddpic.com)同样支持', () => {
    expect(thumbUrl('https://img.pddpic.com/a.png', 96)).toBe(
      'https://img.pddpic.com/a.png?imageMogr2/thumbnail/96x96',
    )
  })

  it('其它域原样返回 —— 别家服务可能把查询串当鉴权', () => {
    const url = 'https://example.com/a.jpg'
    expect(thumbUrl(url, 96)).toBe(url)
  })

  it('非法地址原样返回,不抛异常', () => {
    expect(thumbUrl('not-a-url', 96)).toBe('not-a-url')
  })
})

describe('isPddImageHost', () => {
  it('精确域与子域都算', () => {
    expect(isPddImageHost('https://chat-img.pddugc.com/x.jpeg')).toBe(true)
    expect(isPddImageHost('https://img.pddpic.com/x.png')).toBe(true)
    expect(isPddImageHost('https://evil-pddugc.com/x.png')).toBe(false)
  })
})
