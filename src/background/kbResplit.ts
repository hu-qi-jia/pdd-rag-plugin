/**
 * 分块器版本迁移:SW 启动时把 splitterVersion 失配的文档按新规则重切重嵌。
 *
 * 背景:knowledge 表只存切好的块,分块规则一变旧块就无法原地修正;kbDocs 存了
 * 原文,使自动重切成为可能 —— 用户不必手动重传文档(升级后旧问答体文档之所以
 * 检索不到,正是因为整篇被切成一块、向量被多主题平均稀释)。
 *
 * 重切后锚文本随之改变,旧向量不可复用 → 新块一律 hasEmbedding=0 交补嵌链路。
 */
import { db } from './db'
import { chunkMarkdown, SPLITTER_VERSION } from '../shared/mdText'
import { kbAnchorText } from './kbAnchor'
import { queueEmbedding } from './offscreen'
import { hashText } from '../shared/text'

/** 返回重切的文档数;无失配文档返回 0 */
export async function resplitStaleKbDocs(): Promise<number> {
  const stale = await db.getStaleKbDocs(SPLITTER_VERSION)
  if (stale.length === 0) return 0

  let done = 0
  for (const doc of stale) {
    const chunks = chunkMarkdown(doc.content)
    if (chunks.length === 0) continue

    const now = Date.now()
    const rootId = `kbd-${now}-${Math.random().toString(36).slice(2, 8)}`
    // 同一小节被拆成多块时,第 2 块起标题加"(续n)"标识同节兄弟块
    const sectionSeq = new Map<string, number>()
    // 嵌入入队延后到事务提交后:失败回滚不得产生孤儿嵌入任务
    const pendingEmbeds: Array<{ id: string; anchor: string }> = []

    // 删旧块 + 写新块 + 更新版本同事务:中途失败时文档保持旧状态,下轮再试
    // (metrics 也要列入:删块会连带清掉这些块的逐条用量键,属同一事务的一部分)
    await db.transaction('rw', db.knowledge, db.kbDocs, db.metrics, async () => {
      await db.deleteKnowledgeByDoc(doc.docId)
      for (let i = 0; i < chunks.length; i++) {
        const id = chunks.length === 1 ? rootId : `${rootId}-c${i}`
        const base = chunks[i].title ? `${doc.docId} · ${chunks[i].title}` : doc.docId
        const seq = sectionSeq.get(base) ?? 0
        sectionSeq.set(base, seq + 1)
        const title = seq === 0 ? base : `${base} (续${seq + 1})`
        await db.addKnowledge({
          id,
          title,
          content: chunks[i].text,
          questionHash: hashText(`${doc.docId}#${i}`),
          hasEmbedding: 0,
          enabled: 1,
          source: 'doc',
          docId: doc.docId,
          chunkKind: chunks[i].kind,
          sectionSeq: chunks[i].sectionSeq,
          createdAt: now,
          updatedAt: now,
        })
        pendingEmbeds.push({
          id,
          anchor: kbAnchorText({ source: 'doc', title, content: chunks[i].text }),
        })
      }
      await db.putKbDoc({
        ...doc,
        splitterVersion: SPLITTER_VERSION,
        chunkCount: chunks.length,
        updatedAt: now,
      })
    })

    for (const p of pendingEmbeds) queueEmbedding('knowledge', p.id, p.anchor)
    done++
  }
  return done
}
