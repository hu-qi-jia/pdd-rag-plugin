/**
 * v9 库升级的真机验收(数据层,不截图)。
 *
 * 为什么单测不够:`tests/unit/background/dbUpgrade.test.ts` 跑在 `fake-indexeddb` 上,
 * 忠实但**不是**真的 IndexedDB。v9 迁移要动的是**用户库里已经躺着的行**(改名、换判据、
 * 重排、顶时间戳),而 fake-indexeddb 与 Chromium 在版本号、升级事务的可见性、
 * 多表读写的时序上并不保证一致。这条链路的失败模式又**全是静默的**(库照常打开、
 * 界面照常渲染,只是归类仍按旧标准),所以必须让**真的扩展在真的 profile 里**跑一遍。
 *
 * 本脚本干四件事:
 *   ① 用临时 profile 起真扩展,在 SW 里**删掉** `PddCSDB`;
 *   ② 用原生 indexedDB 在**版本 80**(= Dexie 的 v8,见下)建一个 v8 形状的库,
 *      塞进六条旧预置 + 未分类 + 四条带 `categoryAt` 的问答记录(夹具形状照抄
 *      `dbUpgrade.test.ts`,两边口径一致);
 *   ③ 关掉这个连接,再让**扩展自己**去打开它(面板消息 GET_STATS / GET_BACKFILL_STATE
 *      读类型表与待办数)—— 升级由产品代码跑,不是这里手写的;
 *   ④ 断言升级后的可观测结果。
 *
 * 版本号换算(踩过一次就会白跑一整天):Dexie 把 `version(N)` 映射成原生
 * `indexedDB` 版本 `N * 10`(见 dexie.js: `Math.ceil(idbdb.version / 10)`,
 * `runUpgraders(db, oldVer / 10, ...)`)。所以 v8 库的原生版本是 **80**,不是 8。
 * 建在 8 上,扩展一开库就会从"版本 0.8"往上跑一遍 v1~v9 的**全部**升级,
 * 连 v8 的文件夹迁移都会重放 —— 那验的就不是这一轮的东西了。
 *
 * 用法:`node scripts/verify-v9-upgrade.mjs`
 *   - 默认无头(纯数据层,不需要看界面);设 `PDD_E2E_HEADLESS=0` 可看着跑。
 *   - 依赖 `npm run build` 的产物(lib.mjs 会先拦下没有模型的包)。
 */
import { launchExtContext, findExtensionId, openPopup, freshProfile, sleep } from './lib.mjs'
import { rmSync } from 'node:fs'

const PROFILE = freshProfile()
const DB_NAME = 'PddCSDB'
/** v8 对应的**原生** indexedDB 版本(见文件头: Dexie N → 原生 N*10) */
const NATIVE_V8 = 80
/** 升到 v9 之后的原生版本。它变了 = onupgradeneeded 里真的跑过 v9 那段迁移 */
const NATIVE_V9 = 90
/** 存量打标时间(远古,远早于"现在"):旧标签就是在这个时刻打上的 */
const OLD_CATEGORY_AT = 1_700_000_000_000
/** 刻意取在**未来**的 categoryAt —— 时钟偏斜,或就在升级前一刻打的标。
 *  不摆这么一条,「stamp 严格大于存量最大值」这条性质在真机上**测不出来**:
 *  存量时间戳都在过去时,迁移随手写 `Date.now()` 也大于它们,取等/取 now 的写法照样绿。
 *  摆在未来,stamp 只能靠"存量最大值 + 1"拿到 —— 写错的写法会让这条掉出候选。 */
const FUTURE_OFFSET = 60_000

const HEADLESS = process.env.PDD_E2E_HEADLESS !== '0'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const bail = async (msg) => {
  console.log(`FAIL: ${msg}`)
  await ctx?.close().catch(() => {})
  try {
    rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    /* 有残留句柄时留给下次清理 */
  }
  process.exit(1)
}

