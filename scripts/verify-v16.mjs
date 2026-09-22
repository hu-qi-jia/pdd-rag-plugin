/**
 * v0.16 端到端验收(纯数据层,无截图/无弹窗):
 *
 *   A 度量埋点 —— 白名单拒收未知键 / 检索次数与未命中如实计数 / 逐条用量锚到条目 /
 *                重置只清统计不动业务数据 / 写计数不破坏检索缓存
 *   B 待沉淀清单 —— 高频未沉淀的上榜、已有标准回答·无回复·已忽略·自检的不上榜、
 *                 一键提升后自动下榜
 *   C 导出补 kbDocs —— 原文与块元字段随导出外发、导入按 docId 幂等、
 *                     删块后孤儿原文清理、splitterVersion 带出后 SW 启动自动重切
 *
 * 用法:node scripts/verify-v16.mjs
 */
import {
  launchExtContext,
  findExtensionId,
  freshProfile,
  openPopup,
  sleep,
} from './lib.mjs'

const PROFILE = freshProfile()
const DOC = 'v16售后手册'
const SESS = 'v16-e2e-sess'

// 结构感知分块的输入:两个小节 + 问答体小节(才能覆盖 section 与 qa 两种块类型)
const MD = [
  '# 售后手册',
  '',
  '本手册用于 v0.16 验收。',
  '',
  '## 退货条件',
  '',
  '- 七天无理由退货需保持吊牌完整与包装完好,配件齐全方可办理',
  '- 质量问题自签收之日起十五天内可申请退换货',
  '',
  '## 运费承担',
  '',
  '- 质量问题退换货的运费由店家承担',
  '- 无理由退货的返程运费由买家自理',
  '',
  '## 常见问答',
  '',
  'Q:能开发票吗',
  'A:支持开具电子发票,请在订单备注中写明抬头与税号',
  '',
  'Q:什么时候发货',
  'A:每日下午四点前下单当天发出,偏远地区顺延一天',
  '',
].join('\n')

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
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
/** 直接读 SW 内的库:验收看的是"库里到底落了什么",不是消息回什么 */
const swEval = (fn, arg) => sw.evaluate(fn, arg)
const metricsOf = async () => {
  const rows = await swEval(async () => globalThis.pddDb.listMetrics())
  return Object.fromEntries(rows.map((r) => [r.key, r.count]))
}

// ══ A 度量埋点 ══════════════════════════════════════════════════════════════════

const okTrack = await send('TRACK_EVENT', {
  event: 'fill.golden',
  itemKind: 'golden',
  itemId: 'g-v16',
})
const m1 = await metricsOf()
check(
  '上报填充事件:计入类别键 + 逐条用量键',
  okTrack.success === true && m1['fill.golden'] === 1 && m1['item.golden:g-v16'] === 1,
  `success=${okTrack.success} metrics=${JSON.stringify(m1)}`,
)

// 跨上下文来的裸数据:类型系统管不着,必须在运行时当场拒收
const badEvent = await send('TRACK_EVENT', { event: 'evil.key' })
const m2 = await metricsOf()
check(
  '白名单拒收未知事件键(不落库、不报错)',
  badEvent.success === false && !('evil.key' in m2) && Object.keys(m2).length === Object.keys(m1).length,
  `success=${badEvent.success} error=${badEvent.error ?? ''}`,
)

// 历史候选会过期,给它记逐条用量只会攒孤儿键 —— 非 golden/knowledge 的 itemKind 一律不锚
const histTrack = await send('TRACK_EVENT', { event: 'fill.history', itemKind: 'history', itemId: 'q-1' })
const m3 = await metricsOf()
check(
  '非长驻条目(history)不记逐条用量,只记类别',
  histTrack.success === true && m3['fill.history'] === 1 && !('item.history:q-1' in m3),
  JSON.stringify(m3),
)

