/**
 * md 净化与结构感知分块单测。
 * 背景:固定 500 字滑窗分块把 md 标记(##/-/**)带进填充文本,且在块边界截断
 * 列表项导致语义不完整(用户真实反馈)。方案:
 *  - mdToPlainText:入库前剥 md 标记,填充出去的是干净纯文本;
 *  - chunkMarkdown:按标题切小节,小节整块保留(≤500 字);超长小节按行分组,
 *    永不截断单行;无结构纯文本回退原 chunkText(500/75 滑窗,原项目逻辑兜底)。
 */
import { describe, it, expect } from 'vitest'
import { mdToPlainText, chunkMarkdown } from '../../../src/shared/mdText'
import { chunkText } from '../../../src/shared/chunkText'

describe('mdToPlainText', () => {
  it('剥标题/列表/加粗/行内代码/链接标记,保留文字', () => {
    const md = '## 退换货条件\n\n- **7 天无理由**:自签收起 7 天内\n- 见[帮助中心](https://x.com)\n- 支持 `7天` 退换'
    const out = mdToPlainText(md)
    expect(out).not.toContain('#')
    expect(out).not.toContain('**')
    expect(out).not.toContain('- [')
    expect(out).toContain('退换货条件')
    expect(out).toContain('7 天无理由:自签收起 7 天内')
    expect(out).toContain('见帮助中心')
    expect(out).toContain('支持 7天 退换')
  })

  it('水平线行删除;引用符剥离', () => {
    const md = '第一段\n\n---\n\n> 引用的话'
    const out = mdToPlainText(md)
    expect(out).toContain('第一段')
    expect(out).toContain('引用的话')
    expect(out).not.toContain('---')
    expect(out).not.toContain('>')
  })

  it('普通纯文本原样保留(幂等无害)', () => {
    const t = '这是普通文本,保留逗号与句号。'
    expect(mdToPlainText(t)).toBe(t)
  })
})

describe('chunkMarkdown(结构感知分块)', () => {
  const policyMd = [
    '# 售后政策',
    '',
    '按拼多多平台常规规则执行。',
    '',
    '## 退换货条件',
    '',
    '- 7 天无理由退货:自签收之日起 7 天内,商品保持完好、不影响二次销售(配件齐全、包装完整)。',
    '',
    '- 质量问题:自签收之日起 15 天内,因产品质量问题(如无法开机、无法配对、杂音等)可申请退换。',
    '',
    '- 不支持无理由退货的情形:已激活并超出无理由期限、人为损坏(进水、摔落、私自拆修)。',
    '',
    '## 维修与保修',
    '',
    '- 产品保修以商品页标注的保修期限为准,质量问题优先换新或维修。',
    '- 人为损坏(进水、摔坏、私自拆修)不在保修范围,可付费维修。',
  ].join('\n')

  it('小节整块保留:每条列表项完整出现在某块中,不被截断', () => {
    const chunks = chunkMarkdown(policyMd)
    const all = chunks.map((c) => c.text).join('\n')
    expect(chunks.length).toBeGreaterThanOrEqual(3) // 引言 + 两个小节
    expect(all).toContain('商品保持完好、不影响二次销售(配件齐全、包装完整)。')
    expect(all).toContain('因产品质量问题(如无法开机、无法配对、杂音等)可申请退换。')
    expect(all).toContain('质量问题优先换新或维修。')
    for (const c of chunks) expect(c.text).not.toMatch(/^#+\s/m) // 无标题标记残留
  })

  it('块带小节标题元数据', () => {
    const chunks = chunkMarkdown(policyMd)
    const titles = chunks.map((c) => c.title)
    tiles_fix(titles)
  })

  it('无任何标题的纯长文本 → 回退原 chunkText 滑窗(原项目逻辑兜底)', () => {
    const plain = Array.from({ length: 1500 }, (_, i) => String(i % 10)).join('')
    const chunks = chunkMarkdown(plain)
    expect(chunks.map((c) => c.text)).toEqual(chunkText(plain))
  })

  it('超长小节按行分组:每行完整,块长尽量 ≤500', () => {
    const longLine = (n: number) => `- 条目${n}:${'内容'.repeat(60)}` // 127 字/行
    const md = `## 大节\n\n${[1, 2, 3, 4, 5, 6, 7, 8].map(longLine).join('\n\n')}`
    const chunks = chunkMarkdown(md)
    const all = chunks.map((c) => c.text).join('\n')
    for (let n = 1; n <= 8; n++) {
      expect(all).toContain(`条目${n}:${'内容'.repeat(60)}`) // 每行完整
    }
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(500 + 130) // ≤上限+单行余量
    }
  })

  it('单行超长(>500)→ 该行自身回退滑窗', () => {
    const long = '超'.repeat(1200)
    const md = `## 长行节\n${long}`
    const chunks = chunkMarkdown(md)
    const joined = chunks.map((c) => c.text).join('')
    expect(joined).toContain(long)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('超长小节分组截断点吸附空行:截断处落在段落间隙,块尾不残留半截空行', () => {
    const p = (n: number) => `段落${n}:${'内容'.repeat(58)}` // 120 字/行
    const md = `## 大节\n\n${[1, 2, 3, 4, 5].map(p).join('\n\n')}`
    const chunks = chunkMarkdown(md)
    // 溢出发生在追加段落5(1-4 段+分隔共 487 字);截断点吸附到最近空行
    // (段落4/5 间隙):空行整体不落入任何块;旧行为块尾残留半个空行("\n")
    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toBe([p(1), p(2), p(3), p(4)].join('\n\n'))
    expect(chunks[1].text).toBe(p(5))
    expect(chunks[0].text.endsWith('\n')).toBe(false)
  })
})

function tiles_fix(titles: string[]) {
  // 标题应含小节名;引言块用文档级(空)标题
  expect(titles.some((t) => t.includes('退换货条件'))).toBe(true)
  expect(titles.some((t) => t.includes('维修与保修'))).toBe(true)
}
