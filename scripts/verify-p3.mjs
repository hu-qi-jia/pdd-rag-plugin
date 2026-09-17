/**
 * P3 端到端合成验收(设计文档 §11 P3 验收链的数据层等价演练):
 *   合成捕获 → 设金(幂等)→ 重嵌 → 检索命中金标准 → 编辑+重嵌 → 检索命中新版 →
 *   仅改答案不重嵌 → 文件夹 CRUD+迁移 → 导出 v2 → 幂等再导入(全跳过)→ 坏版本拒绝 →
 *   FILL_INPUT 无聊天页报错 → 清理测试数据(不污染真实库)。
 * 用法:node scripts/verify-p3.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { launchExtContext, findExtensionId, freshProfile, openPopup, sleep } from './lib.mjs'

// 一次性干净 profile(P1 教训:登录态 profile 对自动化脆弱;P3 验收是纯数据层,无需登录态。
// 代价:首次需下载嵌入模型 ~25MB(hf-mirror),下方重嵌轮询预算已放大)
// 每次运行独立 temp profile:本脚本断言的是"库里原本没有的东西,现在有了"
// (设金幂等 / 改成重复问题应成功 / 导出再导入全跳过),复用同一个目录跑第二遍就会
// 拿上一轮的残留当失败 —— 报出来像功能坏了,其实只是脏状态。
// (原为 persistentProfile('fresh-profile'),与 verify-kb-doc 共用同一目录,互相污染)
const PROFILE = freshProfile()
const SESS = 'p3-verify'

const ctx = await launchExtContext(PROFILE)
await sleep(5000)
const extId = await findExtensionId(ctx)
if (!extId) {
  console.log('FAIL: 扩展未加载')
  await ctx.close()
  process.exit(1)
}

// 仅登录态 profile 需要 reload 击穿陈旧 SW 缓存;一次性 profile 无此问题
const beforeSw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
if (process.env.PDDCS_PROFILE === 'login' && beforeSw) {
  await beforeSw.evaluate(() => chrome.runtime.reload())
  await sleep(4000)
  for (let i = 0; i < 10; i++) {
    const fresh = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
    if (fresh && fresh !== beforeSw) break
    await sleep(1000)
  }
  console.log('SW 已强制 reload(击穿陈旧脚本缓存)')
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

// ── 1. 合成捕获:问答入库 ──
const ingest = await send('PDD_INGEST', {
  events: [
    {
      kind: 'msg',
      sessionKey: SESS,
      msg: { source: 'dom', role: 'buyer', text: 'P3验收:这款手机壳支持iPhone14吗?支持7天无理由退换吗?', msgId: 'p3-b1', ts: Date.now() - 60_000 },
    },
    {
      kind: 'msg',
      sessionKey: SESS,
      msg: { source: 'dom', role: 'agent', text: 'P3历史回复v1:支持iPhone14全系,7天无理由退换,请放心。', msgId: 'p3-a1', ts: Date.now() },
    },
    { kind: 'leave', sessionKey: SESS },
  ],
})
await sleep(1500)
const mem = await send('GET_MEMORY_LIST')
const qaItem = (mem.items ?? []).find((x) => x.question.includes('P3验收'))
if (!qaItem) console.log('GET_MEMORY_LIST 原始响应(取证):', JSON.stringify(mem).slice(0, 300))
check(
  '合成捕获 → 记忆列表出现问答',
  !!qaItem && qaItem.replies.length === 1,
  qaItem ? `回复 ${qaItem.replies.length} 条` : JSON.stringify(ingest),
)

if (!qaItem) {
  console.log('无法继续:合成问答未入库')
  await ctx.close()
  process.exit(1)
}

// ── 2. 设金 + 幂等 ──
const GOLD_Q = 'P3验收:这款手机壳支持iPhone14吗?支持7天无理由退换吗?'
const GOLD_A1 = 'P3金标准回复v1:支持iPhone14全系,7天无理由退换,请放心。'
const add1 = await send('ADD_GOLDEN', {
  question: GOLD_Q,
  answer: GOLD_A1,
  sourceRecordId: qaItem.id,
  sourceReplyId: qaItem.replies[0].id,
})
check('设金成功(返回 id)', !!add1.id && !add1.exists, `id=${add1.id}`)
const add2 = await send('ADD_GOLDEN', { question: GOLD_Q, answer: GOLD_A1 })
check('重复设金幂等(exists)', add2.exists === true, `id=${add2.id}`)
const goldenId = add1.id

// ── 3. 重嵌(首次含模型下载,预算 ~5 分钟)→ 检索命中金标准 ──
let embedded = false
for (let i = 0; i < 100 && !embedded; i++) {
  await sleep(3000)
  const panel = await send('GET_PANEL_DATA')
  const g = (panel.goldens ?? []).find((x) => x.id === goldenId)
  embedded = g?.hasEmbedding === 1
  if (i === 20) console.log('…模型下载/推理中(20×3s)')
}
check('金标准向量回填(hasEmbedding=1)', embedded)

const sug1 = await send('GET_SUGGESTIONS', { query: '这款手机壳支持iPhone14吗' })
const top1 = (sug1.suggestions ?? [])[0]
check(
  '检索命中金标准(置顶)',
  top1?.kind === 'golden' && top1.text === GOLD_A1,
  top1 ? `kind=${top1.kind} score=${top1.score.toFixed(2)}` : '无候选',
)

// ── 4. 编辑(问题+答案)→ 重嵌 → 检索命中新版 ──
const GOLD_Q2 = 'P3验收:这款手机壳能支持iPhone15吗?'
const GOLD_A2 = 'P3金标准回复v2:支持iPhone15全系,7天无理由退换。'
const up1 = await send('UPDATE_GOLDEN', {
  id: goldenId,
  question: GOLD_Q2,
  answer: GOLD_A2,
})
check('编辑保存触发重嵌(reembed=true)', up1.reembed === true, JSON.stringify(up1))
embedded = false
for (let i = 0; i < 60 && !embedded; i++) {
  await sleep(3000)
  const panel = await send('GET_PANEL_DATA')
  embedded = (panel.goldens ?? []).find((x) => x.id === goldenId)?.hasEmbedding === 1
}
check('编辑后向量再次回填', embedded)
const sug2 = await send('GET_SUGGESTIONS', { query: '这款手机壳能支持iPhone15吗' })
const top2 = (sug2.suggestions ?? [])[0]
check(
  '检索命中新版金标准',
  top2?.kind === 'golden' && top2.text === GOLD_A2,
  top2 ? `text=${top2.text.slice(0, 24)}…` : '无候选',
)

// ── 5. 仅改答案 → 不重嵌 ──
const up2 = await send('UPDATE_GOLDEN', { id: goldenId, answer: GOLD_A2 + '(微调)' })
check('仅改答案不重嵌(reembed=false)', up2.reembed === false)
const dupEdit = await send('UPDATE_GOLDEN', { id: goldenId, question: '支持7天无理由退换吗,这款?' })
check('改成与历史重复问题被拒?否——历史问答不算金标准冲突,应成功', dupEdit.id === goldenId, JSON.stringify(dupEdit))
const emptyEdit = await send('UPDATE_GOLDEN', { id: goldenId, question: '   ' })
check('空问题编辑被拒', !!emptyEdit.error, emptyEdit.error ?? '')

// ── 6. 文件夹 CRUD + 迁移 ──
const folder = await send('CREATE_FOLDER', { name: 'P3验收夹', parentId: null })
check('新建根文件夹', !!folder.id, `id=${folder.id}`)
const sub = await send('CREATE_FOLDER', { name: 'P3验收子夹', parentId: folder.id })
check('新建子文件夹', !!sub.id)
const deep = await send('CREATE_FOLDER', { name: '三层夹', parentId: sub.id })
check('三层被拒(最多两层)', !!deep.error, deep.error ?? '')
const moved = await send('UPDATE_GOLDEN', { id: goldenId, folderId: folder.id })
const panelAfter = await send('GET_PANEL_DATA')
const gAfter = (panelAfter.goldens ?? []).find((x) => x.id === goldenId)
check('金标准迁移到新文件夹', moved.id === goldenId && gAfter?.folderId === folder.id, `folderId=${gAfter?.folderId}`)

// ── 7. 导出 v2 + 幂等再导入 + 坏版本拒绝 ──
const exp = await send('EXPORT_DATA', { includeMemory: true })
const env = exp.envelope
check(
  '导出信封 v2(金标准/文件夹/问答齐全)',
  env?.version === '2.0' &&
    (env.goldens ?? []).some((g) => g.id === goldenId) &&
    (env.folders ?? []).some((f) => f.id === folder.id) &&
    (env.qaRecords ?? []).some((q) => q.sessionKey === SESS),
  `goldens=${env?.goldens?.length} folders=${env?.folders?.length} qa=${env?.qaRecords?.length}`,
)
check('导出已剥离向量', !('qEmbedding' in (env?.goldens?.[0] ?? {})))
const reimp = await send('IMPORT_DATA', { envelope: env })
check(
  '原样再导入幂等(全跳过)',
  (reimp.addedGoldens ?? 0) === 0 &&
    (reimp.addedQa ?? 0) === 0 &&
    (reimp.skippedGoldens ?? 0) >= 1,
  JSON.stringify(reimp),
)
const badImp = await send('IMPORT_DATA', { envelope: { version: '1.0', goldens: [] } })
check('坏版本拒绝导入', !!badImp.error, badImp.error ?? '')

// ── 8. FILL_INPUT:无聊天页时报错(不自动发送的一部分保证)──
const fill = await send('FILL_INPUT', { text: 'test' })
check('无聊天页时 FILL_INPUT 明确报错', fill.success === false && /聊天页/.test(fill.error ?? ''), fill.error ?? '')

// ── 9. 清理测试数据(不污染真实库)──
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
const cleaned = await sw.evaluate(async (sess) => {
  const dbh = globalThis.pddDb
  const qaIds = await dbh.qaRecords.where('sessionKey').equals(sess).primaryKeys()
  await dbh.replies.where('qaId').anyOf(qaIds).delete()
  await dbh.qaRecords.bulkDelete(qaIds)
  return qaIds.length
}, SESS)
await send('DELETE_GOLDEN', { id: goldenId })
if (sub.id) await send('DELETE_FOLDER', { id: sub.id })
if (folder.id) await send('DELETE_FOLDER', { id: folder.id })
check('清理:测试问答/金标准/文件夹已删除', cleaned === 1, `qa=${cleaned}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n=== P3 合成验收:${results.length - failed.length}/${results.length} 通过 ===`)
await ctx.close()
process.exit(failed.length > 0 ? 1 : 0)
