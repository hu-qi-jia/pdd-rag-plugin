/**
 * P4-KB 知识库 v1 端到端合成验收(纯数据层,一次性 profile):
 *   新建(幂等)→ 向量回填 → 检索命中 knowledge → 编辑标题重嵌 → 命中新版 →
 *   仅改正文不重嵌 → 空标题拒 → 停用不参与检索/启用恢复 → 层级 金标准>知识库 →
 *   导出携带 knowledge(剥向量)→ 幂等再导入 → 删除 → 清理。
 * 用法:node scripts/verify-kb.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { launchExtContext, findExtensionId, openPopup, persistentProfile, sleep } from './lib.mjs'

const PROFILE = persistentProfile('fresh-profile')

const ctx = await launchExtContext(PROFILE)
await sleep(5000)
const extId = await findExtensionId(ctx)
if (!extId) {
  console.log('FAIL: 扩展未加载')
  await ctx.close()
  process.exit(1)
}

const pop = await openPopup(ctx, extId)
if (!pop) {
  console.log('FAIL: popup 打不开')
  await ctx.close()
  process.exit(1)
}
await sleep(1500)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const send = (type, payload) =>
  pop.evaluate(
    async ({ type, payload }) => {
      const resp = await chrome.runtime.sendMessage({ type, payload })
      return resp?.payload ?? {}
    },
    { type, payload },
  )

// ── 1. 新建知识条目 + 幂等 ──
const TITLE = 'KB验收:7天无理由退货政策说明'
const CONTENT = 'KB正文v1:签收后7天内可申请无理由退货,需保持商品完好,邮费自理。'
const c1 = await send('CREATE_KB', { title: TITLE, content: CONTENT })
check('新建知识条目(返回 id)', !!c1.id && !c1.exists, `id=${c1.id}`)
const c2 = await send('CREATE_KB', { title: TITLE, content: CONTENT })
check('重复新建幂等(exists)', c2.exists === true, `id=${c2.id}`)
const kbId = c1.id
if (!kbId) {
  console.log('无法继续:知识条目未入库')
  await ctx.close()
  process.exit(1)
}

// ── 2. 向量回填(首次含模型下载,预算 ~5 分钟)→ 检索命中 knowledge ──
let embedded = false
for (let i = 0; i < 100 && !embedded; i++) {
  await sleep(3000)
  const panel = await send('GET_PANEL_DATA')
  embedded = (panel.knowledge ?? []).find((x) => x.id === kbId)?.hasEmbedding === 1
  if (i === 20) console.log('…模型下载/推理中(20×3s)')
}
check('知识条目向量回填(hasEmbedding=1)', embedded)

const sug1 = await send('GET_SUGGESTIONS', { query: '7天无理由退货政策' })
const kbHit = (sug1.suggestions ?? []).find((s) => s.sourceId === kbId)
check(
  '检索命中知识库(kind=knowledge)',
  kbHit?.kind === 'knowledge' && kbHit.text === CONTENT,
  kbHit ? `kind=${kbHit.kind} score=${kbHit.score.toFixed(2)}` : `无候选:${JSON.stringify(sug1).slice(0, 160)}`,
)

// ── 3. 编辑标题 → 重嵌 → 命中新版;仅改正文 → 不重嵌 ──
const TITLE2 = 'KB验收:15天无理由退货政策说明'
const up1 = await send('UPDATE_KB', { id: kbId, title: TITLE2 })
check('改标题触发重嵌(reembed=true)', up1.reembed === true, JSON.stringify(up1))
embedded = false
for (let i = 0; i < 60 && !embedded; i++) {
  await sleep(3000)
  const panel = await send('GET_PANEL_DATA')
  embedded = (panel.knowledge ?? []).find((x) => x.id === kbId)?.hasEmbedding === 1
}
check('改标题后向量再次回填', embedded)
const sug2 = await send('GET_SUGGESTIONS', { query: '15天无理由退货政策' })
const kbHit2 = (sug2.suggestions ?? []).find((s) => s.sourceId === kbId)
check('检索命中新版标题', kbHit2?.kind === 'knowledge', kbHit2 ? `score=${kbHit2.score.toFixed(2)}` : '无候选')

const up2 = await send('UPDATE_KB', { id: kbId, content: 'KB正文v2:签收后15天内可申请无理由退货。' })
check('仅改正文不重嵌(reembed=false)', up2.reembed === false)
const emptyEdit = await send('UPDATE_KB', { id: kbId, title: '   ' })
check('空标题编辑被拒', !!emptyEdit.error, emptyEdit.error ?? '')

// ── 4. 停用 → 不参与检索;启用 → 恢复 ──
const dis = await send('UPDATE_KB', { id: kbId, enabled: 0 })
check('停用成功且不重嵌', dis.id === kbId && dis.reembed === false)
await sleep(500)
const sug3 = await send('GET_SUGGESTIONS', { query: '15天无理由退货政策' })
check('停用后检索不再命中', !(sug3.suggestions ?? []).some((s) => s.sourceId === kbId))
await send('UPDATE_KB', { id: kbId, enabled: 1 })
await sleep(500)
const sug4 = await send('GET_SUGGESTIONS', { query: '15天无理由退货政策' })
check('重新启用后恢复命中', (sug4.suggestions ?? []).some((s) => s.sourceId === kbId))

// ── 5. 层级:金标准 > 知识库(goldenPriority 默认开)──
const GOLD_Q = TITLE2 // 同锚文本 → 余弦同为 ~1,纯看层级
const GOLD_A = '金标准回复:15天无理由退货,请放心。'
const g1 = await send('ADD_GOLDEN', { question: GOLD_Q, answer: GOLD_A })
check('建同锚金标准', !!g1.id, `id=${g1.id}`)
let gEmbedded = false
for (let i = 0; i < 60 && !gEmbedded; i++) {
  await sleep(3000)
  const panel = await send('GET_PANEL_DATA')
  gEmbedded = (panel.goldens ?? []).find((x) => x.id === g1.id)?.hasEmbedding === 1
}
check('金标准向量回填', gEmbedded)
const sug5 = await send('GET_SUGGESTIONS', { query: '15天无理由退货政策' })
const kinds = (sug5.suggestions ?? []).filter((s) => s.sourceId === kbId || s.sourceId === g1.id).map((s) => s.kind)
check('层级排序 金标准>知识库', JSON.stringify(kinds) === JSON.stringify(['golden', 'knowledge']), `kinds=${JSON.stringify(kinds)}`)

// ── 6. 导出携带 knowledge(剥向量)→ 幂等再导入 ──
const exp = await send('EXPORT_DATA', { includeMemory: false })
const env = exp.envelope
const exportedKb = (env?.knowledge ?? []).find((k) => k.id === kbId)
check(
  '导出信封携带 knowledge(剥向量、enabled 保留)',
  !!exportedKb && !('qEmbedding' in exportedKb) && exportedKb.enabled === 1,
  `knowledge=${env?.knowledge?.length}`,
)
const reimp = await send('IMPORT_DATA', { envelope: env })
check(
  '原样再导入幂等(知识库全跳过)',
  (reimp.addedKnowledge ?? 0) === 0 && (reimp.skippedKnowledge ?? 0) >= 1,
  JSON.stringify(reimp).slice(0, 200),
)

// ── 7. 删除 → 检索不再命中 → 清理 ──
const del = await send('DELETE_KB', { id: kbId })
check('删除知识条目', del.success === true)
await sleep(500)
const sug6 = await send('GET_SUGGESTIONS', { query: '15天无理由退货政策' })
check('删除后检索不再命中', !(sug6.suggestions ?? []).some((s) => s.sourceId === kbId))
if (g1.id) await send('DELETE_GOLDEN', { id: g1.id })

const failed = results.filter((r) => !r.ok)
console.log(`\n=== KB 合成验收:${results.length - failed.length}/${results.length} 通过 ===`)
await ctx.close()
process.exit(failed.length > 0 ? 1 : 0)
