/**
 * 库版本升级单测(v0.16 → v7,fake-indexeddb)。
 *
 * 「撤掉一个页签」这件事在代码里是删文件,在**用户的库里**是另一回事:已经跑过 v6 的
 * 库里 `backlogIgnores` 表还在,Dexie 不会因为再没人读它就把它抹掉 —— 得显式声明删表。
 * 这里造出真实的旧库(把 v1~v6 的 schema 原样搭一遍),再用**真的** `PddDatabase` 打开,
 * 验两件事:
 *  ① v7 之后表确实没了(v6→v7 路径);
 *  ② 顺带把老库一路升到 v7 是可行的、业务数据分毫未动(v5→v7 路径,真实用户走的就是这条)。
 * 只测"新装直接建 v7"是不够的 —— 那条路 e2e 已经覆盖,而升级路只有这里能验。
 */
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { PRESET_CATEGORIES } from '../../../src/shared/constants'

/** 旧库 schema:照抄 db.ts 里 v1~v6 的定义(测试夹具,刻意不共用运行时定义) */
const LEGACY_VERSIONS: Array<Record<string, string>> = [
  {
    qaRecords: 'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs]',
    replies: 'id, qaId, contentHash, ts',
    goldens: 'id, folderId, questionHash, hasEmbedding',
    folders: 'id, parentId',
    knowledge: 'id, questionHash, hasEmbedding, enabled',
    errors: '++id, timestamp',
  },
  { knowledge: 'id, questionHash, hasEmbedding, enabled' },
  { knowledge: 'id, questionHash, hasEmbedding, enabled, docId' },
  {
    qaRecords:
      'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs], msgId',
    replies: 'id, qaId, contentHash, ts, msgId',
  },
  { kbDocs: 'docId, splitterVersion' },
  { metrics: 'key', backlogIgnores: 'questionHash' },
]