// ─── 夹具:在 SW 里造一个"跑过 v8"的真库 ────────────────────────────────────────
// 这段函数体是在**扩展的 Service Worker 全局**里求值的(Playwright 序列化过去),
// 所以只能用它那儿有的东西:原生 indexedDB。Dexie 的本体在这里拿不到,也不需要 ——
// 要验的恰恰是"扩展自己的 Dexie 打开这个库会发生什么"。
const SEED_V8 = async ({ dbName, nativeV8, oldAt, futureOffset }) => {
  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((r) => setTimeout(() => r(`${label}:timeout`), ms)),
    ])

  const txDone = (t) =>
    new Promise((res, rej) => {
      t.oncomplete = () => res()
      t.onerror = () => rej(new Error(String(t.error)))
      t.onabort = () => rej(new Error('tx aborted: ' + String(t.error)))
    })

  // ① 删库。扩展 SW 启动时就 `ensurePresetCategories()` 打开过库,这里要靠
  //    versionchange(会同步触发 Dexie 的 close)把它让开 —— 删不掉就如实报出来。
  let blocked = false
  const delResult = await withTimeout(
    new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(dbName)
      req.onsuccess = () => resolve('success')
      req.onerror = () => resolve(`error:${req.error && req.error.name}`)
      req.onblocked = () => {
        blocked = true
      }
    }),
    8000,
    'delete',
  )

  // ② v8 的完整表结构(v1~v8 原样搭一遍,刻意不共用运行时定义)。
  //    索引口径必须与 db.ts 声明的一致:对不上的话 Dexie 会走"SchemaDiff"分支
  //    (自己加缺失部分并自增原生版本),那也不是用户库里那条路。
  const SCHEMA = [
    [
      'qaRecords',
      'id',
      false,
      ['sessionKey', 'questionHash', 'questionTs', 'hasEmbedding', 'msgId'],
      [['[sessionKey+questionTs]', ['sessionKey', 'questionTs']]],
    ],
    ['replies', 'id', false, ['qaId', 'contentHash', 'ts', 'msgId']],
    ['goldens', 'id', false, ['folderId', 'questionHash', 'hasEmbedding']],
    ['folders', 'id', false, ['parentId']],
    ['knowledge', 'id', false, ['questionHash', 'hasEmbedding', 'enabled', 'docId']],
    ['kbDocs', 'docId', false, ['splitterVersion']],
    ['metrics', 'key', false, []],
    ['errors', 'id', true, ['timestamp']],
    ['categories', 'id', false, ['kind', 'position']],
  ]

  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, nativeV8)
    req.onupgradeneeded = () => {
      const d = req.result
      for (const [name, keyPath, autoIncrement, indexes = [], compound = []] of SCHEMA) {
        const os = d.createObjectStore(name, { keyPath, autoIncrement })
        for (const ix of indexes) os.createIndex(ix, ix)
        for (const [ixName, ixKeyPath] of compound) os.createIndex(ixName, ixKeyPath)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error(String(req.error)))
    req.onblocked = () => reject(new Error('open blocked'))
  })

  // ③ 旧预置行(名与判据都是重制前的真名;criteria 留个可辨认的哨兵值,
  //    用来验"判据被换掉了")。这一份夹具自己建自己的 id→名 表,故旧名照抄:
  //    真实 v8 库里躺着的就是这几行,换成占位名就验不出"改名覆盖了存量"了。
  const OLD_PRESET = (id, name, route, position) => ({
    id,
    name,
    criteria: '旧判据',
    kind: 'preset',
    route,
    filterable: true,
    position,
    createdAt: 1,
    updatedAt: 1,
  })
  const futureAt = Date.now() + futureOffset
  const QA = (id, categoryId, categorySource, categoryAt) => ({
    id,
    sessionKey: 's1',
    question: `问题 ${id}`,
    questionHash: `h-${id}`,
    questionTs: 1000,
    hasEmbedding: 0,
    categoryId,
    categorySource,
    categoryAt,
    replyCount: 0,
    createdAt: 1,
    updatedAt: 1,
  })

  const categories = [
    OLD_PRESET('preset:size', '尺码推荐', 'size', 0),
    OLD_PRESET('preset:order', '订单物流', 'retrieve', 1),
    OLD_PRESET('preset:aftersale', '售后退换', 'retrieve', 2),
    OLD_PRESET('preset:price', '价格优惠', 'retrieve', 3),
    OLD_PRESET('preset:attribute', '商品属性', 'retrieve', 4),
    OLD_PRESET('preset:stock', '库存发货', 'retrieve', 5),
    {
      id: 'uncategorized',
      name: '未分类',
      criteria: '',
      kind: 'uncategorized',
      route: 'retrieve',
      filterable: false,
      position: 9999,
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  // 四条存量记录,四种要重判的理由各一条(与 dbUpgrade.test.ts 同一套埋雷):
  //   被改名的类型上的 jev 标签 / 被改名的类型上的 jev 标签 / 尺码标签(记录级选项集已不含它)
  //   / categoryAt 在未来(stamp 不取 max+1 就漏它)
  // 迁移一条都不许改写它们 —— 待办数增加靠的是**类型的 updatedAt 顶高**,不是改记录。
  const qaRecords = [
    QA('qa-aftersale', 'preset:aftersale', 'jev', oldAt),
    QA('qa-attribute', 'preset:attribute', 'jev', oldAt),
    QA('qa-size', 'preset:size', 'jev', oldAt),
    QA('qa-future', 'preset:order', 'jev', futureAt),
  ]

  for (const [store, rows] of [
    ['categories', categories],
    ['qaRecords', qaRecords],
  ]) {
    const t = db.transaction(store, 'readwrite')
    const os = t.objectStore(store)
    for (const r of rows) os.put(r)
    await txDone(t)
  }

  // ④ 读回来验夹具本身落了地:数量不对(比如扩展抢在前面重建了库)就不该往下走 ——
  //    否则后面的断言会把"夹具没进去"误读成"迁移错了"。
  const readAll = (store) =>
    new Promise((res, rej) => {
      const r = db.transaction(store, 'readonly').objectStore(store).getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(new Error(String(r.error)))
    })
  const seededCats = await readAll('categories')
  const seededQa = await readAll('qaRecords')

  db.close()

  return {
    delResult,
    blocked,
    nativeVersion: nativeV8,
    futureAt,
    seeded: {
      categories: seededCats.map((c) => ({ id: c.id, name: c.name, position: c.position })),
      qaRecords: seededQa.map((r) => ({
        id: r.id,
        question: r.question,
        categoryId: r.categoryId,
        categoryAt: r.categoryAt,
      })),
    },
  }
}

// ─── 升级后:原生只读一遍库(与面板 DTO 互为交叉验证)────────────────────────────
const READ_UPGRADED = async (dbName) => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error(String(req.error)))
  })
  const getAll = (store) =>
    new Promise((res, rej) => {
      const r = db.transaction(store, 'readonly').objectStore(store).getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(new Error(String(r.error)))
    })
  const cats = await getAll('categories')
  const qa = await getAll('qaRecords')
  const out = {
    nativeVersion: db.version,
    stores: Array.from(db.objectStoreNames).sort(),
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      route: c.route,
      position: c.position,
      updatedAt: c.updatedAt,
      criteria: c.criteria,
    })),
    qaRecords: qa.map((r) => ({
      id: r.id,
      question: r.question,
      categoryId: r.categoryId,
      categoryAt: r.categoryAt,
    })),
  }
  db.close()
  return out
}

