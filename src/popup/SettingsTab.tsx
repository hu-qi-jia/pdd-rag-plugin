/**
 * 设置页(P3,设计文档 §7/§8):直接填充开关、唤起/候选切换快捷键、金标准优先、
 * 相似度/金标准/知识库阈值、保留期天数;导入/导出 v2(默认金标准+文件夹+设置,记忆可选);
 * 关于与合规说明。P0 自检卡按设计移除。
 * 复用组件:Card / Toggle / Slider / Btn / Notice(见 ui/components.tsx)。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessage } from '../shared/message-passing'
import type {
  BackfillPending,
  BackfillStatus,
  ClearMemoryDataResponse,
  ClearMetricsResponse,
  ExportDataResponse,
  GetBackfillStateResponse,
  GetStatsResponse,
  ImportDataResponse,
  StartBackfillResponse,
  StopBackfillResponse,
  UpdateSettingsResponse,
} from '../types/messages'
import type { HotkeyConfig, PddSettings } from '../types/memory'
import {
  Btn,
  CatNav,
  ChoiceGroup,
  IconBtn,
  Notice,
  Slider,
  Toggle,
  controlStyle,
  type CatNavItem,
  type NoticeMsg,
} from '../ui/components'
import {
  ActionBar,
  FieldRow,
  InfoHint,
  HotkeyRow,
  MetricGrid,
  NoteRow,
  SettingsSection,
  SubGroup,
} from '../ui/settings-kit'
import { controlH, fontSize, formGap, formType, size, spacing } from '../ui/design'
import {
  BotIcon,
  DatabaseIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  KeyIcon,
  LoaderIcon,
  SaveIcon,
  SlidersIcon,
  StatsIcon,
  TestIcon,
  UploadIcon,
} from '../ui/icons'
import { usageIsEmpty, usageRows } from './logic'
import {
  LLM_DRAFT_DEBOUNCE_MS,
  clearLlmDraft,
  loadLlmDraft,
  saveLlmDraft,
} from './llmDraft'
import {
  llmFormFromSettings,
  llmFormReady,
  type LlmFormFields,
  llmSettingsPatch,
  llmTestFailed,
  llmTestLabel,
  originsForBaseUrl,
  sameLlmFields,
  type LlmTestState,
} from '../pdd/llm-form'
import {
  JEV_DRAFT_DEBOUNCE_MS,
  clearJevDraft,
  loadJevDraft,
  saveJevDraft,
} from './jevDraft'
import {
  jevFormFromSettings,
  jevFormReady,
  type JevFormFields,
  jevSettingsPatch,
  jevTestFailed,
  jevTestLabel,
  sameJevFields,
  type JevTestState,
} from '../pdd/jev-form'
import {
  JEV_TIMEOUT_MAX_MS,
  JEV_TIMEOUT_MIN_MS,
  LLM_TIMEOUT_MAX_MS,
  LLM_TIMEOUT_MIN_MS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
} from '../shared/constants'
import type { TestJevResponse, TestLlmResponse } from '../types/messages'
import {
  THRESHOLD_TIER_LABELS,
  type RetentionChoice,
  type ThresholdKind,
  nearestThresholdTier,
  parseRetentionInput,
  retentionChoice,
  thresholdForTier,
} from './preferences'

/**
 * 补分类进度轮询间隔(ms)。补分类跑在 SW 里,弹窗关掉连接就没了 —— 面板靠轮询读
 * 后台单例状态,关/开弹窗都能如实反映,也不必管端口生命周期。
 */
const BACKFILL_POLL_MS = 500

/** 千位分隔(按钮文案的待办数要一眼读得出量级) */
function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** 目标主机:从设置里的 baseUrl 取 host(取不到就原样回退) */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }
}

/** 扩展版本:打包时写进 manifest;单测环境没有 chrome,取不到就留空 */
const EXT_VERSION = (() => {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return ''
  }
})()

/** 更新日志:点「打开」在新标签页里看 —— 弹窗本身不导航走,用户回来还在原页 */
const CHANGELOG_URL = 'https://github.com/hu-qi-jia/pdd-rag-plugin/blob/main/CHANGELOG.md'

/**
 * 设置页的**分页**索引:每一项是一整页,不再是一页里的滚动锚点。
 *
 * 分页之后每个模块可以独立长大(问题分类那边已经有七八行),不必再把所有分组
 * 挤进同一条长滚动里。标签取最短的一组:七个 chip 在 500 宽里能排成一行。
 */
const NAV_ITEMS: CatNavItem[] = [
  { id: 'set-search', label: '检索' },
  { id: 'set-ai', label: 'AI 整合' },
  { id: 'set-classify', label: '问题分类' },
  { id: 'set-data', label: '数据' },
  { id: 'set-stats', label: '统计' },
  { id: 'set-about', label: '关于' },
]

