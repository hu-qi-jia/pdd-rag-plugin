/**
 * P4-KB 文档上传端到端合成验收(结构感知分块版,纯数据层,一次性 profile):
 *   上传政策风格 md(标题+小节+列表项)→ chunkMarkdown 按小节切块 →
 *   校验:无 md 标记残留 / 每条列表项完整不被截断 / 标题含小节名 →
 *   逐块向量回填 → 检索命中且填充文本干净 → 文档块拒编辑 → 整篇重传替换 →
 *   导出含 source/docId → 幂等再导入 → 清理。
 * 用法:node scripts/verify-kb-doc.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { launchExtContext, findExtensionId, freshProfile, openPopup, sleep } from './lib.mjs'

// 每次运行独立 temp profile:第 1 步断言「replaced === false」(全新上传),
// 复用同一个目录跑第二遍,上次留下的文档会让它变成 true —— 看起来像功能坏了,
// 其实是脏状态。(原为 persistentProfile('fresh-profile'),与 verify-p3 共用同一目录)
const PROFILE = freshProfile()
const DOC = '售后政策手册'

// ── 政策风格 md:文档标题 + 引言 + 8 个小节(各 3 条列表项,节 ~230 字 ≤500 整节成块)──
const SECTION_TOPICS = [
  ['退换货条件', ['七天无理由退货需保持吊牌完整与包装完好,配件齐全方可办理', '质量问题自签收之日起十五天内可申请退换货', '已激活使用且超出无理由期限的商品不支持无理由退货']],
  ['退回运费', ['质量问题退换货的运费由店家承担', '无理由退货的返程运费由买家自理', '运费险赔付以保险条款为准']],
  ['退款流程', ['买家在订单页发起申请后商家需在四十八小时内处理', '寄回商品验收通过后退款原路返回', '退款进度可在订单详情页实时跟踪']],
  ['维修与保修', ['保修期以商品页标注为准,质量问题优先换新', '人为损坏如进水摔落不在保修范围', '保修期外可提供付费维修服务']],
  ['凭证要求', ['质量问题需提供清晰的照片或视频凭证', '凭证需包含商品问题的完整展示', '无法提供凭证时按人为损坏处理']],
  ['发货时效', ['每日下午四点前下单当天发出', '偏远地区发货时间顺延一天', '预售商品以商品页标注的发货时间为准']],
  ['发票说明', ['支持开具电子发票,请在订单备注中写明抬头与税号', '电子发票在发货后七个工作日内开出', '发票一经开出不支持换开抬头']],
  ['售后时段', ['售后客服在线时间为每日九点至二十一点', '非在线时段留言将在上班后优先处理', '平台介入以双方协商无果为前提']],
]
const bullets = []
const parts = ['# 售后政策', '', '以下规则按拼多多平台常规售后规范执行。', '']
for (const [title, items] of SECTION_TOPICS) {
  parts.push(`## ${title}`, '')
  for (const it of items) {
    parts.push(`- ${it},请以商品详情页的最新说明为准。`, '')
    bullets.push(`${it},请以商品详情页的最新说明为准。`)
  }
}
const MD = parts.join('\n')
const EXPECTED_SECTIONS = SECTION_TOPICS.length + 1 // 8 小节 + 文档标题/引言块
// 无结构长文本兜底用例(回退 chunkText 滑窗)
const PLAIN = Array.from({ length: 1500 }, (_, i) => String(i % 10)).join('')

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
    async ({ type, payload }) => (await chrome.runtime.sendMessage({ type, payload }))?.payload ?? {},
    { type, payload },
  )

// ── 1. 上传 → 按小节分块(9 块:引言 + 8 节)──
const up = await send('UPLOAD_KB_DOC', { name: `${DOC}.md`, content: MD })
check(
  `上传成功且分块数 = ${EXPECTED_SECTIONS}(按小节整块)`,
  up.docId === DOC && up.chunkCount === EXPECTED_SECTIONS && up.replaced === false,
  JSON.stringify(up).slice(0, 160),
)

// ── 2. 块质量:无 md 残留 / 列表项完整 / 标题含小节名 ──
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
const dbChunks = await sw.evaluate(async (docId) => {
  const rows = await globalThis.pddDb.listKnowledgeByDoc(docId)
  return rows
    .map((r) => ({ id: r.id, title: r.title, content: r.content, source: r.source }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh', { numeric: true }))
}, DOC)
const allText = dbChunks.map((c) => c.content).join('\n')
const noMd = dbChunks.every((c) => !c.content.includes('#') && !/^[-*+]\s/m.test(c.content))
const intact = bullets.every((b) => allText.includes(b)) // 每条列表项完整出现
const titlesOk =
  dbChunks.some((c) => c.title === `${DOC} · 售后政策` && c.content.includes('按拼多多平台常规售后规范执行')) && // `#` 一级标题节
  SECTION_TOPICS.every(([t]) => dbChunks.some((c) => c.title === `${DOC} · ${t}`))
check(
  '无 md 标记残留、每条列表项完整、标题含小节名',
  dbChunks.length === EXPECTED_SECTIONS && dbChunks.every((c) => c.source === 'doc') && noMd && intact && titlesOk,
  noMd && intact ? `块数=${dbChunks.length}` : `块数=${dbChunks.length} noMd=${noMd} intact=${intact}`,
)

// ── 3. 逐块向量回填(首跑含模型下载,预算 ~5 分钟)──
let allEmbedded = false
for (let i = 0; i < 100 && !allEmbedded; i++) {
  await sleep(3000)
  const rows = await sw.evaluate(async (docId) => {
    const rows = await globalThis.pddDb.listKnowledgeByDoc(docId)
    return rows.map((r) => r.hasEmbedding)
  }, DOC)
  allEmbedded = rows.length > 0 && rows.every((h) => h === 1)
  if (i === 20) console.log('…模型下载/推理中(20×3s)')
}
check(`${EXPECTED_SECTIONS} 块全部向量回填(hasEmbedding=1)`, allEmbedded)

// ── 4. 检索命中:kind=knowledge,填充文本干净、语义完整、来源显示小节名 ──
const Q = '商品进水摔坏了还能保修吗'
const sug = await send('GET_SUGGESTIONS', { query: Q })
const docIds = new Set(dbChunks.map((c) => c.id))
const hit = (sug.suggestions ?? []).find((s) => docIds.has(s.sourceId))
check(
  '检索命中小节块(kind=knowledge)',
  hit?.kind === 'knowledge' && docIds.has(hit.sourceId),
  hit ? `score=${hit.score.toFixed(2)} src=${hit.sourceQuestion}` : `无候选:${JSON.stringify(sug).slice(0, 140)}`,
)
check(
  '候选填充文本无 md 符号且含完整相关条目',
  !!hit &&
    !hit.text.includes('#') &&
    allText.includes(hit.text) &&
    hit.text.includes('人为损坏如进水摔落不在保修范围'),
  hit ? `text=${hit.text.slice(0, 30)}…` : '',
)

// ── 5. 文档块拒编辑 ──
const edit = await send('UPDATE_KB', { id: dbChunks[0].id, title: '改名' })
check('文档块直接编辑被拒', !!edit.error, edit.error ?? '')

// ── 6. 整篇重传替换(追加一节,不产生重复块)──
const parts2 = [...parts.slice(0, -1), `## 附录\n\n- 退换货全程可在订单页跟踪处理进度。`].join('\n') + '\n'
const up2 = await send('UPLOAD_KB_DOC', { name: `${DOC}.md`, content: parts2 })
const count2 = await sw.evaluate(async (docId) => (await globalThis.pddDb.listKnowledgeByDoc(docId)).length, DOC)
check(
  `重传整篇替换( replaced=true,块数 ${EXPECTED_SECTIONS}→${EXPECTED_SECTIONS + 1},无重复)`,
  up2.replaced === true && up2.chunkCount === EXPECTED_SECTIONS + 1 && count2 === EXPECTED_SECTIONS + 1,
  `replaced=${up2.replaced} chunkCount=${up2.chunkCount} 实际=${count2}`,
)

// ── 7. 无结构纯文本回退滑窗(原项目 chunkText 兜底)──
const up3 = await send('UPLOAD_KB_DOC', { name: `无结构笔记.md`, content: PLAIN })
const plainChunks = await sw.evaluate(async (docId) => {
  const rows = await globalThis.pddDb.listKnowledgeByDoc(docId)
  const ids = rows.map((r) => r.id)
  await globalThis.pddDb.deleteKnowledgeByDoc(docId)
  return ids
}, '无结构笔记')
check(
  '无结构纯文本回退滑窗分块(块数>1)并清理',
  up3.chunkCount === plainChunks.length && up3.chunkCount > 1,
  `chunkCount=${up3.chunkCount}`,
)

// ── 8. 导出含 source/docId(剥向量)→ 幂等再导入 ──
const exp = await send('EXPORT_DATA', { includeMemory: false })
const docKb = (exp.envelope?.knowledge ?? []).filter((k) => k.docId === DOC)
check(
  '导出携带文档块(source=doc、docId、无向量字段)',
  docKb.length === EXPECTED_SECTIONS + 1 && docKb.every((k) => k.source === 'doc' && !('qEmbedding' in k)),
  `knowledge=${exp.envelope?.knowledge?.length}`,
)
const reimp = await send('IMPORT_DATA', { envelope: exp.envelope })
check(
  '原样再导入幂等(块全跳过)',
  (reimp.addedKnowledge ?? 0) === 0 && (reimp.skippedKnowledge ?? 0) >= EXPECTED_SECTIONS + 1,
  JSON.stringify(reimp).slice(0, 180),
)

// ── 9. 清理 ──
const cleaned = await sw.evaluate(async (docId) => globalThis.pddDb.deleteKnowledgeByDoc(docId), DOC)
check('清理:整篇文档块已删除', cleaned === EXPECTED_SECTIONS + 1, `deleted=${cleaned}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n=== KB 文档上传验收:${results.length - failed.length}/${results.length} 通过 ===`)
await ctx.close()
process.exit(failed.length > 0 ? 1 : 0)
