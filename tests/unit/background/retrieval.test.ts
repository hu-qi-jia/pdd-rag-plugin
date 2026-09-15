/**
 * 混合检索纯逻辑单测:余弦/分词/BM25/RRF/时间衰减/阈值/折叠/排序。
 * 设计依据:设计文档 §6.2(检索锚=问题,回复正文折叠,金标准置顶)。
 */
import { describe, it, expect } from 'vitest'
import {
  cosineSim,
  tokenize,
  bm25Scores,
  rrfFuse,
  timeDecay,
  rankCandidates,
  assembleSuggestions,
  type RetSource,
  type RetReply,
} from '../../../src/background/retrieval'

const vec = (...xs: number[]) => new Float32Array(xs)
const DAY = 86_400_000

const mkSource = (id: string, kind: RetSource['kind'], question: string, questionTs = 1000): RetSource => ({
  id,
  kind,
  question,
  questionTs,
})

describe('cosineSim(L2 归一化向量,点积即余弦)', () => {
  it('同向=1,正交=0,反向=-1', () => {
    expect(cosineSim(vec(1, 0), vec(1, 0))).toBeCloseTo(1)
    expect(cosineSim(vec(1, 0), vec(0, 1))).toBeCloseTo(0)
    expect(cosineSim(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1)
  })
})

describe('tokenize:中文 bigram + ASCII 词', () => {
  it('中文按相邻二字切分', () => {
    expect(tokenize('能开发票吗')).toEqual(['能开', '开发', '发票', '票吗'])
  })
  it('ASCII 词与数字整体保留并小写,标点剔除', () => {
    // 实现顺序:中文 run 先于 ASCII 词(bag-of-words,顺序不影响 BM25)
    expect(tokenize('iPhone 14 Pro,支持!')).toEqual(['支持', 'iphone', '14', 'pro'])
  })
  it('中英混排', () => {
    expect(tokenize('支持iPhone吗')).toEqual(['支持', '吗', 'iphone']) // 单字中文 run 保留
  })
  it('单字中文查询退化为 unigram', () => {
    expect(tokenize('吗')).toEqual(['吗'])
  })
})

describe('bm25Scores:含查询词的文档得分更高', () => {
  it('命中文档 > 未命中文档', () => {
    const docs = [
      tokenize('发票可以开电子发票'), // 含 bigram 发票
      tokenize('今天天气不错'), // 无关
      tokenize('可以开发票吗'), // 含 开发 + 发票
    ]
    const scores = bm25Scores(docs, tokenize('开发票')) // ['开发','发票']
    expect(scores[0]).toBeGreaterThan(scores[1])
    expect(scores[2]).toBeGreaterThan(scores[1])
  })
})

describe('rrfFuse:两路排名融合', () => {
  it('两路都靠前的文档融合分最高', () => {
    // A:0>1>2;B:1>2>0 → 文档1(第2+第1)应胜出(其余组合名次和更大)
    const fused = rrfFuse([[0, 1, 2], [1, 2, 0]])
    const order = fused.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s).map((x) => x.i)
    expect(order[0]).toBe(1)
  })
  it('单路排名=该路顺序', () => {
    const fused = rrfFuse([[5, 3, 8]])
    expect(fused[5]).toBeGreaterThan(fused[3])
    expect(fused[3]).toBeGreaterThan(fused[8])
    expect(fused[0]).toBe(0) // 未上榜得 0
  })
})

describe('timeDecay:半衰期', () => {
  it('now=1,一个半衰期=0.5,两个=0.25', () => {
    const now = 1_000_000
    expect(timeDecay(now, now, 30)).toBeCloseTo(1)
    expect(timeDecay(now - 30 * DAY, now, 30)).toBeCloseTo(0.5)
    expect(timeDecay(now - 60 * DAY, now, 30)).toBeCloseTo(0.25)
  })
})