// ─── 起扩展 ───────────────────────────────────────────────────────────────────
const ctx = await launchExtContext(PROFILE, { headless: HEADLESS })
await sleep(4000)
const extId = await findExtensionId(ctx)
if (!extId) await bail('扩展未加载(lib.mjs 的产物自检已过,说明是加载/启动问题)')
console.log('扩展 id:', extId, ' profile:', PROFILE)

const sw = () => ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
if (!sw()) await bail('扩展 SW 未就绪')

// ── ①② 删库 + 造 v8 夹具 ──
const seeded = await sw().evaluate(SEED_V8, {
  dbName: DB_NAME,
  nativeV8: NATIVE_V8,
  oldAt: OLD_CATEGORY_AT,
  futureOffset: FUTURE_OFFSET,
})
console.log(
  `夹具:删库=${seeded.delResult}${seeded.blocked ? '(曾 blocked)' : ''}` +
    ` · categories=${seeded.seeded.categories.length} · qaRecords=${seeded.seeded.qaRecords.length}` +
    ` · 原生版本=${seeded.nativeVersion} · 未来时间戳=${seeded.futureAt}`,
)
// 升级**前**的原样(与下面"面板读回"对照着看:同一批 id,名字/判据/位置就是被这一段改掉的)
console.log(
  '  升级前:',
  [...seeded.seeded.categories]
    .sort((a, b) => a.position - b.position)
    .map((c) => `${c.id}@${c.position}=${c.name}`)
    .join(' '),
)
check('删库成功(扩展的 Dexie 连接已让开)', seeded.delResult === 'success', JSON.stringify(seeded.delResult))
check(
  'v8 夹具落地:7 行类型(六旧预置 + 未分类)',
  seeded.seeded.categories.length === 7 &&
    seeded.seeded.categories.map((c) => c.id).sort().join(',') ===
      ['preset:aftersale', 'preset:attribute', 'preset:order', 'preset:price', 'preset:size', 'preset:stock', 'uncategorized'].join(','),
  seeded.seeded.categories.map((c) => `${c.id}@${c.position}`).join(' '),
)
check('v8 夹具落地:4 条带 categoryAt 的问答记录', seeded.seeded.qaRecords.length === 4)
// 夹具没落地就**不该往下走**:后面的断言会把"夹具错"误读成"迁移错",而两者的修法
// 完全不同。这里停住,并留下当时的真实读数。
if (!results.every((r) => r.ok)) await bail('v8 夹具没落地(见上面两行),就此打住')