// 检索记账走真实链路:一次命中 + 一次落空
await send('ADD_GOLDEN', { question: '能开发票吗', answer: '支持开具电子发票,请在订单备注中写明抬头与税号' })
await sleep(2000)
const hit = await send('GET_SUGGESTIONS', { query: '能开发票吗' })
await sleep(500)
const beforeMiss = await metricsOf()
const miss = await send('GET_SUGGESTIONS', { query: 'zzz这个词在库里根本不存在zzz' })
await sleep(500)
const m4 = await metricsOf()
check(
  '检索计数:命中计次、落空另有未命中',
  (beforeMiss['search.total'] ?? 0) >= 1 &&
    hit.suggestions.length > 0 &&
    miss.suggestions.length === 0 &&
    m4['search.total'] === (beforeMiss['search.total'] ?? 0) + 1 &&
    m4['search.miss'] === (beforeMiss['search.miss'] ?? 0) + 1,
  `hit=${hit.suggestions.length} miss=${miss.suggestions.length} total ${beforeMiss['search.total']}→${m4['search.total']} miss→${m4['search.miss']}`,
)

const stats = await send('GET_STATS')
check(
  '统计快照随 GET_STATS 一起回(弹窗不额外跑一趟)',
  typeof stats.metrics === 'object' && (stats.metrics['search.total'] ?? 0) >= 1,
  `metrics=${JSON.stringify(stats.metrics).slice(0, 160)}`,
)

const goldenBefore = (await send('GET_PANEL_DATA')).goldens.length
const cleared = await send('CLEAR_METRICS')
const m5 = await metricsOf()
const goldenAfter = (await send('GET_PANEL_DATA')).goldens.length
check(
  '重置统计:计数清空、业务数据分毫未动',
  cleared.success === true && cleared.cleared > 0 && Object.keys(m5).length === 0 && goldenAfter === goldenBefore,
  `cleared=${cleared.cleared} 金标准 ${goldenBefore}→${goldenAfter}`,
)

// ══ B 待沉淀清单 ═════════════════════════════════════════════════════════════════

// 清单按 qaRecords.questionHash 分组,而"提升为标准回答"用的是 ADD_GOLDEN ——
// 两边必须是同一套归一化哈希,提升后才会自动下榜。所以样本哈希不能自己编一个:
// 借一次"建了再删"的标准回答把真哈希取出来,验的才是真链路。
const exported0 = await send('EXPORT_DATA', { includeMemory: false })
const seededGoldenHash = (exported0.envelope?.goldens ?? []).find((g) => g.question === '能开发票吗')?.questionHash

const learnHash = async (question) => {
  const added = await send('ADD_GOLDEN', { question, answer: '（取样占位,随即删除）' })
  const env = await send('EXPORT_DATA', { includeMemory: false })
  const hash = (env.envelope?.goldens ?? []).find((g) => g.id === added.id)?.questionHash
  await send('DELETE_GOLDEN', { id: added.id })
  return hash
}
const HX = await learnHash('发票怎么开') // 被问 2 次、无标准回答、有回复 → 该上榜
const HZ = await learnHash('支持换货吗') // 会被「不再提示」忽略 → 该下榜
const HY = 'v16-backlog-hy' // 有问答记录但一条回复都没有 → 不该上榜
check(
  '取到真实问题哈希(清单分组与提升走同一套归一化口径)',
  Boolean(HX) && Boolean(HZ) && Boolean(seededGoldenHash),
  `HX=${HX} HZ=${HZ} 已有标准回答的=${seededGoldenHash}`,
)
// 取样用的占位金标准必须已删,否则 HX/HZ 会被"已有标准回答"这一条排除,样本就废了
const leftover = (await send('GET_PANEL_DATA')).goldens.map((g) => g.question)
check(
  '取样占位标准回答已删除(不污染样本)',
  !leftover.includes('发票怎么开') && !leftover.includes('支持换货吗') && leftover.length === 1,
  JSON.stringify(leftover),
)