/** 建一个"跑过 v6"的旧库,并塞进一条金标准、一条统计、一条待沉淀忽略标记 */
async function seedLegacyDb(versions: number): Promise<void> {
  const legacy = new Dexie('PddCSDB')
  for (let i = 0; i < versions; i++) legacy.version(i + 1).stores(LEGACY_VERSIONS[i])
  await legacy.open()
  await legacy.table('goldens').add({
    id: 'g-old',
    folderId: null,
    question: '旧库里就有的问题',
    answer: '旧库里就有的回答',
    questionHash: 'h-old',
    hasEmbedding: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  if (versions >= 6) {
    await legacy.table('metrics').add({ key: 'search.total', count: 7, updatedAt: 1 })
    await legacy.table('backlogIgnores').add({
      questionHash: 'h-ignored',
      question: '不想再看到的问题',
      createdAt: 1,
    })
  }
  legacy.close()
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('库升级到 v7', () => {
  it('v6 → v7:显式删表,孤儿表不再存在', async () => {
    await seedLegacyDb(6)

    const db = new PddDatabase()
    await db.open()
    const names = db.tables.map((t) => t.name)
    db.close()

    expect(names).not.toContain('backlogIgnores')
    expect(names).toContain('metrics')
  })

  it('v5 → v7:老库照常升上来,业务数据分毫未动', async () => {
    await seedLegacyDb(5)

    const db = new PddDatabase()
    await db.open()
    const golden = await db.goldens.get('g-old')
    const tables = db.tables.map((t) => t.name)
    db.close()

    expect(golden?.question).toBe('旧库里就有的问题')
    // v0.15.1 的库里本来就没有 metrics(它在 v6 才加),升级后空表可用即可
    expect(tables).toEqual(expect.arrayContaining(['metrics', 'kbDocs']))
  })

  it('升级不吞掉 v6 才有的表:metrics 数据照常读得到', async () => {
    await seedLegacyDb(6)

    const db = new PddDatabase()
    await db.open()
    const metric = await db.metrics.get('search.total')
    // 删的是 backlogIgnores,不是"顺手把 v6 加的表一起清了"
    expect(metric?.count).toBe(7)
    db.close()
  })
})

// ─── v7 → v8:旧文件夹转自定义类型 ─────────────────────────────────────────────
//
// 这一步的失败模式是"用户以为数据丢了":如果迁移把原本挂在「双十一」夹里的标准回答
// 落进未分类,用户打开面板会认为手工整理白做了。所以三条断言必须同时成立 ——
// 文件夹名还在、归属还对、且被标成人工的(机器不许再动)。

/** v7 的完整 schema(v1~v7 原样搭一遍,刻意不共用运行时定义) */
const LEGACY_V7: Array<Record<string, string | null>> = [
  {
    qaRecords: 'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs]',
    replies: 'id, qaId, contentHash, ts',
    goldens: 'id, folderId, questionHash, hasEmbedding',
    folders: 'id, parentId',
    errors: '++id, timestamp',
  },
  { knowledge: 'id, questionHash, hasEmbedding, enabled' },
  { knowledge: 'id, questionHash, hasEmbedding, enabled, docId' },
  {
    qaRecords:
      'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs], msgId',
    replies: 'id, qaId, contentHash, ts, msgId',
  },
  { kbDocs: 'docId, splitterVersion' },
  { metrics: 'key', backlogIgnores: 'questionHash' },
  { backlogIgnores: null },
]

/** 造一个"跑过 v7"的库:两个文件夹、两条标答(一条在夹里、一条没入夹) */
async function seedLegacyV7(): Promise<void> {
  const legacy = new Dexie('PddCSDB')
  LEGACY_V7.forEach((stores, i) => {
    legacy.version(i + 1).stores(stores)
  })
  await legacy.open()
  await legacy.table('folders').bulkAdd([
    { id: 'uncategorized', parentId: null, name: '默认文件夹', position: 0, createdAt: 1000 },
    { id: 'f-hot', parentId: null, name: '双十一', position: 1, createdAt: 2000 },
  ])
  await legacy.table('goldens').bulkAdd([
    {
      id: 'gd-in-folder',
      folderId: 'f-hot',
      question: '能便宜点吗',
      answer: '亲,已经是最低价啦',
      questionHash: 'h1',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'gd-no-folder',
      folderId: null,
      question: '多久发货',
      answer: '48 小时内发出',
      questionHash: 'h2',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      // addGolden 的默认落点:用户从没挑过夹,不是"手工摆放"
      id: 'gd-in-default',
      folderId: 'uncategorized',
      question: '发什么快递',
      answer: '默认发中通',
      questionHash: 'h3',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  legacy.close()
}

describe('v7 → v8 旧文件夹迁移', () => {
  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
  })

  it('用户自建的旧文件夹转成一条 filterable=false 的自定义类型', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const hot = await upgraded.categories.get('legacy:f-hot')
    expect(hot).toBeDefined()
    expect(hot!.name).toBe('双十一')
    expect(hot!.kind).toBe('custom')
    expect(hot!.filterable).toBe(false)
    expect(hot!.criteria).toBe('')

    // 预置「默认文件夹」不转:它只是 addGolden 写新标答时的系统占位,不是用户内容,
    // 且与新内置「未分类」是同一个概念。转了它,默认夹里的标答就会被当成"手工摆放",
    // 永远进不了补分类。
    expect(await upgraded.categories.get('legacy:uncategorized')).toBeUndefined()
    upgraded.close()
  })

  it('落在预置默认文件夹里的标答归为未分类,仍是补分类的候选', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const inDefault = (await upgraded.goldens.get('gd-in-default'))!
    expect(inDefault.categoryId).toBeNull()
    // 用户没挑过夹,不是手工摆放 —— 不许打 manual,否则补分类会永远跳过它
    expect(inDefault.categorySource).toBeUndefined()
    expect(inDefault.categoryAt).toBeUndefined()
    upgraded.close()
  })

  it('标准回答的归属跟着搬,且标成人工的(机器永不许覆盖)', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const inFolder = (await upgraded.goldens.get('gd-in-folder'))!
    expect(inFolder.categoryId).toBe('legacy:f-hot')
    expect(inFolder.categorySource).toBe('manual')

    const noFolder = (await upgraded.goldens.get('gd-no-folder'))!
    expect(noFolder.categoryId).toBeNull()
    expect(noFolder.categorySource).toBeUndefined()
    upgraded.close()
  })

  it('业务数据分毫未动:问题与答案原文还在', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()
    const g = (await upgraded.goldens.get('gd-in-folder'))!
    expect(g.question).toBe('能便宜点吗')
    expect(g.answer).toBe('亲,已经是最低价啦')
    expect(g.folderId).toBe('f-hot')
    upgraded.close()
  })

  it('新装(没有旧库)直接建 v8,不跑迁移也不报错', async () => {
    const fresh = new PddDatabase()
    await fresh.open()
    await fresh.ensurePresetCategories()
    expect(await fresh.categories.count()).toBe(10)
    fresh.close()
  })
})

