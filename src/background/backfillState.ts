/**
 * 补分类的**后台状态机**(第五十七轮 Task 4)。
 *
 * 面板不持有任务:补分类跑在 SW 里,弹窗关掉连接就没了。这里留一份模块级单例状态,
 * 面板用 `GET_BACKFILL_STATE` 轮询读回 —— 关/开弹窗都能如实反映,也不必处理端口生命周期。
 *
 * 分工:门禁(`classifyEnabled` + `isJevConfigured` + 有可问类型)只在这里判一次,
 * 是唯一入口 —— `runBackfill` 明确约定"调用方负责门禁",自己不再重复判。任一条不成立
 * 就直接返回、**一次 fetch 都不发**(ADR-0007:未配置时扩展保持完全本地)。
 */
import {
  classifiableCategories,
  runBackfill,
  type BackfillProgress,
} from './classify'
import { db } from './db'
import { loadSettings } from './settings'
import { isJevConfigured, jevConfigFromSettings } from './jev'
import type { BackfillStatus } from '../types/messages/classify'

/** runBackfill 的注入项(测试透传用) */
export type RunBackfillDeps = NonNullable<Parameters<typeof runBackfill>[0]['deps']>

const IDLE: BackfillStatus = {
  phase: 'idle',
  total: 0,
  done: 0,
  ok: 0,
  failed: 0,
  skipped: 0,
}

/** 模块级单例:同一时刻至多一份补分类状态 */
let status: BackfillStatus = { ...IDLE }
/** 中断标志:作为 `shouldStop()` 的返回值喂给 runBackfill;每次启动前复位 */
let stopRequested = false
/** 重入锁:从进门到跑完一直为真,期间再调 startBackfill 直接返回 */
let busy = false

/** 返回一份**拷贝** —— 免得调用方(消息层)改到内部状态 */
export function getBackfillStatus(): BackfillStatus {
  return { ...status }
}

/** 请求中断当前这一轮:worker 在下一轮循环顶部看到 `shouldStop()` 为真即退出 */
export function requestBackfillStop(): void {
  stopRequested = true
}

/**
 * 门禁未过(或门禁查询抛错):状态回 idle 并带上原因,不发任何请求。
 *
 * **必须清 `busy`**:拒绝路径不会走 `runToCompletion` 的 `finally`,漏清就会把重入锁
 * 永久留在锁死状态 —— 此后每次 `startBackfill()` 都在入口短路返回 `{started:false}`
 * 且不带 error,面板按钮按下去毫无反应(静默死锁)。
 */
function refuse(error: string): { started: false; error: string } {
  busy = false
  status = { ...IDLE, error }
  return { started: false, error }
}

/**
 * 启动补分类。**先判门禁、再谈别的**:门禁不过直接返回,一次网络请求都不发。
 * 已在跑时直接返回,不启第二组 worker。
 *
 * 不 await 整轮结束 —— 状态写在单例里,调用方(消息 handler)立即拿到 `started` 返回,
 * 面板靠轮询跟进进度。
 */
export async function startBackfill(
  deps?: RunBackfillDeps,
): Promise<{ started: boolean; error?: string }> {
  // 重入保护:在跑时直接返回,不启第二组 worker
  if (busy) return { started: false }
  busy = true

  try {
    // ── 门禁:任一条不成立就返回,不发任何请求 ──────────────────────────────
    const settings = await loadSettings()
    if (!settings.classifyEnabled) return refuse('自动分类未开启')
    const config = jevConfigFromSettings(settings)
    if (!isJevConfigured(config)) return refuse('分类接口未配置')
    const options = classifiableCategories(await db.listCategories())
    if (options.length === 0) return refuse('没有可用于分类的问题类型')

    // 总数与快照同口径:manual 在快照阶段已排除,不计入
    const counts = await db.countBackfillCandidates()
    status = { ...IDLE, phase: 'running', total: counts.history + counts.golden }

    // 复位上一次的 stop:陈旧的 true 会让本轮刚起步就停
    stopRequested = false
    void runToCompletion(deps)
    return { started: true }
  } catch (err) {
    // 门禁查询本身出错(读设置/读库):同样不发请求,落 idle + error
    return refuse(String(err))
  }
}

/**
 * 真正跑的那一轮。fire-and-forget —— 状态写进单例,面板轮询读。
 * `try/catch` 保证**任何**路径最终都落到 `done`:异常绝不让 status 永远停在 running。
 */
async function runToCompletion(deps?: RunBackfillDeps): Promise<void> {
  try {
    const final = await runBackfill({
      onProgress: (p: BackfillProgress) => {
        status = { ...status, ...p }
      },
      shouldStop: () => stopRequested,
      deps,
    })
    // 只有"还没跑完就收到了 stop"才算被中断;跑满后收尾时的 stop 不算
    const stopped = stopRequested && final.done < final.total
    status = { ...status, ...final, phase: 'done', stopped, error: undefined }
  } catch (err) {
    const stopped = stopRequested
    status = { ...status, phase: 'done', stopped, error: String(err) }
  } finally {
    busy = false
  }
}