// ── ③ 让扩展自己去打开这个库:面板消息读类型表与待办数 ──
const pop = await openPopup(ctx, extId)
if (!pop) await bail('popup 打不开')
const pageErrors = []
pop.on('pageerror', (e) => pageErrors.push(String(e)))

const send = (type, payload) =>
  pop.evaluate(
    async ({ type, payload }) => {
      const resp = await chrome.runtime.sendMessage({ type, payload })
      return resp?.payload ?? {}
    },
    { type, payload },
  )

await sleep(1500)
const stats = await send('GET_STATS')
const backfill = await send('GET_BACKFILL_STATE')
const cats = stats?.categories ?? []
const pending = backfill?.pending ?? {}

console.log('面板读回(升级由扩展自己的 Dexie 完成):')
for (const c of [...cats].sort((a, b) => a.position - b.position)) {
  console.log(`  ${String(c.position).padStart(4)}  ${c.id.padEnd(18)} ${c.name.padEnd(8)} route=${c.route} kind=${c.kind}`)
}
console.log('  待办计数:', JSON.stringify(pending))

// ── ④ 断言:升级后的可观测结果 ──
check('库里 categories 共 10 行(7 行存量 + 3 行新增,一个都没删)', cats.length === 10, `count=${cats.length}`)

const byId = new Map(cats.map((c) => [c.id, c]))
const RENAMED = [
  ['preset:attribute', '商品信息'],
  ['preset:price', '价格优惠'],
  ['preset:stock', '库存与规格'],
  ['preset:order', '发货与物流'],
  ['preset:aftersale', '退换货'],
]
const renamedBad = RENAMED.filter(([id, name]) => byId.get(id)?.name !== name)
check(
  '五条改名到位(attribute/price/stock/order/aftersale)',
  renamedBad.length === 0,
  renamedBad.map(([id, name]) => `${id}=${byId.get(id)?.name ?? '缺失'}≠${name}`).join(' ') || '5/5',
)

const NEW_TYPES = [
  ['preset:payment', '支付与发票'],
  ['preset:quality', '质量与维修'],
  ['preset:other', '其他'],
]
const newBad = NEW_TYPES.filter(([id, name]) => byId.get(id)?.name !== name)
check(
  '三条新类型在场且名字对(payment/quality/other)',
  newBad.length === 0,
  newBad.map(([id, name]) => `${id}=${byId.get(id)?.name ?? '缺失'}≠${name}`).join(' ') || '3/3',
)
check('preset:size 原样保留,仍走 size 路由(不是被删掉的废弃类型)', byId.get('preset:size')?.route === 'size')