describe('rankCandidates:阈值过滤 + 双路融合', () => {
  const qvec = vec(1, 0, 0)
  const near = vec(0.99, 0.14, 0) // 与 qvec 高相似(~1)
  const mid = vec(0.8, 0.6, 0) // cosine=0.8
  const far = vec(0, 1, 0) // cosine=0
  const now = 100 * DAY

  it('低于阈值的源被剔除,不进入结果', () => {
    const ranked = rankCandidates(
      [
        { source: mkSource('g1', 'golden', '怎么开发票'), vec: near },
        { source: mkSource('h1', 'history', '无关问题'), vec: far },
      ],
      '怎么开发票',
      qvec,
      { golden: 0.4, history: 0.5 },
      now,
    )
    expect(ranked.map((r) => r.source.id)).toEqual(['g1'])
  })

  it('历史源用 simThreshold,金标准源用 goldenThreshold(更宽)', () => {
    // cosine=0.45:过 golden 0.4,不过 history 0.5
    const v45 = vec(0.45, Math.sqrt(1 - 0.45 * 0.45), 0) // 与 (1,0,0) 点积 = 0.45
    const ranked = rankCandidates(
      [
        { source: mkSource('g2', 'golden', '发票'), vec: v45 },
        { source: mkSource('h2', 'history', '发票'), vec: v45 },
      ],
      '发票',
      qvec,
      { golden: 0.4, history: 0.5 },
      now,
    )
    expect(ranked.map((r) => r.source.id).sort()).toEqual(['g2'])
  })

  it('时间衰减只影响排序不影响阈值(老记录仍可命中)', () => {
    const v = vec(1, 0, 0)
    const ranked = rankCandidates(
      [{ source: mkSource('h-old', 'history', '发票', now - 80 * DAY), vec: v }],
      '发票',
      qvec,
      { golden: 0.4, history: 0.5 },
      now,
    )
    expect(ranked).toHaveLength(1) // cosine=1 过阈值
    expect(ranked[0].cosine).toBeCloseTo(1) // 原始余弦不被衰减污染
  })
})

