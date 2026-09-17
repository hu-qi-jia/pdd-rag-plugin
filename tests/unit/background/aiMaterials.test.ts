// AI 整合材料组装单测(fake-indexeddb 内存实现)。
// 口径「所见即所发」:材料就是本轮面板展示的知识库候选;唯一例外是 section 型
// 候选要补上同节续块 —— 长节被拆开意味着答案本来就被切断,不接上就是残句。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'

async function fresh() {
  vi.resetModules()
  const mod = await import('../../../src/background/aiMaterials')
  const { db } = await import('../../../src/background/db')
  return { ...mod, db }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

type Kb = Parameters<
  Awaited<ReturnType<typeof fresh>>['db']['addKnowledge']
>[0]

function kb(over: Partial<Kb> & { id: string; title: string; content: string }): Kb {
  return {
    questionHash: over.id,
    hasEmbedding: 1,
    enabled: 1,
    source: 'doc',
    docId: '手册',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('collectMaterials', () => {
  it('qa 型候选答案自足 → 原样一条,不扩展', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'k1', title: '常见问答 · 防水吗？', content: '不防水。', chunkKind: 'qa', sectionSeq: 1 }))
    await db.addKnowledge(kb({ id: 'k2', title: '常见问答 · 充电？', content: '90 分钟。', chunkKind: 'qa', sectionSeq: 1 }))

    const m = await collectMaterials(['k1'])
    expect(m).toEqual(['常见问答 · 防水吗？\n不防水。'])
  })

  it('section 型候选 → 追加同 docId + 同 chunkKind + 同 sectionSeq 的续块', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'r-c0', title: '手册 · 售后 (续1)', content: '第一段', chunkKind: 'section', sectionSeq: 2 }))
    await db.addKnowledge(kb({ id: 'r-c1', title: '手册 · 售后 (续2)', content: '第二段', chunkKind: 'section', sectionSeq: 2 }))
    await db.addKnowledge(kb({ id: 'r-c2', title: '手册 · 售后 (续3)', content: '第三段', chunkKind: 'section', sectionSeq: 2 }))

    const m = await collectMaterials(['r-c1'])
    expect(m).toHaveLength(1)
    // 整节拼回后去掉「(续n)」标记,并按文档内序拼接(不能按 id 字典序,否则 c10 会排到 c2 前)
    expect(m[0]).toBe('手册 · 售后\n第一段\n第二段\n第三段')
  })

  it('同节但 chunkKind 不同 → 不并入', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'a', title: '手册 · 节', content: '节正文', chunkKind: 'section', sectionSeq: 1 }))
    await db.addKnowledge(kb({ id: 'b', title: '手册 · 问题', content: '问答块正文', chunkKind: 'qa', sectionSeq: 1 }))

    const m = await collectMaterials(['a'])
    expect(m).toEqual(['手册 · 节\n节正文'])
  })

  it('不同文档的同名节 → 不并入', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'x', title: '甲 · 节', content: '甲的正文', docId: '甲', chunkKind: 'section', sectionSeq: 1 }))
    await db.addKnowledge(kb({ id: 'y', title: '乙 · 节', content: '乙的正文', docId: '乙', chunkKind: 'section', sectionSeq: 1 }))

    const m = await collectMaterials(['x'])
    expect(m).toEqual(['甲 · 节\n甲的正文'])
  })

  it('手工条目(无 docId)→ 原样一条', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'm1', title: '手工话术', content: '亲,稍等哦', source: 'manual', docId: undefined }))

    const m = await collectMaterials(['m1'])
    expect(m).toEqual(['手工话术\n亲,稍等哦'])
  })

  it('按传入顺序保留候选,并按 id/正文去重', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'k1', title: 'T1', content: 'C1', chunkKind: 'qa' }))
    await db.addKnowledge(kb({ id: 'k2', title: 'T2', content: 'C2', chunkKind: 'qa' }))
    await db.addKnowledge(kb({ id: 'k3', title: 'T3', content: 'C1', chunkKind: 'qa' })) // 正文与 k1 同

    const m = await collectMaterials(['k2', 'k1', 'k3', 'k1'])
    expect(m).toEqual(['T2\nC2', 'T1\nC1'])
  })

  it('面板配额内的知识库候选**全部**并入(top-k=3,不是只发一条)', async () => {
    // 用户口径(第五十轮):「ai整合是根据检索到的 top-k=3 的内容整合,而不是只有一条」。
    // 面板每类候选至多 3 条(retrieval.ts#PANEL_QUOTA.knowledge),内容是这里的入参 ——
    // 三条候选就该产出三份材料,顺序与候选顺序一致,一份都不许被"顺手取第一条"吃掉
    const { collectMaterials, db } = await fresh()
    for (const i of [1, 2, 3]) {
      await db.addKnowledge(
        kb({ id: `k${i}`, title: `T${i}`, content: `C${i}`, chunkKind: 'qa', sectionSeq: i }),
      )
    }
    const m = await collectMaterials(['k1', 'k2', 'k3'])
    expect(m).toHaveLength(3)
    expect(m).toEqual(['T1\nC1', 'T2\nC2', 'T3\nC3'])
  })

  it('停用/不存在的候选跳过', async () => {
    const { collectMaterials, db } = await fresh()
    await db.addKnowledge(kb({ id: 'k1', title: 'T1', content: 'C1', chunkKind: 'qa' }))
    await db.addKnowledge(kb({ id: 'k2', title: 'T2', content: 'C2', chunkKind: 'qa', enabled: 0 }))

    expect(await collectMaterials(['k1', 'k2', 'not-exist'])).toEqual(['T1\nC1'])
  })

  it('总量超 3000 字截断,且不切出半截块(尾部整块丢弃)', async () => {
    const { collectMaterials, db } = await fresh()
    const big1 = '甲'.repeat(2000)
    const big2 = '乙'.repeat(2000)
    await db.addKnowledge(kb({ id: 'k1', title: 'T1', content: big1, chunkKind: 'qa' }))
    await db.addKnowledge(kb({ id: 'k2', title: 'T2', content: big2, chunkKind: 'qa' }))
    await db.addKnowledge(kb({ id: 'k3', title: 'T3', content: '短', chunkKind: 'qa' }))

    const m = await collectMaterials(['k1', 'k2', 'k3'])
    expect(m).toEqual([`T1\n${big1}`]) // 第二块已越界,第三块不做"塞缝"补齐
  })

  it('空输入 / 全被过滤 → 空数组(调用方据此不发起请求)', async () => {
    const { collectMaterials } = await fresh()
    expect(await collectMaterials([])).toEqual([])
    expect(await collectMaterials(['nope'])).toEqual([])
  })
})