const now = Date.now()
const qaRow = (id, questionHash, question, questionTs) => ({
  id,
  sessionKey: SESS,
  question,
  questionHash,
  questionTs,
  hasEmbedding: 0,
  replyCount: 1,
  createdAt: questionTs,
  updatedAt: questionTs,
})
const seed = {
  version: '2.0',
  exportedAt: now,
  settings: exported0.envelope?.settings,
  folders: [],
  goldens: [],
  knowledge: [],
  kbDocs: [],
  qaRecords: [
    // 同一问法的两次出现:哈希相同(首尾空白被归一化折叠)但原始文本不同,
    // 代表问题原文应取更近那一条 —— 顺带把"归一化到什么程度"钉在真库上
    qaRow('qa-a', HX, '发票怎么开', now - 30_000),
    qaRow('qa-b', HX, ' 发票怎么开 ', now - 10_000),
    qaRow('qa-c', seededGoldenHash, '能开发票吗', now - 20_000), // 已有标准回答 → 不该上榜
    qaRow('qa-d', HY, '什么时候补货', now - 5_000), // 无回复 → 不该上榜
    qaRow('qa-e', HZ, '支持换货吗', now - 40_000),
  ],
  replies: [
    // 同一条话术被回了两遍:contentHash 相同(它就是内容的哈希)→ 只该留一条
    { id: 'rp-a1', qaId: 'qa-a', text: '在订单备注写抬头与税号即可', contentHash: 'ch-same', ts: now - 29_000, hasEmbedding: 0 },
    { id: 'rp-a2', qaId: 'qa-b', text: '在订单备注写抬头与税号即可', contentHash: 'ch-same', ts: now - 9_000, hasEmbedding: 0 },
    { id: 'rp-a3', qaId: 'qa-b', text: '支持开具电子发票,发货后七个工作日内开出', contentHash: 'ch-a3', ts: now - 8_000, hasEmbedding: 0 },
    { id: 'rp-c1', qaId: 'qa-c', text: '支持开具电子发票', contentHash: 'ch-c1', ts: now - 19_000, hasEmbedding: 0 },
    { id: 'rp-e1', qaId: 'qa-e', text: '支持七天无理由换货', contentHash: 'ch-e1', ts: now - 39_000, hasEmbedding: 0 },
  ],
}
const seeded = await send('IMPORT_DATA', { envelope: seed })
check(
  '播撒历史问答(2 条回复 / 无回复 / 已有标准回答 / 待忽略 各一组)',
  (seeded.addedQa ?? 0) === 5 && (seeded.addedReplies ?? 0) === 5,
  JSON.stringify(seeded).slice(0, 160),
)

const bl1 = await send('GET_BACKLOG')
const item = bl1.items.find((i) => i.questionHash === HX)
const hashes1 = bl1.items.map((i) => i.questionHash)
check(
  '上榜口径:高频无标准回答的进,已有标准回答/无回复的不进',
  bl1.total === 2 &&
    hashes1.includes(HX) &&
    hashes1.includes(HZ) &&
    !hashes1.includes(seededGoldenHash) &&
    !hashes1.includes(HY),
  `total=${bl1.total} hashes=${JSON.stringify(hashes1)}`,
)
check(
  '同问法的多次出现合成一条,代表问题原文取最近一次',
  item?.count === 2 && item?.question === ' 发票怎么开 ' && item?.lastTs === now - 10_000,
  `count=${item?.count} question=${JSON.stringify(item?.question)} lastTs=${item?.lastTs - (now - 10_000)}`,
)
check(
  '回复候选:按内容去重(同话术只留一条)且最近优先',
  item?.replies.length === 2 &&
    item.replies[0].text === '支持开具电子发票,发货后七个工作日内开出' &&
    item.replies[1].text === '在订单备注写抬头与税号即可',
  JSON.stringify(item?.replies?.map((r) => r.text)),
)
check(
  '排序:出现次数倒序(同次数并列时按最近出现时间)',
  bl1.items[0].questionHash === HX && bl1.items[0].count === 2,
  bl1.items.map((i) => `${i.questionHash}:${i.count}`).join(','),
)
check(
  '回复候选带回所属问答记录 id(提升时可溯源)',
  item?.replies.every((r) => r.qaId === 'qa-a' || r.qaId === 'qa-b') === true,
  JSON.stringify(item?.replies?.map((r) => r.qaId)),
)

