// 补分类后台状态机单测(第五十七轮 Task 4)。
//
// 这组用例钉住 `backfillState.ts` 的四件事:
//  ① **门禁先于一切 IO**:开关关 / 未配 key / 无类型可问 —— 任一条不成立都一次 fetch 都不发,
//     状态回 idle 并带 error(ADR-0007 "未配置时保持完全本地"的落点);
//  ② **单例状态可读**:running 时能读到进度,结束时落 done 且带最终计数;
//  ③ **重入保护**:已在跑时再调 startBackfill 直接返回,不启第二组 worker;
//  ④ **中断 + 复位**:requestBackfillStop 让本轮停下(stopped 为真),下一次调用标志复位能跑满。
//
// 每个用例用 `vi.resetModules()` 重新导入被测模块 —— 模块级单例状态必须逐例清零,
// 否则上一个用例留下的 `running`/`done` 会污染下一个。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/constants'
import type { PddSettings } from '../../../src/types/memory'

vi.mock('../../../src/background/settings', () => ({ loadSettings: vi.fn() }))
vi.mock('../../../src/background/db', () => ({
  db: { listCategories: vi.fn(), countBackfillCandidates: vi.fn() },
}))

type Mod = typeof import('../../../src/background/backfillState')
type Deps = NonNullable<Parameters<Mod['startBackfill']>[0]>
type Snapshot = NonNullable<Deps['snapshot']>

let mod: Mod
let settingsMock: ReturnType<typeof vi.fn>
let dbMock: { listCategories: ReturnType<typeof vi.fn>; countBackfillCandidates: ReturnType<typeof vi.fn> }
let fetchMock: ReturnType<typeof vi.fn>

/** 配置齐全的设置:门禁全过的默认底子 */
const CONFIGURED: PddSettings = {
  ...DEFAULT_SETTINGS,
  classifyEnabled: true,
  jevBaseUrl: 'https://api.typesafe.ai',
  jevApiKey: 'sk-jev',
  jevModel: 'jev-latest',
}

const CATS = [{ id: 'preset:order', name: '订单物流', criteria: '发货时间、催发货…', filterable: true }]

function items(n: number): Array<{ id: string; question: string }> {
  return Array.from({ length: n }, (_, i) => ({ id: `qa-${i}`, question: `问题${i}` }))
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      answers: {
        category: { type: 'choice', choice: '订单物流', probabilities: { 订单物流: 0.9 }, confidence: 0.8 },
      },
    }),
    { status: 200 },
  )
}

const emptySnapshot: Snapshot = async () => ({ history: [], golden: [] })

/**
 * 注入可控的快照与写回 —— 这组测的是状态机编排,不触真库。
 * 写回返回 1(= Dexie 更新到 1 行),否则默认实现会去调 mock 里不存在的 db.update* 而计 skipped。
 */
function depsFor(snapshot: Snapshot): Deps {
  return {
    snapshot,
    writeHistory: async () => 1,
    writeGolden: async () => 1,
    config: { baseUrl: 'https://api.typesafe.ai', apiKey: 'k', model: 'jev-latest', timeoutMs: 3000 },
    categories: [{ id: 'preset:order', name: '订单物流', criteria: '发货…' }],
    threshold: 0.2,
  }
}