describe('assembleSuggestions:展开回复/折叠/金标准置顶', () => {
  // 注意:同一条 qa 内部已按 contentHash 幂等(不会存同内容回复),
  // 折叠的现实来源 = 不同 qa 下的相同回复文本 / 金标准与历史同文本。
  const replies = new Map<string, RetReply[]>([
    ['h1', [{ qaId: 'h1', id: 'r1', text: '支持七天无理由', ts: 100 }]],
    ['h2', [{ qaId: 'h2', id: 'r2', text: '支持七天无理由', ts: 200 }]],
  ])
  const sameText = (id: string, cosine: number, rrf: number) => ({
    source: mkSource(id, 'history', '能退吗'),
    cosine,
    rrfScore: rrf,
  })
  const answers = new Map([['g1', '支持七天无理由退货哦']])
  const goldenPriority = true

  it('不同问答下相同回复文本折叠为一条,平分取最新', () => {
    const ranked = [sameText('h1', 0.9, 0.03), sameText('h2', 0.9, 0.02)]
    const out = assembleSuggestions(ranked, { getReplies: (id) => replies.get(id)!, getGoldenAnswer: (id) => answers.get(id)!, goldenPriority, now: 1000 })
    expect(out.filter((s) => s.kind === 'history')).toHaveLength(1)
    expect(out[0].foldCount).toBe(2)
    expect(out[0].replyId).toBe('r2') // 同分取最新 ts
  })

  it('金标准与历史同文本 → 显示金标准并置顶', () => {
    const answers2 = new Map([['g1', '支持七天无理由']])
    const ranked = [sameText('h1', 0.9, 0.03), { source: mkSource('g1', 'golden', '退货政策'), cosine: 0.85, rrfScore: 0.02 }]
    const out = assembleSuggestions(ranked, { getReplies: (id) => replies.get(id)!, getGoldenAnswer: (id) => answers2.get(id)!, goldenPriority, now: 1000 })
    const folded = out.find((s) => (s.foldCount ?? 0) > 1)
    expect(folded?.kind).toBe('golden')
    expect(out[0].kind).toBe('golden')
  })

  it('goldenPriority=false 时按得分排序,金标准不强置顶', () => {
    const ranked = [
      { source: mkSource('h1', 'history', '能退吗'), cosine: 0.95, rrfScore: 0.05 },
      { source: mkSource('g1', 'golden', '退货政策'), cosine: 0.6, rrfScore: 0.01 },
    ]
    const out = assembleSuggestions(ranked, { getReplies: (id) => replies.get(id)!, getGoldenAnswer: (id) => answers.get(id)!, goldenPriority: false, now: 1000 })
    expect(out[0].kind).toBe('history')
  })

  it('无回复的历史问答不产生候选(无正文可填)', () => {
    const ranked = [
      { source: mkSource('h-empty', 'history', '有人吗'), cosine: 0.9, rrfScore: 0.03 },
    ]
    const out = assembleSuggestions(ranked, { getReplies: () => [], getGoldenAnswer: () => '', goldenPriority, now: 1000 })
    expect(out).toHaveLength(0)
  })

  it('maxSuggestions 截断', () => {
    const many: RetReply[] = Array.from({ length: 15 }, (_, i) => ({
      qaId: 'h1', id: `rr${i}`, text: `回复方案${i}号内容`, ts: i,
    }))
    const rep = new Map([['h1', many]])
    const ranked = [{ source: mkSource('h1', 'history', '怎么选'), cosine: 0.9, rrfScore: 0.03 }]
    const out = assembleSuggestions(ranked, { getReplies: (id) => rep.get(id)!, getGoldenAnswer: () => '', goldenPriority, now: 1000, maxSuggestions: 5 })
    expect(out).toHaveLength(5)
  })

  // 2026-09-15:同一问题可挂多条标准回答(上限 3);展示按设置时间倒序
  const multiGolden = new Map([
    ['g-old', '方案甲(最早设置)'],
    ['g-mid', '方案乙(中间设置)'],
    ['g-new', '方案丙(最近设置)'],
  ])
  const gq = '这个支持7天无理由退换吗'

  it('同一问题的多条标准回答全部保留(不被同内容折叠吃掉)', () => {
    const ranked = [
      { source: mkSource('g-old', 'golden', gq, 100), cosine: 0.9, rrfScore: 0.03 },
      { source: mkSource('g-mid', 'golden', gq, 200), cosine: 0.9, rrfScore: 0.03 },
      { source: mkSource('g-new', 'golden', gq, 300), cosine: 0.9, rrfScore: 0.03 },
    ]
    const out = assembleSuggestions(ranked, {
      getReplies: () => [],
      getGoldenAnswer: (id) => multiGolden.get(id)!,
      goldenPriority,
      now: 1000,
    })
    expect(out).toHaveLength(3)
    expect(out.every((s) => s.kind === 'golden')).toBe(true)
  })

  it('同问题的多条标准回答按设置时间倒序:最近设置的靠前', () => {
    // 故意乱序传入,且融合分刻意让老的更高,验证分组内以时间倒序覆盖
    const ranked = [
      { source: mkSource('g-old', 'golden', gq, 100), cosine: 0.9, rrfScore: 0.05 },
      { source: mkSource('g-new', 'golden', gq, 300), cosine: 0.9, rrfScore: 0.01 },
      { source: mkSource('g-mid', 'golden', gq, 200), cosine: 0.9, rrfScore: 0.03 },
    ]
    const out = assembleSuggestions(ranked, {
      getReplies: () => [],
      getGoldenAnswer: (id) => multiGolden.get(id)!,
      goldenPriority,
      now: 1000,
    })
    expect(out.map((s) => s.text)).toEqual([
      '方案丙(最近设置)',
      '方案乙(中间设置)',
      '方案甲(最早设置)',
    ])
  })

  it('多问题的标准回答:组按名次落位,组内仍按时间倒序', () => {
    const ans = new Map([
      ['g-qa-new', 'A 问题新答复'],
      ['g-qa-old', 'A 问题旧答复'],
      ['g-qb', 'B 问题答复'],
    ])
    const ranked = [
      { source: mkSource('g-qb', 'golden', '什么时候发货', 500), cosine: 0.95, rrfScore: 0.09 },
      { source: mkSource('g-qa-old', 'golden', gq, 100), cosine: 0.9, rrfScore: 0.03 },
      { source: mkSource('g-qa-new', 'golden', gq, 300), cosine: 0.9, rrfScore: 0.02 },
    ]
    const out = assembleSuggestions(ranked, {
      getReplies: () => [],
      getGoldenAnswer: (id) => ans.get(id)!,
      goldenPriority,
      now: 1000,
    })
    expect(out.map((s) => s.text)).toEqual(['B 问题答复', 'A 问题新答复', 'A 问题旧答复'])
  })
})

// ─── 知识库源(P4-KB v1)────────────────────────────────────────────────────────