// 「不再提示」
await send('IGNORE_BACKLOG', { questionHash: HZ, question: '支持换货吗' })
const bl2 = await send('GET_BACKLOG')
check(
  '「不再提示」后该问题下榜,其余不受影响',
  bl2.total === 1 && !bl2.items.some((i) => i.questionHash === HZ) && bl2.items[0].questionHash === HX,
  `total=${bl2.total}`,
)
// 忽略是持久化的,不是内存里的一次性过滤
const ignoredInDb = await swEval(async () => (await globalThis.pddDb.listBacklogIgnores()).length)
check('忽略项落库(下次开面板仍然不提示)', ignoredInDb === 1, `rows=${ignoredInDb}`)

// 一键提升:用清单里的回复直接建标准回答(带溯源),建完该问题应自动下榜
const replyText = item.replies[0].text
const promoted = await send('ADD_GOLDEN', {
  question: item.question,
  answer: replyText,
  sourceRecordId: item.replies[0].qaId,
  sourceReplyId: item.replies[0].id,
})
const bl3 = await send('GET_BACKLOG')
check(
  '一键提升为标准回答 → 该问题随即下榜(不再重复打扰)',
  Boolean(promoted.id) && bl3.total === 0 && bl3.items.length === 0,
  `id=${promoted.id} total=${bl3.total}`,
)
// 提升后仍可从记忆页看到溯源
const exported1 = await send('EXPORT_DATA', { includeMemory: false })
const promotedGolden = (exported1.envelope?.goldens ?? []).find((g) => g.id === promoted.id)
check(
  '提升落到同一个问题组(哈希一致)—— 这正是它随即下榜的原因,不是两套口径各算各的',
  promotedGolden?.questionHash === HX,
  `goldenHash=${promotedGolden?.questionHash} 清单Hash=${HX}`,
)
check(
  '提升出来的标准回答带来源溯源(sourceReplyId / sourceRecordId)',
  promotedGolden?.sourceReplyId === item.replies[0].id && promotedGolden?.sourceRecordId === item.replies[0].qaId,
  `sourceReplyId=${promotedGolden?.sourceReplyId ?? '(缺)'} sourceRecordId=${promotedGolden?.sourceRecordId ?? '(缺)'}`,
)

// ══ C 导出补 kbDocs / 块元字段 ═══════════════════════════════════════════════════

const up = await send('UPLOAD_KB_DOC', { name: `${DOC}.md`, content: MD })
check('上传 md 文档(结构感知分块)', (up.chunkCount ?? 0) > 2, `chunkCount=${up.chunkCount}`)

const exp = await send('EXPORT_DATA', { includeMemory: true })
const env = exp.envelope ?? {}
const docRow = (env.kbDocs ?? []).find((d) => d.docId === DOC)
check(
  // 上传时首尾空白被 trim(与库里那份一致),逐字节比对的基准也得是 trim 后的
  '导出携带文档原文(内容原样、分块器版本非空)',
  docRow?.content === MD.trim() && Boolean(docRow?.splitterVersion) && docRow?.chunkCount === up.chunkCount,
  `kbDocs=${env.kbDocs?.length} version=${docRow?.splitterVersion} contentLen=${docRow?.content?.length}/${MD.trim().length}`,
)
const docChunks = (env.knowledge ?? []).filter((k) => k.docId === DOC)
check(
  '导出携带块元字段 chunkKind / sectionSeq(否则导入后无从判断这段怎么切出来的)',
  docChunks.length === up.chunkCount &&
    docChunks.every((k) => k.chunkKind === 'qa' || k.chunkKind === 'section') &&
    docChunks.every((k) => typeof k.sectionSeq === 'number') &&
    docChunks.some((k) => k.chunkKind === 'qa') &&
    docChunks.some((k) => k.chunkKind === 'section'),
  `chunks=${docChunks.length} kinds=${JSON.stringify([...new Set(docChunks.map((k) => k.chunkKind))])}`,
)
check(
  '导出仍剥向量(信封不因新增字段而夹带 Float32Array)',
  docChunks.every((k) => !('qEmbedding' in k)) && docRow && !('qEmbedding' in docRow),
  '',
)