export function SettingsTab({ onDataChanged }: { onDataChanged: () => Promise<void> | void }) {
  const [draft, setDraft] = useState<PddSettings | null>(null)
  const [retentionMode, setRetentionMode] = useState<RetentionChoice | null>(null)
  const [retentionInput, setRetentionInput] = useState('')
  // 存储(PM6a):各表计数 + 浏览器存储用量估算
  const [stats, setStats] = useState<GetStatsResponse['payload'] | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // 重置使用统计的内联二次确认(v0.16,与 confirmClear 同一套做法)
  const [confirmResetUsage, setConfirmResetUsage] = useState(false)
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [busy, setBusy] = useState(false)
  const [includeMemory, setIncludeMemory] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── 分页导航:一次只渲染一页 ────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState(NAV_ITEMS[0].id)

  const jumpTo = useCallback((id: string) => {
    setActiveSection(id)
    // 换页回到顶部:上一页滚到一半的位置不该带到下一页
    const scroller = rootRef.current?.closest('.pddcs-scroll') as HTMLElement | null
    if (scroller) scroller.scrollTop = 0
  }, [])

  // ── AI 整合(第四十八轮 P2-6)──────────────────────────────────────────────
  // 三个文本框**不直接自动保存**:①API Key 不该每敲一个字符就落一次正式配置;
  // ②申请主机权限必须发生在用户手势里,只有"点保存"这一刻才有手势可用。
  // 于是本卡片是全页唯一的"显式保存"处(超时滑杆仍随大流即时落库)。
  //
  // 但**草稿**是边填边存的(见 popup/llmDraft.ts):弹窗失焦即被 Chrome 销毁,
  // 扩展拦不住 —— 用户"点窗口外面内容就没了"的抱怨由此而来。
  const [llm, setLlm] = useState<LlmFormFields | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<LlmTestState>({ phase: 'idle' })
  // 只在首次拿到设置时灌一次初值:此后 llm 是用户的输入,不被后台回写覆盖
  const llmSeeded = useRef(false)
  useEffect(() => {
    if (!draft || llmSeeded.current) return
    llmSeeded.current = true
    // 草稿优先:上次没保存就关掉的输入,原样还给用户
    void (async () => {
      const saved = await loadLlmDraft()
      setLlm(saved ?? llmFormFromSettings(draft))
    })()
  }, [draft])

  // 每次改动 300ms 后落一次草稿:既不会每敲一个字符就写一次存储,也不会因为
  // "刚敲完就被关掉"而丢字(300ms 远短于人手离开键盘去点窗口外的时间)
  const draftTimer = useRef<number>(0)
  const updateLlm = (patch: Partial<LlmFormFields>) => {
    setLlm((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      window.clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(() => void saveLlmDraft(next), LLM_DRAFT_DEBOUNCE_MS)
      return next
    })
  }
  // 卸载时掐掉挂起的那次落盘。弹窗本身被销毁时定时器随之消失,但切到别的页签
  // (设置页被卸载、弹窗还活着)时它会按时跑完 —— 迟到的草稿会盖掉此后发生的事。
  useEffect(() => () => window.clearTimeout(draftTimer.current), [])

  const llmDirty = !!draft && !!llm && !sameLlmFields(llm, llmFormFromSettings(draft))

  // ── 问题分类(第五十七轮 Task 3)──────────────────────────────────────────
  // 与「AI 整合」同构的另一套外部端点配置:**独立的**草稿 / 测试结论 / 保存路径。
  // 两块卡片同页相邻,任何状态都不能共用 —— 共用会让"改分类配置"把 AI 整合草稿顶掉。
  const [jev, setJev] = useState<JevFormFields | null>(null)
  const [showJevKey, setShowJevKey] = useState(false)
  const [jevTest, setJevTest] = useState<JevTestState>({ phase: 'idle' })
  // 只在首次拿到设置时灌一次初值(同 llmSeeded)
  const jevSeeded = useRef(false)
  useEffect(() => {
    if (!draft || jevSeeded.current) return
    jevSeeded.current = true
    void (async () => {
      const saved = await loadJevDraft()
      setJev(saved ?? jevFormFromSettings(draft))
    })()
  }, [draft])

  // 每次改动 300ms 后落一次 jev 草稿(与 llm 草稿同一套理由与同一档时长)
  const jevDraftTimer = useRef<number>(0)
  const updateJev = (patch: Partial<JevFormFields>) => {
    setJev((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      window.clearTimeout(jevDraftTimer.current)
      jevDraftTimer.current = window.setTimeout(
        () => void saveJevDraft(next),
        JEV_DRAFT_DEBOUNCE_MS,
      )
      return next
    })
  }
  useEffect(() => () => window.clearTimeout(jevDraftTimer.current), [])

  const jevDirty = !!draft && !!jev && !sameJevFields(jev, jevFormFromSettings(draft))

  // ── 补存量(第五十七轮 Task 4)────────────────────────────────────────────
  // 任务跑在 SW 里、状态留在后台单例:这里只**读**。挂载时读一次;若在跑,每 500ms
  // 轮询到 done 为止(卸载/跑完都清掉 interval)。用轮询不用 Port 的理由见文件顶注释。
  const [backfill, setBackfill] = useState<{
    status: BackfillStatus
    pending: BackfillPending
  } | null>(null)
  const pollTimer = useRef<number>(0)
  const polling = useRef(false)

  const readBackfill = useCallback(async () => {
    try {
      const resp = await sendMessage<GetBackfillStateResponse>({ type: 'GET_BACKFILL_STATE' })
      setBackfill(resp.payload)
      return resp.payload
    } catch {
      return null
    }
  }, [])

  const ensurePolling = useCallback(() => {
    if (polling.current) return
    polling.current = true
    const stop = () => {
      window.clearInterval(pollTimer.current)
      pollTimer.current = 0
      polling.current = false
    }
    pollTimer.current = window.setInterval(() => {
      void readBackfill().then((p) => {
        // 只在**明确读到**非 running 时收兵;读失败不误停(留待下一轮)
        if (p?.status && p.status.phase !== 'running') stop()
      })
    }, BACKFILL_POLL_MS)
  }, [readBackfill])

  useEffect(() => {
    let cancelled = false
    void readBackfill().then((p) => {
      if (!cancelled && p?.status?.phase === 'running') ensurePolling()
    })
    // 卸载必须掐掉 interval:否则定时器在弹窗关闭后继续打后台
    return () => {
      cancelled = true
      window.clearInterval(pollTimer.current)
      pollTimer.current = 0
      polling.current = false
    }
  }, [readBackfill, ensurePolling])

  const startBackfillNow = async () => {
    try {
      const resp = await sendMessage<StartBackfillResponse>({ type: 'START_BACKFILL' })
      await readBackfill() // 立刻回读一次,列表/按钮同步切到 running
      // started 为真就一定在跑:即便这次回读失败也起轮询,否则界面会误以为没启动
      if (resp.payload.started) ensurePolling()
      else if (resp.payload.error) setMsg({ ok: false, text: `补分类未能启动:${resp.payload.error}` })
    } catch (err) {
      setMsg({ ok: false, text: `补分类未能启动:${String(err)}` })
    }
  }

  const stopBackfillNow = async () => {
    try {
      await sendMessage<StopBackfillResponse>({ type: 'STOP_BACKFILL' })
    } catch {
      /* 中断失败不改本地状态:下一次轮询会读到真实进度 */
    }
  }

  const backfillStatus = backfill?.status ?? null
  const backfillRunning = backfillStatus?.phase === 'running'
  // 门禁与后台 startBackfill 同款(第三道"有类型可问"面板看不到,由后台兜底拒绝)
  const backfillReady = !!draft && draft.classifyEnabled && jevFormReady(jevFormFromSettings(draft))

  const refreshStorageInfo = useCallback(async () => {
    try {
      const resp = await sendMessage<GetStatsResponse>({ type: 'GET_STATS' })
      setDraft(resp.payload.settings)
      setStats(resp.payload)
    } catch (err) {
      setMsg({ ok: false, text: `读取设置失败:${String(err)}` })
    }
    try {
      const est = await navigator.storage.estimate()
      setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 })
    } catch {
      /* 无 estimate API:用量行不展示,计数仍可用 */
    }
  }, [])

  useEffect(() => {
    void refreshStorageInfo()
  }, [refreshStorageInfo])

  useEffect(() => {
    if (!draft) return
    const choice = retentionChoice(draft.retentionDays)
    setRetentionMode(choice)
    if (choice === 'custom') setRetentionInput(String(draft.retentionDays))
  }, [draft?.retentionDays])

  // 自动保存:开关/滑杆变更即时落库,弹窗随时可关不丢改动。
  // (真实 bug:此前依赖手动"保存设置",popup 失焦关闭后未保存的 draft 直接丢失。)
  const sliderTimer = useRef<number>(0)

  const persist = useCallback(
    async (next: PddSettings): Promise<PddSettings | null> => {
      window.clearTimeout(sliderTimer.current)
      setDraft(next)
      setBusy(true)
      try {
        const resp = await sendMessage<UpdateSettingsResponse>({
          type: 'UPDATE_SETTINGS',
          payload: next,
        })
        if (resp.payload.error) {
          setMsg({ ok: false, text: `保存失败:${resp.payload.error}` })
          return null
        }
        const saved = resp.payload.settings ?? next
        setDraft(saved)
        setMsg({ ok: true, text: '已保存' })
        await onDataChanged()
        // 返回**夹取后**的那份:调用方要拿它回填表单,不能拿自己提交的原始值
        // (后台会去尾斜杠、夹超时,回填原始值会让"已保存"的界面与真实配置对不上)
        return saved
      } catch (err) {
        setMsg({ ok: false, text: `保存失败:${String(err)}` })
        return null
      } finally {
        setBusy(false)
      }
    },
    [onDataChanged],
  )

  /** 滑杆:拖动即时反馈,detent 后 500ms 防抖落库 */
  const persistSlider = (patch: Partial<PddSettings>) => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    window.clearTimeout(sliderTimer.current)
    sliderTimer.current = window.setTimeout(() => {
      void persist(next)
    }, 500)
  }

  const commitCustomRetention = () => {
    if (!draft) return
    const days = parseRetentionInput(retentionInput)
    if (days === null) {
      setMsg({
        ok: false,
        text: `保留期请输入 ${RETENTION_MIN_DAYS}~${RETENTION_MAX_DAYS} 的整数天`,
      })
      return
    }
    void persist({ ...draft, retentionDays: days })
  }

  const thresholdChoice = (kind: ThresholdKind, value: number) =>
    nearestThresholdTier(kind, value)

  const thresholdOptions = (kind: ThresholdKind) =>
    THRESHOLD_TIER_LABELS.map((tier) => ({
      ...tier,
      title: `相似度 ${thresholdForTier(kind, tier.value)}`,
    }))

  /**
   * ⚠ 本函数与下方的 `saveJev` 是**刻意的平行实现**(两套独立的外部端点:AI 整合 / 问题分类,
   * 不同的外发通道与门禁,故意不共用组件)。改这里时必须**同时核对 `saveJev`**:
   *   ① 主机权限申请必须是用户手势里的**第一个 await**(MV3 gesture token 规则);
   *   ② 表单字段 → 设置字段的改名必须走 `*SettingsPatch`(llm 与 jev 各一份)。
   */
  /** 保存 AI 接口配置:先要权限、再落库(顺序不能反 —— 见 ensureHostPermission 注释) */
  const saveLlm = async () => {
    if (!draft || !llm) return
    setBusy(true)
    // 先掐掉挂起的草稿落盘:**保存后草稿是被清掉的**,若上一次敲字排的定时器
    // 还在,几百毫秒后它会把旧值又写回去 —— 再打开时框里是那份复活了的草稿,
    // 而不是刚保存的配置(差异会被后台夹取放大成"有未保存的修改")。
    window.clearTimeout(draftTimer.current)
    const origins = originsForBaseUrl(llm.baseUrl)
    const granted = origins.length > 0 ? await ensureHostPermission(llm.baseUrl) : true
    // 必须经 llmSettingsPatch 换名:表单叫 baseUrl、设置叫 llmBaseUrl,
    // 直接 `{...draft, ...llm}` 摊进去的话一个字段都落不了库(第四十八轮真实 bug)。
    const next = { ...draft, ...llmSettingsPatch(llm) }
    setTest({ phase: 'idle' }) // 改了配置,上一次的测试结论作废
    const saved = await persist(next)
    if (saved) {
      // 回填夹取后的值,并清掉草稿 —— 存住了就没有"未保存的改动"可言。
      // (不清的话,后台对 baseUrl 去尾斜杠这类夹取会让草稿永远比正式配置多一个斜杠,
      //  「有未保存的修改」从此常驻,用户怎么点保存都消不掉。)
      setLlm(llmFormFromSettings(saved))
      await clearLlmDraft()
    }
    if (!granted) {
      setMsg({
        ok: false,
        text: `已保存,但未授权访问 ${origins[0] ?? '该域名'} —— 整合时会直接失败,请重试并点「允许」`,
      })
    }
  }

  /** 测试连接:拿**表单里的草稿**去测(改了地址还没存的场景才是真正会踩的坑) */
  const testLlm = async () => {
    if (!llm) return
    const origins = originsForBaseUrl(llm.baseUrl)
    if (origins.length === 0) {
      setTest({ phase: 'fail', error: 'badurl' })
      return
    }
    setTest({ phase: 'testing' })
    const granted = await ensureHostPermission(llm.baseUrl)
    if (!granted) {
      setTest({ phase: 'fail', error: 'network' })
      setMsg({ ok: false, text: `未授权访问 ${origins[0]},请重试并点「允许」` })
      return
    }
    try {
      const resp = await sendMessage<TestLlmResponse>({
        type: 'TEST_LLM',
        payload: { ...llm, timeoutMs: draft?.llmTimeoutMs ?? LLM_TIMEOUT_MAX_MS },
      })
      setTest(
        resp.payload.ok
          ? { phase: 'ok' }
          : { phase: 'fail', error: resp.payload.error ?? 'unknown' },
      )
    } catch (err) {
      setTest({ phase: 'fail', error: String(err) })
    }
  }

  /**
   * ⚠ 本函数与上方的 `saveLlm` 是**刻意的平行实现**(两套独立的外部端点:AI 整合 / 问题分类,
   * 不同的外发通道与门禁,故意不共用组件)。改这里时必须**同时核对 `saveLlm`**:
   *   ① 主机权限申请必须是用户手势里的**第一个 await**(MV3 gesture token 规则);
   *   ② 表单字段 → 设置字段的改名必须走 `*SettingsPatch`(llm 与 jev 各一份)。
   */
  /** 保存分类接口配置:与 saveLlm 同一条路径 —— 先要权限、再落库(顺序不能反) */
  const saveJev = async () => {
    if (!draft || !jev) return
    setBusy(true)
    // 先掐掉挂起的草稿落盘:保存后草稿会被清掉,迟到的定时器会把旧值又写回去
    window.clearTimeout(jevDraftTimer.current)
    const origins = originsForBaseUrl(jev.baseUrl)
    const granted = origins.length > 0 ? await ensureHostPermission(jev.baseUrl) : true
    // 必须经 jevSettingsPatch 换名:表单叫 baseUrl、设置叫 jevBaseUrl
    const next = { ...draft, ...jevSettingsPatch(jev) }
    setJevTest({ phase: 'idle' }) // 改了配置,上一次的测试结论作废
    const saved = await persist(next)
    if (saved) {
      setJev(jevFormFromSettings(saved))
      await clearJevDraft()
    }
    if (!granted) {
      setMsg({
        ok: false,
        text: `已保存,但未授权访问 ${origins[0] ?? '该域名'} —— 分类时会直接失败,请重试并点「允许」`,
      })
    }
  }

  /** 测试连接:拿**表单里的草稿**去测(改了地址还没存的场景才是真正会踩的坑) */
  const testJev = async () => {
    if (!jev) return
    const origins = originsForBaseUrl(jev.baseUrl)
    if (origins.length === 0) {
      setJevTest({ phase: 'fail', error: 'badurl' })
      return
    }
    setJevTest({ phase: 'testing' })
    const granted = await ensureHostPermission(jev.baseUrl)
    if (!granted) {
      setJevTest({ phase: 'fail', error: 'network' })
      setMsg({ ok: false, text: `未授权访问 ${origins[0]},请重试并点「允许」` })
      return
    }
    try {
      const resp = await sendMessage<TestJevResponse>({
        type: 'TEST_JEV',
        payload: { ...jev, timeoutMs: draft?.jevTimeoutMs ?? JEV_TIMEOUT_MAX_MS },
      })
      setJevTest(
        resp.payload.ok
          ? { phase: 'ok' }
          : { phase: 'fail', error: resp.payload.error ?? 'unknown' },
      )
    } catch (err) {
      setJevTest({ phase: 'fail', error: String(err) })
    }
  }

  /** 清空问答记忆(PM6a):qa+replies 全清,长期资产保留;danger 二次确认 */
  const clearMemory = async () => {
    setBusy(true)
    try {
      const resp = await sendMessage<ClearMemoryDataResponse>({ type: 'CLEAR_MEMORY_DATA' })
      if (resp.payload.success) {
        setMsg({
          ok: true,
          text: `已清空 ${resp.payload.deletedQa} 条问答记录(标准回答/知识库/文件夹保留)`,
        })
      } else {
        setMsg({ ok: false, text: `清空失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `清空失败:${String(err)}` })
    } finally {
      setBusy(false)
      setConfirmClear(false)
    }
    await onDataChanged()
    await refreshStorageInfo()
  }

  /**
   * 重置使用统计(v0.16):只清计数器,任何业务数据都不动。
   * 这里给的是**内联二次确认**而不是弹窗 —— 与「清空问答数据」同一套做法
   * (弹窗式确认在本项目一律不做,见用户约定)。
   */
  const resetUsage = async () => {
    setBusy(true)
    try {
      const resp = await sendMessage<ClearMetricsResponse>({ type: 'CLEAR_METRICS' })
      if (resp.payload.success) {
        setMsg({ ok: true, text: `已重置 ${resp.payload.cleared} 项使用统计` })
      } else {
        setMsg({ ok: false, text: `重置失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `重置失败:${String(err)}` })
    } finally {
      setBusy(false)
      setConfirmResetUsage(false)
    }
    await refreshStorageInfo()
  }

  const exportJson = async () => {
    setBusy(true)
    try {
      const resp = await sendMessage<ExportDataResponse>({
        type: 'EXPORT_DATA',
        payload: { includeMemory },
      })
      if (resp.payload.error || !resp.payload.envelope) {
        setMsg({ ok: false, text: `导出失败:${resp.payload.error ?? '未知错误'}` })
        return
      }
      const blob = new Blob([JSON.stringify(resp.payload.envelope, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      a.href = url
      a.download = `pddcs-export-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
      setMsg({ ok: true, text: includeMemory ? '已导出(含记忆数据)' : '已导出(标准回答+文件夹+设置)' })
    } catch (err) {
      setMsg({ ok: false, text: `导出失败:${String(err)}` })
    } finally {
      setBusy(false)
    }
  }

  const importJson = async (file: File) => {
    setBusy(true)
    try {
      const envelope: unknown = JSON.parse(await file.text())
      const resp = await sendMessage<ImportDataResponse>({
        type: 'IMPORT_DATA',
        payload: { envelope },
      })
      const p = resp.payload
      if (p.error) {
        setMsg({ ok: false, text: `导入失败:${p.error}` })
        return
      }
      setMsg({
        ok: true,
        text: `导入完成:标准回答 +${p.addedGoldens ?? 0}(跳过 ${p.skippedGoldens ?? 0}${
          (p.limitedGoldens ?? 0) > 0 ? `,超每问题上限 ${p.limitedGoldens}` : ''
        }) · 类型 +${p.addedCategories ?? 0}(跳过 ${p.skippedCategories ?? 0}) · 文件夹 +${p.addedFolders ?? 0} · 知识 +${p.addedKnowledge ?? 0}(跳过 ${p.skippedKnowledge ?? 0}) · 文档原文 +${p.addedKbDocs ?? 0} · 问答 +${p.addedQa ?? 0} · 回复 +${p.addedReplies ?? 0};向量后台重嵌`,
      })
      await onDataChanged()
    } catch {
      setMsg({ ok: false, text: '导入失败:不是有效的 JSON 文件' })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!draft) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: formGap.row }}>
        {/* 占位文字同样走 formType.desc 档(设置页不允许出现规范外的字号) */}
        <div style={{ fontSize: formType.desc.size, fontWeight: formType.desc.weight, color: 'var(--pddcs-text-tertiary)' }}>
          读取中…
        </div>
        <Notice msg={msg} onDismiss={() => setMsg(null)} />
      </div>
    )
  }

  return (
    // 分区之间**不再额外吃 gap**:分区头自带 28px 上间距,再叠一层 16px 会变成 44px。
    // 但底部要留一口气:最后一个分区(关于)不能贴着滚动区的下缘。
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', paddingBottom: spacing.xxl }}
    >
      <Notice msg={msg} onDismiss={() => setMsg(null)} />
      <div className="pddcs-settings-nav" style={{ padding: `0 ${spacing.xxl}px ${spacing.xl}px` }}>
        {/* 与「标准回答」页同一套分类导航:横向 pill、选中走 accentSoft。
            七个固定项必须一屏排下 —— 这里把 chip 的横向内边距收窄一档(见 CSS),
            否则最后一项「关于」会被挤到滚动区外。 */}
        <CatNav items={NAV_ITEMS} value={activeSection} onChange={jumpTo} />
      </div>

      {activeSection === 'set-search' && (
        <SettingsSection
          id="set-search"
          icon={<SlidersIcon size={16} strokeWidth={2} />}
          title="检索与填充"
          summary={`${draft.directFillEnabled ? '直接填充' : '弹面板选择'} · 保留 ${draft.retentionDays} 天`}
        >
          <Toggle
            label="自动回复"
            desc="开:直接填充第一条;关:弹面板人工选择"
            checked={draft.directFillEnabled}
            onChange={(v) => void persist({ ...draft, directFillEnabled: v })}
          />
          <HotkeyRow
            hotkey={draft.autoReplyHotkey}
            onChange={(hk) => void persist({ ...draft, autoReplyHotkey: hk })}
          />
          <HotkeyRow
            label="候选切换键"
            desc="推荐面板打开时按此键在候选间循环切换(可用单键)"
            allowPlainKey
            hotkey={draft.panelNavHotkey}
            onChange={(hk) => void persist({ ...draft, panelNavHotkey: hk })}
          />
          <Toggle
            label="标准回答优先"
            desc="标准回答命中时置顶"
            checked={draft.goldenPriorityEnabled}
            onChange={(v) => void persist({ ...draft, goldenPriorityEnabled: v })}
          />
          <SubGroup label="相似度阈值" />
          <ChoiceGroup
            label="历史相似度"
            value={thresholdChoice('history', draft.simThreshold)}
            options={thresholdOptions('history')}
            onChange={(tier) =>
              void persist({ ...draft, simThreshold: thresholdForTier('history', tier) })
            }
          />
          <ChoiceGroup
            label="标准回答阈值"
            value={thresholdChoice('golden', draft.goldenThreshold)}
            options={thresholdOptions('golden')}
            onChange={(tier) =>
              void persist({ ...draft, goldenThreshold: thresholdForTier('golden', tier) })
            }
          />
          <ChoiceGroup
            label="知识库阈值"
            value={thresholdChoice('knowledge', draft.kbThreshold)}
            options={thresholdOptions('knowledge')}
            onChange={(tier) =>
              void persist({ ...draft, kbThreshold: thresholdForTier('knowledge', tier) })
            }
          />
          <SubGroup label="数据保留" />
          <ChoiceGroup
            label="保留期"
            value={retentionMode ?? retentionChoice(draft.retentionDays)}
            options={[
              { value: '7' as const, label: '7天' },
              { value: '30' as const, label: '30天' },
              { value: '90' as const, label: '90天' },
              { value: 'custom' as const, label: '自定义' },
            ]}
            onChange={(choice) => {
              // 选中态必须跟着点击走,不能只靠下面那个同步 effect:draft 的保留期没变时
              //(例如自定义 90 天再点回「90天」)effect 的依赖不变、不重跑,档位会卡在"自定义"
              setRetentionMode(choice)
              if (choice === 'custom') {
                setRetentionInput(String(draft.retentionDays))
                return
              }
              void persist({ ...draft, retentionDays: Number(choice) })
            }}
          />
          {retentionMode === 'custom' && (
            <FieldRow label="自定义保留期">
              <input
                aria-label="自定义保留天数"
                className="pddcs-input"
                type="number"
                min={RETENTION_MIN_DAYS}
                max={RETENTION_MAX_DAYS}
                step={1}
                value={retentionInput}
                onChange={(event) => setRetentionInput(event.target.value)}
                onBlur={commitCustomRetention}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCustomRetention()
                }}
                style={{ width: 88, height: controlH.form }}
              />
              <span style={{ fontSize: fontSize.cap, color: 'var(--pddcs-text-tertiary)' }}>
                天({RETENTION_MIN_DAYS}~{RETENTION_MAX_DAYS})
              </span>
            </FieldRow>
          )}
        </SettingsSection>
      )}

      {/* ⚠ 本卡与下面的「问题分类」卡是**刻意的平行实现**(不同的外发通道与门禁,故意不共用
          组件)。改这里的结构/状态时必须**同时核对那张卡**:① 主机权限申请必须是手势里的
          第一个 await;② 字段改名必须走 `*SettingsPatch`。 */}
      {activeSection === 'set-ai' && (
        <SettingsSection
          id="set-ai"
          icon={<BotIcon size={16} strokeWidth={2} />}
          title="AI 整合"
          summary={`${draft.aiIntegrateEnabled ? '已开启' : '已关闭'} · ${
            llmFormReady(llmFormFromSettings(draft)) ? '已配置' : '未配置'
          }`}
        >
          <Toggle
            label="AI 整合"
            desc="点击候选上方生成可直接发送的话术"
            checked={draft.aiIntegrateEnabled}
            onChange={(v) => void persist({ ...draft, aiIntegrateEnabled: v })}
          />

          {/* 数据边界那三句解释已删(v3.0 做减法):「什么会外发」属于全工具的统一口径,
              写在「关于」卡一处即可 —— 每张能联网的卡各说一遍,等于哪儿都没说清。
              这里只保留**会改变行为的自检**:与「自动回复」互斥这件事是操作性的,
              不说用户只会以为功能坏了(ADR-0006 的外发边界原样留在 ADR 与关于卡里) */}
          {draft.directFillEnabled && (
            <NoteRow tone="danger">
              <span>当前已开启「自动回复」,AI 整合不会生效。</span>
            </NoteRow>
          )}

          {/* 滑杆读秒、设置存毫秒 —— 这里是两者**唯一**的换算点(第五十二轮修)。
              此前 value 喂的是毫秒(8000)、min/max 却是秒(2~30):值恒大于上限,浏览器把滑块
              钉在最右端,每次拖动刚算出的新值又超上限、又被钉回去 —— 观感就是"拖不动",
              读数还写着「8000 秒」。修法是让两侧同单位,而不是把 min/max 抬到毫秒。 */}
          <Slider
            label="整合超时"
            value={draft.llmTimeoutMs / 1000}
            min={LLM_TIMEOUT_MIN_MS / 1000}
            max={LLM_TIMEOUT_MAX_MS / 1000}
            step={1}
            onChange={(v) => persistSlider({ llmTimeoutMs: v * 1000 })}
            format={(v) => `${v} 秒`}
          />

          <FieldRow label="接口地址">
            <input
              className="pddcs-input"
              style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
              value={llm?.baseUrl ?? ''}
              onChange={(e) => updateLlm({ baseUrl: e.target.value })}
            />
          </FieldRow>

          <FieldRow label="API Key">
            <input
              className="pddcs-input"
              style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
              type={showKey ? 'text' : 'password'}
              value={llm?.apiKey ?? ''}
              onChange={(e) => updateLlm({ apiKey: e.target.value })}
            />
            <IconBtn
              title={showKey ? '隐藏 API Key' : '显示 API Key'}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? (
                <EyeOffIcon size={size.iconBtn} strokeWidth={2} />
              ) : (
                <EyeIcon size={size.iconBtn} strokeWidth={2} />
              )}
            </IconBtn>
          </FieldRow>

          <FieldRow label="模型名">
            <input
              className="pddcs-input"
              style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
              placeholder="deepseek-chat"
              spellCheck={false}
              value={llm?.model ?? ''}
              onChange={(e) => updateLlm({ model: e.target.value })}
            />
          </FieldRow>

          <ActionBar
            status={
              test.phase !== 'idle' && (
                <span style={{ color: llmTestFailed(test) ? 'var(--pddcs-danger)' : undefined }}>
                  {llmTestLabel(test)}
                </span>
              )
            }
          >
            {/* 顺序固定:次要动作在左、主动作在最右。保存钮只在有改动时才是主钮 */}
            <Btn
              disabled={busy || test.phase === 'testing' || !llmFormReady(llm ?? { baseUrl: '', apiKey: '', model: '' })}
              title="用当前填写的地址与模型发一次最小请求,验证是否可用"
              onClick={() => void testLlm()}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {/* 只在途时给转圈;成功/失败的结论交给左侧那行文字,不进按钮(免得读成"✕ 测试连接") */}
                {test.phase === 'testing' ? (
                  <LoaderIcon size={size.icon} strokeWidth={2} />
                ) : (
                  <TestIcon size={size.icon} strokeWidth={2} />
                )}
                测试连接
              </span>
            </Btn>
            <Btn
              /* 主钮态绑在"有事可做"上:没有未保存改动时它是描边钮,有改动才变实心蓝。
                 顺带把"我改了没保存"从一句灰字变成了一眼可见 */
              variant={llmDirty ? 'primary' : 'default'}
              disabled={busy || !llmDirty}
              title={llmDirty ? '保存接口配置' : '没有改动'}
              onClick={() => void saveLlm()}
            >
              <SaveIcon size={size.icon} strokeWidth={2} />
              保存
            </Btn>
          </ActionBar>

          {/* 两处"配了但不会生效"的自查提示:开启未配置 / 改了没保存,都是静默失效的重灾区 */}
          {draft.aiIntegrateEnabled && !llmFormReady(llmFormFromSettings(draft)) && (
              <NoteRow tone="danger">
                <span>已开启,但接口地址 / API Key / 模型名尚未填全,推荐面板不会出现整合行。</span>
              </NoteRow>
            )}
          {llmDirty && (
            <NoteRow>
              <span>有未保存的修改。</span>
            </NoteRow>
          )}
        </SettingsSection>
      )}

      {/* 问题分类(第五十七轮 Task 3):结构逐段对应上面的「AI 整合」——
          同一套显式保存(草稿边填边存、点保存才落库)与「测试连接」就地结论。
          ⚠ 本卡与「AI 整合」卡是**刻意的平行实现**(不同的外发通道与门禁,故意不共用组件)。
          改这里的结构/状态时必须**同时核对那张卡**:① 主机权限申请必须是手势里的第一个
          await;② 字段改名必须走 `*SettingsPatch`。 */}
      {activeSection === 'set-classify' && (
        <SettingsSection
          id="set-classify"
          icon={<KeyIcon size={16} strokeWidth={2} />}
          title="问题分类"
          summary={`${draft.classifyEnabled ? '已开启' : '已关闭'} · ${
            jevFormReady(jevFormFromSettings(draft)) ? '已配置' : '未配置'
          }`}
        >
          <Toggle
            label="自动分类"
            desc="自动归类；开启后每次检索也会发送问题文本"
            checked={draft.classifyEnabled}
            onChange={(v) => void persist({ ...draft, classifyEnabled: v })}
          />

          {/* 与「AI 整合」卡同一条口径(v3.0 做减法):外发内容的**三类字段明细**留在
              ADR-0007 与「关于」卡一处,不往设置页搬。

              但**频率**必须留在开关自己身上(第六十七轮补):这个开关同时管两件量级
              差很远的事 —— 「记录在后台被归个类」(每条记录一次)与「每次检索都过一趟
              第三方」(每小时可能几十次)。原来的 desc 只写了前者,用户是在不知情的
              情况下接受了后者。「关于」卡说的是"会外发问题文本",仍然没说"每次搜索都发"。
              拆成两个开关是更彻底的解法,但那是行为变更;先把知情这一条补上 */}

          {/* 滑杆读秒、设置存毫秒 —— 与 AI 区同一条单位换算坑(第五十二轮修):
              Slider 的 value/min/max 必须与 format 同单位,否则值恒超上限、看起来"拖不动"。 */}
          <Slider
            label="分类超时"
            value={draft.jevTimeoutMs / 1000}
            min={JEV_TIMEOUT_MIN_MS / 1000}
            max={JEV_TIMEOUT_MAX_MS / 1000}
            step={1}
            onChange={(v) => persistSlider({ jevTimeoutMs: v * 1000 })}
            format={(v) => `${v} 秒`}
          />

          {/* 概率阈值(spec §7.3 / §9.3「概率阈值 0.2」):分类结果低于此值的类型不进类型集合。
              spec §十七把"默认值拍脑袋"列为高危风险、缓解措施是"P2 实测后回调" —— 没有入口
              这个旋钮就永远回调不了。与其它阈值滑杆同构:0~1、step 0.05、两位小数。
              0 是**合法值**(=不按阈值过滤),settings.ts 的夹取用 Number.isFinite 判、不会把 0 当假值。 */}
          <Slider
            label="概率阈值"
            value={draft.classifyProbThreshold}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => persistSlider({ classifyProbThreshold: v })}
            format={(v) => v.toFixed(2)}
          />

          <FieldRow label="接口地址">
            <input
              className="pddcs-input"
              style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
              placeholder="https://api.typesafe.ai"
              spellCheck={false}
              value={jev?.baseUrl ?? ''}
              onChange={(e) => updateJev({ baseUrl: e.target.value })}
            />
          </FieldRow>

          <FieldRow label="API Key">
            <input
              className="pddcs-input"
              style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
              type={showJevKey ? 'text' : 'password'}
              value={jev?.apiKey ?? ''}
              onChange={(e) => updateJev({ apiKey: e.target.value })}
            />
            <IconBtn
              title={showJevKey ? '隐藏 API Key' : '显示 API Key'}
              onClick={() => setShowJevKey((v) => !v)}
            >
              {showJevKey ? (
                <EyeOffIcon size={size.iconBtn} strokeWidth={2} />
              ) : (
                <EyeIcon size={size.iconBtn} strokeWidth={2} />
              )}
            </IconBtn>
          </FieldRow>

          <FieldRow label="模型名">
            <input
              className="pddcs-input"
              style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
              placeholder="jev-latest"
              spellCheck={false}
              value={jev?.model ?? ''}
              onChange={(e) => updateJev({ model: e.target.value })}
            />
          </FieldRow>

          {/* 与「AI 整合」卡的保存/测试行**逐字对应** —— 这一行曾经是裸 flex div,
              比它上面那张卡的同名行少了 16px 内边距与下缘发丝线,两张"平行实现"的卡
              在视觉上因此不对称 */}
          <ActionBar
            status={
              jevTest.phase !== 'idle' && (
                <span style={{ color: jevTestFailed(jevTest) ? 'var(--pddcs-danger)' : undefined }}>
                  {jevTestLabel(jevTest)}
                </span>
              )
            }
          >
            <Btn
              disabled={
                busy ||
                jevTest.phase === 'testing' ||
                !jevFormReady(jev ?? { baseUrl: '', apiKey: '', model: '' })
              }
              title="用当前填写的地址与模型发一次最小请求,验证是否可用"
              onClick={() => void testJev()}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {jevTest.phase === 'testing' ? (
                  <LoaderIcon size={size.icon} strokeWidth={2} />
                ) : (
                  <TestIcon size={size.icon} strokeWidth={2} />
                )}
                测试连接
              </span>
            </Btn>
            <Btn
              variant={jevDirty ? 'primary' : 'default'}
              disabled={busy || !jevDirty}
              title={jevDirty ? '保存分类接口配置' : '没有改动'}
              onClick={() => void saveJev()}
            >
              <SaveIcon size={size.icon} strokeWidth={2} />
              保存
            </Btn>
          </ActionBar>

          {/* 两处"配了但不会生效"的自查提示(同 AI 区):开启未配置 / 改了没保存 */}
          {draft.classifyEnabled && !jevFormReady(jevFormFromSettings(draft)) && (
            <NoteRow tone="danger">
              <span>已开启,但接口地址 / API Key / 模型名尚未填全,分类不会生效。</span>
            </NoteRow>
          )}
          {jevDirty && (
            <NoteRow>
              <span>有未保存的修改。</span>
            </NoteRow>
          )}

          {/* 补存量(第五十七轮 Task 4):跑在 SW 里、关弹窗也继续 —— 状态从后台轮询读回。
              待办数来自 GET_BACKFILL_STATE 的 pending(与快照同口径,manual 不计入)。

              版式:标题与按钮同一行,知情行**占满整行**。以前知情行和按钮挤在一行里,
              只剩 ~250px,一句"将把 N 条…发送到 host(不含任何回复内容)"要被折成三行。 */}
          <div className="pddcs-srow pddcs-srow-blk pddcs-hair">
            <div className="pddcs-srow-lead">
              <span className="n">
                存量补分类
                {/* 知情行(发多少条、发到哪)收进 ⓘ:句子留在 DOM 里(读屏与断言都拿得到),
                    视觉上悬浮/聚焦才展开 —— 否则这句要在按钮旁边折成三行。 */}
                {(backfillReady || backfillStatus?.phase === 'done') && (
                  <InfoHint label="本次发送量说明">
                    {`将把 ${fmtCount(backfill?.pending.history ?? 0)} 条历史问题 + ${fmtCount(
                      backfill?.pending.golden ?? 0,
                    )} 条标准回答的问题发送到 ${hostOf(draft.jevBaseUrl)}(不含任何回复内容)`}
                  </InfoHint>
                )}
              </span>
              {backfillRunning ? (
                <Btn
                  variant="danger"
                  onClick={() => void stopBackfillNow()}
                  title="中断本轮,已跑完的结果保留"
                >
                  中断
                </Btn>
              ) : (
                <Btn
                  variant="primary"
                  disabled={busy || !backfillReady}
                  title={backfillReady ? '把存量历史与标准回答的问题送去做一次分类' : '先开启自动分类并填全配置'}
                  onClick={() => void startBackfillNow()}
                >
                  开始分类全部历史
                </Btn>
              )}
            </div>
            {backfillRunning && backfillStatus && (
              <span className="d pddcs-num">
                进度 {backfillStatus.done} / {backfillStatus.total}
              </span>
            )}
            {backfillRunning && (
              <span className="d">正在补分类,可随时中断;已跑完的条目会保留。</span>
            )}
            {!backfillRunning && backfillStatus?.phase === 'done' && (
              <span className="d">
                {`成功 ${backfillStatus.ok} · 失败 ${backfillStatus.failed} · 跳过 ${backfillStatus.skipped}${
                  backfillStatus.stopped ? '(已中断,未跑完)' : ''
                }`}
              </span>
            )}
            {!backfillRunning && backfillStatus?.phase !== 'done' && !backfillReady && (
              <span className="d" style={{ color: 'var(--pddcs-danger)' }}>
                先开启自动分类并填全配置
              </span>
            )}
          </div>
        </SettingsSection>
      )}

      {activeSection === 'set-data' && (
        <SettingsSection
          id="set-data"
          icon={<DatabaseIcon size={16} strokeWidth={2} />}
          title="数据"
          summary={storage ? `已用 ${fmtBytes(storage.usage)}` : undefined}
        >
          <Toggle
            label="导出包含记忆数据"
            desc="额外导出问答记录与回复"
            checked={includeMemory}
            onChange={setIncludeMemory}
          />
          <ActionBar>
            <Btn disabled={busy} onClick={() => fileRef.current?.click()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <UploadIcon size={size.icon} strokeWidth={2} />导入 JSON
              </span>
            </Btn>
            <Btn variant="primary" disabled={busy} onClick={() => void exportJson()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <DownloadIcon size={size.icon} strokeWidth={2} />导出 JSON
              </span>
            </Btn>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importJson(f)
              }}
            />
          </ActionBar>
          <SubGroup label="本机数据" />
          <div className="pddcs-srow pddcs-hair">
            <span className="pddcs-srow-label">
              <span className="n">本地数据</span>
              <span className="d pddcs-num">
                {stats
                  ? `问答 ${stats.qaCount} · 回复 ${stats.replyCount} · 标准回答 ${stats.goldenCount} · 知识 ${stats.knowledgeCount} · 文件夹 ${stats.folderCount}`
                  : '读取中…'}
              </span>
            </span>
          </div>
          <div className="pddcs-srow pddcs-hair">
            <span className="pddcs-srow-label">
              <span className="n">已用空间</span>
              <span className="d">浏览器配额内的本地估算</span>
            </span>
            <span className="pddcs-srow-value">
              {storage && storage.quota > 0
                ? `${fmtBytes(storage.usage)} / ${fmtBytes(storage.quota)}`
                : '—'}
            </span>
          </div>
          <ActionBar
            status={
              confirmClear && (
                <span style={{ color: 'var(--pddcs-danger)' }}>
                  清空全部问答与回复?标准回答/知识库/文件夹保留。
                </span>
              )
            }
          >
            {confirmClear ? (
              <>
                <Btn variant="ghost" onClick={() => setConfirmClear(false)}>
                  取消
                </Btn>
                <Btn variant="danger" disabled={busy} onClick={() => void clearMemory()}>
                  确认清空
                </Btn>
              </>
            ) : (
              <Btn variant="danger" onClick={() => setConfirmClear(true)}>
                清空问答数据
              </Btn>
            )}
          </ActionBar>
        </SettingsSection>
      )}

      {/*
        使用统计(v0.16):回答"这工具到底帮没帮上忙"。全部本地计数,不联网、不随导出外发。
        只在有数时展开 —— 新装的库给一排 0 既没信息量,又让人怀疑是不是坏了。
        统计项是"数字 + 名字",用两列瓦片比逐行排省一半高度。
      */}
      {activeSection === 'set-stats' && (
        <SettingsSection
          id="set-stats"
          icon={<StatsIcon size={16} strokeWidth={2} />}
          title="使用统计"
          summary="只存本机"
        >
          {usageIsEmpty(stats?.metrics) ? (
            <NoteRow>
              <span>还没有使用记录</span>
            </NoteRow>
          ) : (
            <MetricGrid
              items={usageRows(stats?.metrics).map((row, index) => ({
                ...row,
                wide: index === 0,
              }))}
            />
          )}
          <ActionBar
            status={
              confirmResetUsage && <span>重置为 0?问答/标准回答/知识库都不受影响。</span>
            }
          >
            {confirmResetUsage ? (
              <>
                <Btn variant="ghost" onClick={() => setConfirmResetUsage(false)}>
                  取消
                </Btn>
                <Btn variant="danger" disabled={busy} onClick={() => void resetUsage()}>
                  确认重置
                </Btn>
              </>
            ) : (
              <Btn variant="default" onClick={() => setConfirmResetUsage(true)}>
                重置统计
              </Btn>
            )}
          </ActionBar>
        </SettingsSection>
      )}

      {/*
        关于(v3.0 精简):原来那一段 150 字,把"合规声明"与"数据边界"混在一坨里,
        读的人要么全读要么全不读。现在压成两行 —— 一行一件事,
        外发边界从此**只在这里讲一次**(各联网卡片不再各说一遍)。
      */}
      {activeSection === 'set-about' && (
        <SettingsSection
          id="set-about"
          icon={<InfoIcon size={16} strokeWidth={2} />}
          title="关于"
        >
          <div
            className="pddcs-srow pddcs-srow-blk pddcs-hair"
            data-tone="muted"
            style={{ lineHeight: 1.75 }}
          >
            <span>只填充，不代发；数据仅存本机。</span>
            <span>默认不联网；外发仅限问题文本，回复正文不外发。</span>
          </div>
          <div className="pddcs-srow pddcs-hair">
            <span className="pddcs-srow-label">
              <span className="n">版本</span>
              <span className="d">拼多多客服快捷回复</span>
            </span>
            <span className="pddcs-srow-value">{EXT_VERSION || '—'}</span>
          </div>
          <div className="pddcs-srow pddcs-hair">
            <span className="pddcs-srow-label">
              <span className="n">更新日志</span>
              <span className="d">在 GitHub 上查看每个版本改了什么</span>
            </span>
            <Btn
              onClick={() => window.open(CHANGELOG_URL, '_blank', 'noopener,noreferrer')}
              title="在新标签页打开 GitHub 上的 CHANGELOG.md"
            >
              打开
            </Btn>
          </div>
        </SettingsSection>
      )}
    </div>
  )
}

/**
 * 申请访问该地址所在域名的权限(MV3 optional_host_permissions)。
 *
 * **调用点必须是用户手势里的第一个 await** —— 之前不能有任何 await,
 * 否则手势令牌失效,request() 会直接抛错。故这里不做"先 contains 再 request"的
 * 预检(那次查询本身就是个 await):已授权时 request() 本就立即返回 true,不弹窗。
 */
async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  const origins = originsForBaseUrl(baseUrl)
  if (origins.length === 0) return false
  try {
    return await chrome.permissions.request({ origins })
  } catch {
    return false
  }
}

/** 字节 → 人类可读(KB/MB/GB,一位小数) */
function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`
  return `${n} B`
}