beforeEach(async () => {
  vi.resetModules()
  fetchMock = vi.fn(async () => okResponse())
  vi.stubGlobal('fetch', fetchMock)

  mod = await import('../../../src/background/backfillState')
  const settings = await import('../../../src/background/settings')
  const dbMod = await import('../../../src/background/db')
  settingsMock = settings.loadSettings as unknown as ReturnType<typeof vi.fn>
  dbMock = dbMod.db as unknown as typeof dbMock

  settingsMock.mockResolvedValue(CONFIGURED)
  dbMock.listCategories.mockResolvedValue(CATS)
  dbMock.countBackfillCandidates.mockResolvedValue({ history: 5, golden: 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('补分类后台状态', () => {
  it('初始为 idle,计数为 0', () => {
    expect(mod.getBackfillStatus()).toMatchObject({
      phase: 'idle',
      total: 0,
      done: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
    })
  })

  it('getBackfillStatus 返回拷贝,调用方改它不影响内部状态', () => {
    const s = mod.getBackfillStatus()
    s.phase = 'done'
    s.total = 999
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'idle', total: 0 })
  })

  it('★ 未配置时 startBackfill 不发请求,状态置 idle 且带 error(三条门禁各来一遍)', async () => {
    // 每条断言**该门禁独有的 error 文案**,并统计 loadSettings 调用次数 —— 若某条门禁被删,
    // 或第一次拒绝后 `busy` 没释放(第二次在入口短路),这里立刻红,而不是被第一次的状态掩盖。

    // ① 开关关
    settingsMock.mockResolvedValue({ ...CONFIGURED, classifyEnabled: false })
    let r = await mod.startBackfill()
    expect(r).toEqual({ started: false, error: '自动分类未开启' })
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'idle', error: '自动分类未开启' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbMock.countBackfillCandidates).not.toHaveBeenCalled()

    // ② 开关开但 key 没填(未配置)
    settingsMock.mockResolvedValue({ ...CONFIGURED, jevApiKey: '' })
    r = await mod.startBackfill()
    expect(r).toEqual({ started: false, error: '分类接口未配置' })
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'idle', error: '分类接口未配置' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbMock.countBackfillCandidates).not.toHaveBeenCalled()

    // ③ 配置全但没有任何可问类型(先恢复成配置齐全,否则会再次落在门禁②)
    settingsMock.mockResolvedValue(CONFIGURED)
    dbMock.listCategories.mockResolvedValue([])
    r = await mod.startBackfill()
    expect(r).toEqual({ started: false, error: '没有可用于分类的问题类型' })
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'idle', error: '没有可用于分类的问题类型' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbMock.countBackfillCandidates).not.toHaveBeenCalled()

    // 三次拒绝都必须真的走到门禁判断(而不是在重入锁上短路)
    expect(settingsMock).toHaveBeenCalledTimes(3)
  })

  it('★ 一次拒绝不会把重入锁锁死:拒绝之后仍能正常启动', async () => {
    // 门禁③可达(面板看不到"有没有类型可问",按钮照样可点):拒绝路径必须释放 busy,
    // 否则后续 startBackfill 会在入口静默返回 {started:false}(且无 error),按钮按下去没反应。
    dbMock.listCategories.mockResolvedValueOnce([])
    const refused = await mod.startBackfill()
    expect(refused.started).toBe(false)

    // 修好门禁条件后应能真正启动并跑完
    dbMock.listCategories.mockResolvedValue(CATS)
    const started = await mod.startBackfill(depsFor(emptySnapshot))
    expect(started.started).toBe(true)
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
  })

  it('跑起来时 phase 为 running,总数与待办计数同源', async () => {
    let release: (() => void) | undefined
    const hanging: Snapshot = () =>
      new Promise((res) => {
        release = () => res({ history: [], golden: [] })
      })

    const r = await mod.startBackfill(depsFor(hanging))
    expect(r.started).toBe(true)
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'running', total: 5 })

    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release!()
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
  })

  it('进度随每条完成推进,done 最终等于 total', async () => {
    const resolvers: Array<() => void> = []
    fetchMock.mockImplementation(
      () => new Promise<Response>((res) => resolvers.push(() => res(okResponse()))),
    )

    void mod.startBackfill(depsFor(async () => ({ history: items(3), golden: [] })))
    // 3 条 < 并发上限 5:三个 worker 应一次把请求全发出去
    await vi.waitFor(() => expect(resolvers).toHaveLength(3))
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'running', done: 0, total: 3, ok: 0 })

    resolvers.forEach((fn) => fn())
    await vi.waitFor(() => expect(mod.getBackfillStatus().done).toBe(3))
    expect(mod.getBackfillStatus()).toMatchObject({
      phase: 'done',
      total: 3,
      done: 3,
      ok: 3,
      failed: 0,
      skipped: 0,
    })
  })

  it('★ 已在跑时再点一次不会起第二个 —— 用快照调用次数证明', async () => {
    let release!: () => void
    const snapshot = vi.fn(
      () =>
        new Promise<{ history: Array<{ id: string; question: string }>; golden: never[] }>((res) => {
          release = () => res({ history: [], golden: [] })
        }),
    )

    const first = await mod.startBackfill(depsFor(snapshot))
    expect(first.started).toBe(true)
    const second = await mod.startBackfill(depsFor(snapshot))
    expect(second.started).toBe(false)
    // 关键:只取过一次快照 —— 第二次调用压根没进运行路径
    expect(snapshot).toHaveBeenCalledTimes(1)

    release()
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
  })

  it('单条失败不把整批标记成失败(phase 仍 done,计数里有 failed)', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return body.state === '问题1' ? new Response('{}', { status: 500 }) : okResponse()
    })

    void mod.startBackfill(depsFor(async () => ({ history: items(4), golden: [] })))
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
    expect(mod.getBackfillStatus()).toMatchObject({
      phase: 'done',
      total: 4,
      done: 4,
      ok: 3,
      failed: 1,
    })
  })

  it('requestBackfillStop 中断本轮(done 且 stopped),下一轮标志复位能跑满', async () => {
    // 每条约 5ms:给"中断"留出可观测的窗口
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return okResponse()
    })

    await mod.startBackfill(depsFor(async () => ({ history: items(40), golden: [] })))
    mod.requestBackfillStop()
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
    expect(mod.getBackfillStatus().stopped).toBe(true)
    expect(mod.getBackfillStatus().done).toBeLessThan(40)

    // 第二轮:上一轮的 stop 标志必须已复位,否则会刚起步就停
    fetchMock.mockImplementation(async () => okResponse())
    await mod.startBackfill(depsFor(async () => ({ history: items(40), golden: [] })))
    await vi.waitFor(() => expect(mod.getBackfillStatus().done).toBe(40))
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'done', done: 40, stopped: false })
  })

  it('运行期异常也落到 done(带 error),不会永远停在 running', async () => {
    const r = await mod.startBackfill({
      snapshot: async () => {
        throw new Error('boom')
      },
    })
    expect(r.started).toBe(true)
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
    expect(mod.getBackfillStatus().error).toContain('boom')
  })

  it('没有候选 → 不发请求,phase done、total 0', async () => {
    void mod.startBackfill({ snapshot: emptySnapshot })
    await vi.waitFor(() => expect(mod.getBackfillStatus().phase).toBe('done'))
    expect(mod.getBackfillStatus()).toMatchObject({ phase: 'done', total: 0, done: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // GET_BACKFILL_STATE 的 pending 重算挂在 index.ts 的 handler 上,那个文件单测挂不起来
  // (import 即触 chrome)。逻辑抽到 refreshBackfillPending 后在这里钉死:回退成"每轮都重算"
  // 或"永不重算",下面两条断言都会红。
  it('★ done/idle 重算待办计数,running 期不重算(面板每秒轮询,不能全表白扫)', async () => {
    dbMock.countBackfillCandidates.mockResolvedValue({ history: 7, golden: 2 })

    expect(await mod.refreshBackfillPending('idle')).toEqual({ history: 7, golden: 2 })
    expect(await mod.refreshBackfillPending('done')).toEqual({ history: 7, golden: 2 })
    expect(dbMock.countBackfillCandidates).toHaveBeenCalledTimes(2)

    // running:返回 undefined,调用方沿用旧计数 —— 一次库读都不该发生
    expect(await mod.refreshBackfillPending('running')).toBeUndefined()
    expect(dbMock.countBackfillCandidates).toHaveBeenCalledTimes(2)
  })
})