// 幂等:同一份包再导入,块与原文都按既有键跳过(不覆盖本地)
const reimp = await send('IMPORT_DATA', { envelope: env })
check(
  '原样再导入幂等:块与原文全跳过',
  (reimp.addedKbDocs ?? 0) === 0 && (reimp.skippedKbDocs ?? 0) >= 1 && (reimp.addedKnowledge ?? 0) === 0,
  JSON.stringify(reimp).slice(0, 180),
)

/** 走用户路径整篇删除:逐块 DELETE_KB(最后一块删掉时孤儿原文应一并清理) */
const purge = async () => {
  const chunkIds = ((await send('EXPORT_DATA', { includeMemory: false })).envelope?.knowledge ?? [])
    .filter((k) => k.docId === DOC)
    .map((k) => k.id)
  for (const id of chunkIds) await send('DELETE_KB', { id })
  const left = await swEval(
    async (docId) => ({
      chunks: (await globalThis.pddDb.listKnowledgeByDoc(docId)).length,
      kbDoc: (await globalThis.pddDb.getKbDoc(docId)) === undefined ? null : '仍在',
    }),
    DOC,
  )
  return { deleted: chunkIds.length, ...left }
}

// 「新机器」路径:把本篇全部块删干净,再导入同一信封 ——
// 这正是旧版导出的缺口:块回来了,原文没回来,于是无从重切。
const purged = await purge()
check(
  '逐块删除至空 → 块清空、孤儿原文一并清理',
  purged.deleted === up.chunkCount && purged.chunks === 0 && purged.kbDoc === null,
  `deleted=${purged.deleted} 剩余块=${purged.chunks} kbDoc=${purged.kbDoc ?? '已清理'}`,
)

const restored = await send('IMPORT_DATA', { envelope: env })
const after = await send('EXPORT_DATA', { includeMemory: false })
const restoredDoc = (after.envelope?.kbDocs ?? []).find((d) => d.docId === DOC)
const restoredChunks = (after.envelope?.knowledge ?? []).filter((k) => k.docId === DOC)
check(
  '换库导入:原文与块一起回来,块元字段保持(可继续自动重切)',
  restored.addedKbDocs === 1 &&
    restored.addedKnowledge === up.chunkCount &&
    restoredDoc?.content === MD.trim() &&
    restoredChunks.length === up.chunkCount &&
    restoredChunks.every((k) => k.chunkKind === 'qa' || k.chunkKind === 'section') &&
    restoredChunks.every((k) => typeof k.sectionSeq === 'number'),
  `addedKbDocs=${restored.addedKbDocs} addedKnowledge=${restored.addedKnowledge} chunks=${restoredChunks.length}`,
)

// splitterVersion 原样带出 → 与当前版本不符时,SW 下次启动自动重切,不必要求用户重传
const currentVersion = restoredDoc?.splitterVersion
const tampered = {
  ...env,
  kbDocs: (env.kbDocs ?? []).map((d) => ({ ...d, splitterVersion: '0.0.1-旧版' })),
}
await purge()
const tamperedImport = await send('IMPORT_DATA', { envelope: tampered })
check(
  '旧版本包照样能导入(版本号只影响重切,不构成导入门槛)',
  tamperedImport.addedKbDocs === 1 && tamperedImport.addedKnowledge === up.chunkCount,
  JSON.stringify(tamperedImport).slice(0, 140),
)
const tamperedRow = await swEval(
  async (docId) => {
    const d = await globalThis.pddDb.getKbDoc(docId)
    return d?.splitterVersion
  },
  DOC,
)
check('导入保留包内的 splitterVersion(不强行改写为当前版本)', tamperedRow === '0.0.1-旧版', `version=${tamperedRow}`)

// 重启 SW:启动扫描应把版本失配的文档按新规则重切
await ctx.close()
const ctx2 = await launchExtContext(PROFILE)
await sleep(8000)
const extId2 = await findExtensionId(ctx2)
const pop2 = await openPopup(ctx2, extId2)
if (!pop2) {
  console.log('FAIL: 重启后 popup 打不开')
  await ctx2.close()
  process.exit(1)
}
await sleep(2000)
const send2 = (type, payload) =>
  pop2.evaluate(
    async ({ type, payload }) => (await chrome.runtime.sendMessage({ type, payload }))?.payload ?? {},
    { type, payload },
  )