describe('知识库源 knowledge', () => {
  const DAY = 86_400_000
  const now = 100 * DAY
  const qv = vec(1, 0, 0)

  it('知识库阈值走 goldenThreshold(放宽),历史仍走 simThreshold', () => {
    const entries = [
      { source: mkSource('k1', 'knowledge', '发货时间说明'), vec: vec(0.55, 0) },
      { source: mkSource('h1', 'history', '发货时间说明'), vec: vec(0.55, 0) },
    ]
    // 0.55:金标准/知识库门槛 0.4 → 过;历史门槛 0.6 → 滤
    const ranked = rankCandidates(entries, '发货时间', qv, { golden: 0.4, history: 0.6 }, now)
    expect(ranked.map((r) => r.source.id)).toEqual(['k1'])
  })

  it('层级排序:金标准 > 历史 > 知识库(goldenPriority 开)', () => {
    const mkRanked = (id: string, kind: 'golden' | 'knowledge' | 'history') => ({
      source: mkSource(id, kind, `问题-${id}`),
      cosine: 0.9,
      rrfScore: 0.05,
    })
    const out = assembleSuggestions(
      [mkRanked('h1', 'history'), mkRanked('k1', 'knowledge'), mkRanked('g1', 'golden')],
      {
        getReplies: (id) => [{ qaId: id, id: `r-${id}`, text: `文本-${id}`, ts: now }],
        getGoldenAnswer: (id) => `文本-${id}`,
        getKbContent: (id) => `文本-${id}`,
        goldenPriority: true,
        now,
      },
    )
    expect(out.map((s) => s.sourceId)).toEqual(['g1', 'h1', 'k1'])
    expect(out.map((s) => s.kind)).toEqual(['golden', 'history', 'knowledge'])
  })

  it('历史与知识库同分 → 历史置前(打招呼类场景历史更准)', () => {
    const mkRanked = (id: string, kind: 'knowledge' | 'history') => ({
      source: mkSource(id, kind, `问题-${id}`),
      cosine: 0.9,
      rrfScore: 0.05,
    })
    const out = assembleSuggestions(
      [mkRanked('k1', 'knowledge'), mkRanked('h1', 'history')],
      {
        getReplies: (id) => [{ qaId: id, id: `r-${id}`, text: `文本-${id}`, ts: now }],
        getGoldenAnswer: () => '',
        getKbContent: (id) => `文本-${id}`,
        goldenPriority: true,
        now,
      },
    )
    expect(out.map((s) => s.kind)).toEqual(['history', 'knowledge'])
  })

  it('goldenPriority 关闭时不按层级,纯融合分混排', () => {
    const mk = (id: string, kind: 'golden' | 'knowledge' | 'history', rrf: number) => ({
      source: mkSource(id, kind, `问题-${id}`),
      cosine: 0.9,
      rrfScore: rrf,
    })
    const out = assembleSuggestions(
      [mk('g1', 'golden', 0.01), mk('k1', 'knowledge', 0.04), mk('h1', 'history', 0.05)],
      {
        getReplies: (id) => [{ qaId: id, id: `r-${id}`, text: `文本-${id}`, ts: now }],
        getGoldenAnswer: (id) => `文本-${id}`,
        getKbContent: (id) => `文本-${id}`,
        goldenPriority: false,
        now,
      },
    )
    expect(out.map((s) => s.sourceId)).toEqual(['h1', 'k1', 'g1'])
  })

  it('知识库正文为空(未取到)不产生候选', () => {
    const out = assembleSuggestions(
      [{ source: mkSource('k1', 'knowledge', '问题-k1'), cosine: 0.9, rrfScore: 0.05 }],
      {
        getReplies: () => [],
        getGoldenAnswer: () => '',
        getKbContent: () => '',
        goldenPriority: true,
        now,
      },
    )
    expect(out).toHaveLength(0)
  })

  it('知识库与金标准同内容 → 折叠并显示金标准(徽标优先)', () => {
    const out = assembleSuggestions(
      [
        { source: mkSource('k1', 'knowledge', '问题-k'), cosine: 0.9, rrfScore: 0.05 },
        { source: mkSource('g1', 'golden', '问题-g'), cosine: 0.85, rrfScore: 0.04 },
      ],
      {
        getReplies: () => [],
        getGoldenAnswer: () => '同一段话术',
        getKbContent: () => '同一段话术',
        goldenPriority: true,
        now,
      },
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('golden')
    expect(out[0].foldCount).toBe(2)
  })
})
