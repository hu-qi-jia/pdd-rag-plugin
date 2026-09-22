/**
 * 待沉淀清单聚合单测(v0.16)。
 *
 * 这一页的价值全在"挑出哪些问题值得沉淀"这件事上,挑错了就是白打扰用户 ——
 * 所以口径逐条钉住:已有标准回答的不出现、没回复的不出现、忽略的不出现、
 * 自检数据不出现;排序按出现次数而非时间。
 */
import { describe, it, expect } from 'vitest'
import { buildBacklog, type BacklogPlanInput } from '../../../src/background/backlogPlan'

const SELF_TEST = '__pddcs_selftest__'

function qa(
  id: string,
  questionHash: string,
  questionTs: number,
  sessionKey = 'sess-1',
  question = `问题-${id}`,
): BacklogPlanInput['qa'][number] {
  return { id, question, questionHash, questionTs, sessionKey }
}

function reply(
  id: string,
  qaId: string,
  text: string,
  ts: number,
  contentHash = `ch-${id}`,
): BacklogPlanInput['replies'][number] {
  return { id, qaId, text, contentHash, ts }
}

function plan(over: Partial<BacklogPlanInput>): ReturnType<typeof buildBacklog> {
  return buildBacklog({
    qa: [],
    replies: [],
    goldenHashes: new Set(),
    ignoreHashes: new Set(),
    selfTestSessionKey: SELF_TEST,
    limit: 50,
    repliesPerItem: 5,
    ...over,
  })
}

describe('buildBacklog:分组与计数', () => {
  it('同一问法多次出现 → 合成一条,count = 出现次数,代表取最近一次的问法', () => {
    const r = plan({
      qa: [
        qa('a', 'h1', 100, 'sess-1', '怎么退货'),
        qa('b', 'h1', 300, 'sess-2', '怎么退货?'),
        qa('c', 'h1', 200, 'sess-3', '怎么退货'),
      ],
      replies: [reply('r1', 'a', '七天无理由', 150)],
    })
    expect(r.total).toBe(1)
    expect(r.items[0].count).toBe(3)
    expect(r.items[0].lastTs).toBe(300)
    // 代表问题原文 = 最近一次那条记录的问法(不是最早那条)
    expect(r.items[0].question).toBe('怎么退货?')
  })

  it('不同 questionHash 各自成组(措辞不同不合并,如实反映口径)', () => {
    const r = plan({
      qa: [qa('a', 'h1', 100), qa('b', 'h2', 200)],
      replies: [reply('r1', 'a', 'A', 1), reply('r2', 'b', 'B', 2)],
    })
    expect(r.total).toBe(2)
  })

  it('排序:出现次数倒序优先,同次数按最近出现时间倒序', () => {
    const r = plan({
      qa: [
        qa('r1', 'low-new', 900),
        qa('r2', 'high', 100),
        qa('r3', 'high', 200),
        qa('r4', 'low-old', 50),
      ],
      replies: [
        reply('x1', 'r1', 'A', 901),
        reply('x2', 'r2', 'B', 101),
        reply('x3', 'r3', 'C', 201),
        reply('x4', 'r4', 'D', 51),
      ],
    })
    // high(2 次)必须排在两次 1 次之前 —— 只按时间排会让"新问的一次性问题"盖住高频问题
    expect(r.items.map((i) => i.questionHash)).toEqual(['high', 'low-new', 'low-old'])
  })
})

describe('buildBacklog:不该出现的', () => {
  it('已有标准回答的问题不进清单', () => {
    const r = plan({
      qa: [qa('a', 'h1', 100)],
      replies: [reply('r1', 'a', 'A', 1)],
      goldenHashes: new Set(['h1']),
    })
    expect(r.total).toBe(0)
  })

  it('被忽略的问题不进清单', () => {
    const r = plan({
      qa: [qa('a', 'h1', 100)],
      replies: [reply('r1', 'a', 'A', 1)],
      ignoreHashes: new Set(['h1']),
    })
    expect(r.total).toBe(0)
  })

  it('一条回复都没有的问题不进清单(没有可提升的内容)', () => {
    const r = plan({ qa: [qa('a', 'h1', 100)] })
    expect(r.total).toBe(0)
  })

  it('自检示例数据不进清单(与统计口径一致)', () => {
    const r = plan({
      qa: [qa('a', 'h1', 100, SELF_TEST)],
      replies: [reply('r1', 'a', 'A', 1)],
    })
    expect(r.total).toBe(0)
  })
})

describe('buildBacklog:回复候选', () => {
  it('同组多条的回复按内容去重、最近优先', () => {
    const r = plan({
      qa: [qa('a', 'h1', 100), qa('b', 'h1', 200)],
      replies: [
        reply('r1', 'a', '老话术', 100, 'same'),
        reply('r2', 'b', '老话术', 250, 'same'), // 同内容 → 只留一条
        reply('r3', 'b', '新话术', 300, 'other'),
      ],
    })
    expect(r.items[0].replies.map((x) => x.text)).toEqual(['新话术', '老话术'])
  })

  it('回复候选带上各自所属的问答记录 id(提升时说得出这条答复从哪来)', () => {
    const r = plan({
      qa: [qa('a', 'h1', 100), qa('b', 'h1', 200)],
      replies: [reply('r1', 'a', 'A', 100), reply('r2', 'b', 'B', 200)],
    })
    expect(r.items[0].replies.find((x) => x.id === 'r2')?.qaId).toBe('b')
  })

  it('回复候选超出上限时截断(只留最近的)', () => {
    const replies = Array.from({ length: 8 }, (_, i) => reply(`r${i}`, 'a', `T${i}`, i + 1))
    const r = plan({
      qa: [qa('a', 'h1', 100)],
      replies,
      repliesPerItem: 3,
    })
    expect(r.items[0].replies.map((x) => x.id)).toEqual(['r7', 'r6', 'r5'])
  })
})

describe('buildBacklog:截断', () => {
  it('超过 limit 时只返回前 limit 条,total 仍是全量(页脚据此写明"已显示前 N 条")', () => {
    const qaRows = Array.from({ length: 7 }, (_, i) => qa(`a${i}`, `h${i}`, i + 1))
    const replies = Array.from({ length: 7 }, (_, i) => reply(`r${i}`, `a${i}`, `T${i}`, i + 1))
    const r = plan({ qa: qaRows, replies, limit: 3 })
    expect(r.items).toHaveLength(3)
    expect(r.total).toBe(7)
  })
})