// 启动扫描是异步的,轮询到版本归位为止(不靠固定 sleep 撞运气)
let resplitDoc
let resplitChunks = []
for (let i = 0; i < 20; i++) {
  const afterRestart = await send2('EXPORT_DATA', { includeMemory: false })
  resplitDoc = (afterRestart.envelope?.kbDocs ?? []).find((d) => d.docId === DOC)
  resplitChunks = (afterRestart.envelope?.knowledge ?? []).filter((k) => k.docId === DOC)
  if (resplitDoc?.splitterVersion === currentVersion) break
  await sleep(2000)
}
check(
  'SW 启动按原文自动重切:版本归位、块按新规则重建、元字段齐全',
  resplitDoc?.splitterVersion === currentVersion &&
    resplitChunks.length === up.chunkCount &&
    resplitChunks.every((k) => k.chunkKind === 'qa' || k.chunkKind === 'section'),
  `version=${resplitDoc?.splitterVersion} chunks=${resplitChunks.length}/${up.chunkCount}`,
)

// ══ D 弹窗接线 ═══════════════════════════════════════════════════════════════════
// 数据层全对、页签没接上,用户那端看到的仍是一张空页 —— 所以把"点开能看到什么"
// 也验一遍(读渲染出来的文字,不截图)。

const nowD = Date.now()
await send2('IMPORT_DATA', {
  envelope: {
    version: '2.0',
    exportedAt: nowD,
    settings: exported0.envelope?.settings,
    folders: [],
    goldens: [],
    knowledge: [],
    kbDocs: [],
    qaRecords: [qaRow('qa-ui', 'v16-ui-hx', '能退货吗', nowD - 1000)],
    replies: [
      { id: 'rp-ui', qaId: 'qa-ui', text: '七天无理由退货,吊牌完整即可', contentHash: 'ch-ui', ts: nowD, hasEmbedding: 0 },
    ],
  },
})
// 攒一点可读的统计数,好让设置页那张卡有东西可显示
for (let i = 0; i < 3; i++) await send2('TRACK_EVENT', { event: 'search.total' })
await send2('TRACK_EVENT', { event: 'search.miss' })

await pop2.locator('button[title="沉淀"]').click()
await sleep(1200)
const backlogText = await pop2.evaluate(() => document.body.textContent ?? '')
check(
  '「沉淀」页签能打开并渲染条目(问过 N 次 / 设为标准 / 换一条)',
  backlogText.includes('问过 1 次') && backlogText.includes('设为标准') && backlogText.includes('共 1 条待沉淀'),
  backlogText.slice(0, 120),
)
check(
  '待沉淀条数回传到顶部概览行(onCountChange 接线)',
  backlogText.includes('待沉淀 1 条 · 按出现次数倒序'),
  backlogText.match(/待沉淀[^·]{0,12}/)?.[0] ?? '(未出现)',
)

await pop2.locator('button[title="设置"]').click()
await sleep(1200)
const settingsText = await pop2.evaluate(() => document.body.textContent ?? '')
check(
  '设置页「使用统计」卡:检索行合成次数与未命中率',
  settingsText.includes('使用统计') && settingsText.includes('3 次 · 未命中 1 次(33%)'),
  settingsText.match(/检索次数[^深]*/)?.[0]?.slice(0, 40) ?? '(未出现)',
)
check(
  '统计卡写明"只在本机"(不联网、不随导出外发)',
  settingsText.includes('只记在本机'),
  '',
)

// 清理 + 收尾:指标表与业务表各归各位(下一次跑脚本仍是干净起点)
await pop2.evaluate(async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_METRICS' })
})
const finalMetrics = await pop2.evaluate(async () => {
  const s = await chrome.runtime.sendMessage({ type: 'GET_STATS' })
  return s?.payload?.metrics ?? {}
})
check('清理:统计已重置', Object.keys(finalMetrics).length === 0, JSON.stringify(finalMetrics))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== v0.16 验收:${results.length - failed.length}/${results.length} 通过 ===`)
await ctx2.close()
process.exit(failed.length > 0 ? 1 : 0)