const RECORD_LEVEL = [
  'preset:attribute',
  'preset:price',
  'preset:stock',
  'preset:payment',
  'preset:order',
  'preset:aftersale',
  'preset:quality',
  'preset:other',
]
const posBad = RECORD_LEVEL.map((id, i) => ({ id, want: i, got: byId.get(id)?.position })).filter(
  (x) => x.got !== x.want,
)
check(
  '八个记录级类型 position = 0..7,按常量顺序',
  posBad.length === 0,
  posBad.map((x) => `${x.id}:${x.got}≠${x.want}`).join(' ') || '0..7',
)
check('preset:size 排在第 9 位(position=8),尺码不进记录级段', byId.get('preset:size')?.position === 8, `pos=${byId.get('preset:size')?.position}`)

// 待办数:这四条记录都必须进候选 —— 它们能进,唯一的理由就是类型的 updatedAt 被顶到了
// 每条 categoryAt **之上**(含未来那条)。写错成 `now` 或取等,qa-future 就会掉出去。
const total = (pending.history ?? 0) + (pending.golden ?? 0)
check('countBackfillCandidates() 大于零(存量被触发重判)', total > 0, JSON.stringify(pending))
check(
  '待办数逐条对得上:4 条问答全进候选,标答 0 条(夹具里没有)',
  pending.history === 4 && pending.golden === 0,
  JSON.stringify(pending),
)

// ── 交叉验证:原生只读一遍库,看面板 DTO 是不是如实反映 ──
const raw = await sw().evaluate(READ_UPGRADED, DB_NAME)
console.log('原生读回:原生版本=', raw.nativeVersion, ' stores=', raw.stores.join(','))
check(
  '★ 库原生版本 80 → 90:v9 那段升级事务真的在真 IndexedDB 上跑过',
  raw.nativeVersion === NATIVE_V9,
  `nativeVersion=${raw.nativeVersion}(期望 ${NATIVE_V9})`,
)
check('原生读回的 categories 也是 10 行(DTO 与库一致)', raw.categories.length === 10, `count=${raw.categories.length}`)
check(
  '原生读回:九个预置的 criteria 都已换成新判据(哨兵「旧判据」一条不剩)',
  raw.categories.filter((c) => c.criteria === '旧判据').length === 0,
  `残留=${raw.categories.filter((c) => c.criteria === '旧判据').map((c) => c.id).join(',') || '无'}`,
)
const upgradedById = new Map(raw.categories.map((c) => [c.id, c]))
check(
  '原生读回:三种新类型 id 在场且 position 与 DTO 一致',
  NEW_TYPES.every(([id]) => upgradedById.get(id)?.position === byId.get(id)?.position),
)
// 「其他」是靠 criteria 抢在记录级选项表末尾当出口的:空 criteria 等于出口没了
// (v8 从用户文件夹名造出来的 legacy 行就是空 criteria,迁移必须让开名字而不是让判据被顶掉)。
check(
  '原生读回:preset:other 的出口判据非空且含「不属于」',
  (upgradedById.get('preset:other')?.criteria ?? '').includes('不属于'),
  `criteria=${JSON.stringify(upgradedById.get('preset:other')?.criteria ?? '')}`,
)

// 严格大于:类型 updatedAt 必须 > 挂在它上面的存量记录 categoryAt。
// 相等是陷阱(v8 迁移刻意取等,好让存量不重跑),这一轮要的恰恰相反。
const futureRec = raw.qaRecords.find((r) => r.id === 'qa-future')
check(
  '★ 类型 updatedAt 严格大于存量 categoryAt(含那条未来时间戳)',
  futureRec != null && upgradedById.get('preset:order').updatedAt > futureRec.categoryAt,
  `updatedAt=${upgradedById.get('preset:order')?.updatedAt} vs categoryAt=${futureRec?.categoryAt}`,
)
check(
  '存量记录的标签与原文一条都没被改写(迁移改的是类型行)',
  raw.qaRecords.length === 4 &&
    raw.qaRecords.every((r) => {
      const before = seeded.seeded.qaRecords.find((s) => s.id === r.id)
      return before != null && r.categoryId === before.categoryId && r.question === before.question
    }),
  raw.qaRecords.map((r) => `${r.id}→${r.categoryId}`).join(' '),
)

check('无页面错误', pageErrors.length === 0, JSON.stringify(pageErrors))

// ─── 收尾 ─────────────────────────────────────────────────────────────────────
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 有残留句柄时留给下次清理 */
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