// ─── v8 → v9:类型集重制(改名 / 新增 / 重排 / 尺码跟着触发重判)────────────────
//
// 这一步的失败模式**全是静默的**,没有一条会抛错:
//  ① 类型改了名与 criteria,存量记录却不重判 —— 界面列着新类型,归类仍按旧标准;
//  ② 新增的「其他」与用户旧文件夹撞名 —— 那行的空 criteria 会把出口判据顶掉(出口等于没了);
//  ③ 非预置行的 position 与预置同值 —— 自定义类型插进 售前→售中→售后 段内部。
// 夹具按这三条埋雷:六条旧预置(旧名、position 0..5)、两条与**预置名**撞车的 legacy 行、
// 一条 position=6 的老自定义行,以及 jev 打过标 / 人工摆过 / 带尺码标签 的三类记录。

/** v8 的完整 schema(v1~v8 原样搭一遍,刻意不共用运行时定义) */
const LEGACY_V8: Array<Record<string, string | null>> = [
  ...LEGACY_V7,
  { categories: 'id, kind, position' },
]

/** 存量打标时间(远古,远早于"现在") */
const OLD_CATEGORY_AT = 1_700_000_000_000

/**
 * 刻意取在**未来**的 categoryAt(时钟偏斜,或就在升级前一刻打的标)。
 *
 * 不这么摆,「updatedAt 严格大于 categoryAt」这条性质在测试里是**测不出来**的:存量
 * 时间戳都在过去时,迁移随手写 `Date.now()` 也能大于它们,取等的写法照样绿。摆到未来,
 * stamp 只能靠"存量最大值 + 1"拿到 —— 谁把这一步写成 `now`,谁就红。
 */
const FUTURE_HIGH = Date.now() + 60_000
const FUTURE_LOW = Date.now() + 30_000

/** 升级后应进补分类候选的条数(夹具埋 7 条问答 + 2 条标答):
 *  manual 跳过、inherit 跳过,其余带有效 jev 标签的都在(类型 updatedAt 已顶高)。 */
const EXPECTED_CANDIDATES = { history: 5, golden: 1 }

/** 造一个"跑过 v8"的库。
 *
 *  `maxIn` 决定**全局最大**的 categoryAt 落在哪张表:迁移取最大值时两张表都得读,
 *  而只读一张的写法恰恰只会在"被漏掉那张表持有最大值"时露馅 —— 两种摆法各钉住一张表。
 *  `omit` 用来造"手工修过的库":预置行可能压根不在,迁移得补上而不是把库搞崩。
 */
async function seedLegacyV8(
  maxIn: 'qaRecords' | 'goldens' = 'goldens',
  omit: string[] = [],
): Promise<void> {
  const legacy = new Dexie('PddCSDB')
  LEGACY_V8.forEach((stores, i) => {
    legacy.version(i + 1).stores(stores)
  })
  await legacy.open()

  const qaFuture = maxIn === 'qaRecords' ? FUTURE_HIGH : FUTURE_LOW
  const goldenFuture = maxIn === 'goldens' ? FUTURE_HIGH : FUTURE_LOW

  await legacy.table('categories').bulkAdd([
    // 六个旧预置(顺序即旧数组:size 在最前,故自定义行从 position=6 起)
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
    // v8 从用户文件夹名造出来的行(不查重、criteria 空串):两行恰好压在**预置**的名字上 ——
    // 「其他」撞新增的 preset:other,「退换货」撞改名后的 preset:aftersale
    LEGACY_FOLDER('legacy:f-other', '其他', 101),
    LEGACY_FOLDER('legacy:f-exchange', '退换货', 102),
    LEGACY_FOLDER('legacy:f-hot', '双十一', 100),
    // 老版本建的自定义类型:position 取自**旧的** PRESET_CATEGORIES.length(6)
    {
      id: 'cat-old',
      name: '自定义旧类型',
      criteria: '旧自定义判据',
      kind: 'custom',
      route: 'retrieve',
      filterable: true,
      position: 6,
      createdAt: 1,
      updatedAt: 1,
    },
  ].filter((c) => !omit.includes(c.id)))

  await legacy.table('qaRecords').bulkAdd([
    // jev 打在**被改名**的类型上 → 判据换了,必须重判
    QA('qa-aftersale', 'preset:aftersale', 'jev', OLD_CATEGORY_AT),
    // jev 打在**新位序**的类型上,categoryAt 在未来 → 只有 stamp 严格大于最大值才重判
    QA('qa-order-future', 'preset:order', 'jev', qaFuture),
    // 存量里的**尺码**标签 → 记录级选项集已不含尺码,旧标签必须重新归类
    QA('qa-size', 'preset:size', 'jev', OLD_CATEGORY_AT),
    // 人工摆过的:机器永不许覆盖,不进候选
    QA('qa-manual', 'preset:price', 'manual', OLD_CATEGORY_AT),
    // inherit 两边都不进:标签有效,而且问题文本与来源相同,重跑是白花钱
    QA('qa-inherit', 'preset:attribute', 'inherit', OLD_CATEGORY_AT),
    // 未分类 / 没跑过:恒进候选
    QA('qa-uncat', 'uncategorized', 'jev', OLD_CATEGORY_AT),
    QA('qa-null', undefined, undefined, undefined),
  ])

  await legacy.table('goldens').bulkAdd([
    // 标在预置类型上的标答:*被改名*的类型上的存量标答同样要重判
    {
      id: 'gd-labelled',
      folderId: null,
      question: '怎么开发票',
      answer: '在订单页申请',
      questionHash: 'hg1',
      hasEmbedding: 1,
      categoryId: 'preset:attribute',
      categorySource: 'jev',
      categoryAt: goldenFuture,
      createdAt: 1,
      updatedAt: 1,
    },
    // 人工摆在用户夹里的:manual,永不动
    {
      id: 'gd-manual',
      folderId: 'f-hot',
      question: '能便宜点吗',
      answer: '已经是最低价啦',
      questionHash: 'hg2',
      hasEmbedding: 1,
      categoryId: 'legacy:f-hot',
      categorySource: 'manual',
      categoryAt: OLD_CATEGORY_AT,
      createdAt: 1,
      updatedAt: 1,
    },
  ])

  legacy.close()
}

/** 旧预置行(名与判据都是重制前的;criteria 刻意留个可辨认的哨兵值「旧判据」) */
function OLD_PRESET(id: string, name: string, route: string, position: number) {
  return {
    id,
    name,
    criteria: '旧判据',
    kind: 'preset',
    route,
    filterable: true,
    position,
    createdAt: 1,
    updatedAt: 1,
  }
}

/** v8 从用户文件夹造出来的行:criteria 空串、filterable=false */
function LEGACY_FOLDER(id: string, name: string, position: number) {
  return {
    id,
    name,
    criteria: '',
    kind: 'custom',
    route: 'retrieve',
    filterable: false,
    position,
    createdAt: 1,
    updatedAt: 1,
  }
}

function QA(
  id: string,
  categoryId: string | undefined,
  categorySource: string | undefined,
  categoryAt: number | undefined,
) {
  return {
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
  }
}

/** 跑一遍 v8 → v9 升级(夹具造库 → 用真的 PddDatabase 打开) */
async function upgradeFromV8(
  maxIn: 'qaRecords' | 'goldens' = 'goldens',
  omit: string[] = [],
) {
  await Dexie.delete('PddCSDB')
  await seedLegacyV8(maxIn, omit)
  const upgraded = new PddDatabase()
  await upgraded.open()
  return upgraded
}

describe('v8 → v9 类型集重制', () => {
  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
  })

  it('v9:五个预置改名换判据、新增三条,尺码原样保留', async () => {
    const upgraded = await upgradeFromV8()

    // 复用的 id 换了名(判据不许还是夹具里那个旧值 —— 改名与换判据是同一件事)
    const renamed: Array<[string, string]> = [
      ['preset:attribute', '商品信息'],
      ['preset:price', '价格优惠'],
      ['preset:stock', '库存与规格'],
      ['preset:order', '发货与物流'],
      ['preset:aftersale', '退换货'],
    ]
    for (const [id, name] of renamed) {
      const cat = (await upgraded.categories.get(id))!
      expect(cat.name).toBe(name)
      expect(cat.criteria).not.toBe('旧判据')
      expect(cat.kind).toBe('preset')
      expect(cat.route).toBe('retrieve')
      expect(cat.filterable).toBe(true)
    }

    // 新增三条
    expect(await upgraded.categories.get('preset:payment')).toBeTruthy()
    expect(await upgraded.categories.get('preset:quality')).toBeTruthy()
    expect(await upgraded.categories.get('preset:other')).toBeTruthy()

    // 判据与常量同源(不是在迁移里重抄一份 —— 重抄就是给"两处不一致"留门)
    for (const cat of await upgraded.categories.toArray()) {
      if (cat.kind !== 'preset') continue
      const def = PRESET_CATEGORIES.find((p) => p.id === cat.id)!
      expect(def).toBeDefined()
      expect(cat.criteria).toBe(def.criteria)
      expect(cat.criteria).not.toBe('')
    }
    // 出口判据不是空串 —— 它就是「其他」这个桶存在的意义
    expect((await upgraded.categories.get('preset:other'))!.criteria).toContain('不属于')

    // 尺码:定义没变,但仍在,且还是**查询级专用**
    const size = (await upgraded.categories.get('preset:size'))!
    expect(size.name).toBe('尺码推荐')
    expect(size.route).toBe('size')
    expect(size.filterable).toBe(true)

    upgraded.close()
  })

  it('v9:八个记录级 position 0..7,尺码 8,非预置行被推到 >=9 且保序', async () => {
    const upgraded = await upgradeFromV8()

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
    for (let i = 0; i < RECORD_LEVEL.length; i++) {
      expect((await upgraded.categories.get(RECORD_LEVEL[i]))!.position).toBe(i)
    }
    expect((await upgraded.categories.get('preset:size'))!.position).toBe(8)

    // 自定义行整体让到预置段之后,相对顺序不变(迁移前:cat-old 6 < 双十一 100 < 其他 101 < 退换货 102)
    expect((await upgraded.categories.get('cat-old'))!.position).toBeGreaterThanOrEqual(9)
    expect((await upgraded.categories.get('cat-old'))!.position).toBe(9)
    expect((await upgraded.categories.get('legacy:f-hot'))!.position).toBe(10)
    expect((await upgraded.categories.get('legacy:f-other'))!.position).toBe(11)
    expect((await upgraded.categories.get('legacy:f-exchange'))!.position).toBe(12)
    // 未分类恒最后,不参与重排
    expect((await upgraded.categories.get('uncategorized'))!.position).toBe(9999)

    // 读路径上的真实排布:预置段 0..8,自定义段接在后面,未分类收尾
    // (不与预置同值 = 不会插进 售前→售中→售后 段内部)
    expect((await upgraded.listCategories()).map((c) => c.id)).toEqual([
      ...RECORD_LEVEL,
      'preset:size',
      'cat-old',
      'legacy:f-hot',
      'legacy:f-other',
      'legacy:f-exchange',
      'uncategorized',
    ])

    upgraded.close()
  })

  it('★ 名称撞车被让开:名叫「其他」/「退换货」的 legacy 行让出名字,全表名称仍唯一', async () => {
    const upgraded = await upgradeFromV8()

    const all = await upgraded.categories.toArray()
    const names = all.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)

    // 让开的是**旧行**:它还在(id 没变)、判据与 filterable 原样,只是改了名
    for (const [id, name] of [
      ['legacy:f-other', '其他(旧)'],
      ['legacy:f-exchange', '退换货(旧)'],
    ]) {
      const moved = (await upgraded.categories.get(id))!
      expect(moved.name).toBe(name)
      expect(moved.criteria).toBe('')
      expect(moved.kind).toBe('custom')
      expect(moved.filterable).toBe(false)
    }

    // 新预置拿到了正名,且出口判据没被那行的空串顶掉
    const other = (await upgraded.categories.get('preset:other'))!
    expect(other.name).toBe('其他')
    expect(other.criteria).not.toBe('')
    expect((await upgraded.categories.get('preset:aftersale'))!.name).toBe('退换货')

    upgraded.close()
  })

  it('★ updatedAt 严格大于记录 categoryAt —— 取等会让一条都不重跑', async () => {
    const upgraded = await upgradeFromV8()

    const { history, golden } = await upgraded.countBackfillCandidates()
    expect(history).toBe(EXPECTED_CANDIDATES.history)
    expect(golden).toBe(EXPECTED_CANDIDATES.golden)
    expect(history + golden).toBe(6)

    // stamp 是迁移闭包里的局部量,测试取不到 —— 用**可观测**形式钉同一条性质:
    // 被改过的类型的 updatedAt,严格大于挂在它上面的存量记录的 categoryAt。
    // 相等是陷阱(spec §5.4):v8 迁移**刻意**写成 updatedAt === categoryAt,为的是让
    // 存量记录**不**重跑;而判据是 `(categoryAt ?? 0) < updatedAt`,取等时 `<` 不成立 →
    // criteria 换了、旧标签原样留着(界面显示新类型,归类还是旧标准)。
    const cat = (await upgraded.categories.get('preset:aftersale'))!
    const rec = (await upgraded.qaRecords.get('qa-aftersale'))!
    expect(rec.categoryAt).toBe(OLD_CATEGORY_AT)
    expect(cat.updatedAt).toBeGreaterThan(rec.categoryAt!)

    // manual 的跳过、inherit 的跳过 —— 迁移不许把用户的摆放掀掉
    expect((await upgraded.categories.get('preset:price'))!.updatedAt).toBeGreaterThan(
      (await upgraded.qaRecords.get('qa-manual'))!.categoryAt!,
    )
    const snap = await upgraded.snapshotBackfillCandidates()
    expect(snap.history.map((r) => r.id)).not.toContain('qa-manual')
    expect(snap.history.map((r) => r.id)).not.toContain('qa-inherit')
    expect(snap.golden.map((r) => r.id)).not.toContain('gd-manual')

    upgraded.close()
  })

  it('★ 取最大值时两张表都读:最大 categoryAt 落在哪张表都算得对', async () => {
    // 两种摆法各钉一张表。只读一张的写法只会在"被漏掉那张表持有最大值"时露馅:
    // 那条记录的 categoryAt 会 ≥ stamp → 掉出候选 → 总数少一条。
    for (const maxIn of ['goldens', 'qaRecords'] as const) {
      const upgraded = await upgradeFromV8(maxIn)
      const { history, golden } = await upgraded.countBackfillCandidates()
      expect({ maxIn, history, golden }).toEqual({ maxIn, ...EXPECTED_CANDIDATES })
      upgraded.close()
    }
  })

  it('★ 存量里带尺码标签的记录进了补分类候选(尺码的 updatedAt 也顶了)', async () => {
    const upgraded = await upgradeFromV8()

    // 尺码的定义没变,但记录级选项集已不含它 —— 旧标签再也回不来,必须重判
    const snap = await upgraded.snapshotBackfillCandidates()
    expect(snap.history.map((r) => r.id)).toContain('qa-size')
    expect(snap.history.length).toBeGreaterThan(0)

    const size = (await upgraded.categories.get('preset:size'))!
    expect(size.updatedAt).toBeGreaterThan((await upgraded.qaRecords.get('qa-size'))!.categoryAt!)

    upgraded.close()
  })

  it('v9:库里缺了某个预置(手工修过)也能补上,且升级不抛错', async () => {
    // 打开成功本身就是断言:升级事务里抛错 = 整库打不开 = 扩展直接废掉,
    // 比"缺一行类型"严重得多。所以补行必须用 put,不能用 add。
    const upgraded = await upgradeFromV8('goldens', ['preset:stock'])

    const stock = (await upgraded.categories.get('preset:stock'))!
    expect(stock.name).toBe('库存与规格')
    expect(stock.kind).toBe('preset')
    expect(stock.route).toBe('retrieve')
    expect(stock.filterable).toBe(true)
    expect(stock.position).toBe(2)
    expect(stock.criteria).toBe(PRESET_CATEGORIES.find((p) => p.id === 'preset:stock')!.criteria)

    upgraded.close()
  })

  it('v9:一个都不删,记录一条都不改写', async () => {
    const upgraded = await upgradeFromV8()

    // 夹具 11 行 + 新增 3 行;id 集合只增不减(preset:size 保留是硬要求)
    expect((await upgraded.categories.toArray()).map((c) => c.id).sort()).toEqual([
      'cat-old',
      'legacy:f-exchange',
      'legacy:f-hot',
      'legacy:f-other',
      'preset:aftersale',
      'preset:attribute',
      'preset:order',
      'preset:other',
      'preset:payment',
      'preset:price',
      'preset:quality',
      'preset:size',
      'preset:stock',
      'uncategorized',
    ])

    // 迁移改的是类型行,不是记录行:标签、归属、原文分毫未动
    expect((await upgraded.qaRecords.get('qa-aftersale'))!.categoryId).toBe('preset:aftersale')
    expect((await upgraded.qaRecords.count())).toBe(7)
    const golden = (await upgraded.goldens.get('gd-manual'))!
    expect(golden.categoryId).toBe('legacy:f-hot')
    expect(golden.categorySource).toBe('manual')
    expect(golden.folderId).toBe('f-hot')

    upgraded.close()
  })
})
