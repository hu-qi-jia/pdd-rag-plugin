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
  Notice,
  Section,
  Slider,
  Toggle,
  controlStyle,
  type NoticeMsg,
} from '../ui/components'
import { controlH, fontSize, formGap, formType, radius, size, spacing } from '../ui/design'
import { DownloadIcon, LoaderIcon, PencilIcon, UploadIcon } from '../ui/icons'
import { formatHotkey, isModifierOnly } from '../shared/hotkey'
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
import { JEV_TIMEOUT_MAX_MS, JEV_TIMEOUT_MIN_MS, LLM_TIMEOUT_MAX_MS, LLM_TIMEOUT_MIN_MS } from '../shared/constants'
import type { TestJevResponse, TestLlmResponse } from '../types/messages'
import { usageIsEmpty, usageRows } from './logic'

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

export function SettingsTab({ onDataChanged }: { onDataChanged: () => Promise<void> | void }) {
  const [draft, setDraft] = useState<PddSettings | null>(null)
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
    // 分区之间**不再额外吃 gap**:分区标题自带 26px 上间距,再叠一层 16px 会变成 42px
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Notice msg={msg} onDismiss={() => setMsg(null)} />

      <Section title="检索与填充">
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
        <Slider
          label="历史相似度阈值"
          value={draft.simThreshold}
          min={0.3}
          max={0.9}
          step={0.05}
          onChange={(v) => persistSlider({ simThreshold: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="标准回答阈值(放宽)"
          value={draft.goldenThreshold}
          min={0.2}
          max={0.8}
          step={0.05}
          onChange={(v) => persistSlider({ goldenThreshold: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="知识库阈值(放宽)"
          value={draft.kbThreshold}
          min={0.2}
          max={0.8}
          step={0.05}
          onChange={(v) => persistSlider({ kbThreshold: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="保留期天数"
          value={draft.retentionDays}
          min={30}
          max={365}
          step={5}
          onChange={(v) => persistSlider({ retentionDays: v })}
          format={(v) => `${v} 天`}
        />
      </Section>

      {/* ⚠ 本卡与下面的「问题分类」卡是**刻意的平行实现**(不同的外发通道与门禁,故意不共用
          组件)。改这里的结构/状态时必须**同时核对那张卡**:① 主机权限申请必须是手势里的
          第一个 await;② 字段改名必须走 `*SettingsPatch`。 */}
      <Section title="AI 整合">
        <Toggle
          label="AI 整合"
          desc="开启后,推荐面板的知识库候选上方多一行「根据知识库内容整合并回复」,点击才生成"
          checked={draft.aiIntegrateEnabled}
          onChange={(v) => void persist({ ...draft, aiIntegrateEnabled: v })}
        />

        {/* 数据边界那三句解释已删(v3.0 做减法):「什么会外发」属于全工具的统一口径,
            写在「关于」卡一处即可 —— 每张能联网的卡各说一遍,等于哪儿都没说清。
            这里只保留**会改变行为的自检**:与「自动回复」互斥这件事是操作性的,
            不说用户只会以为功能坏了(ADR-0006 的外发边界原样留在 ADR 与关于卡里) */}
        {draft.directFillEnabled && (
          <div className="pddcs-srow pddcs-srow-blk pddcs-hair" style={{ color: 'var(--pddcs-danger)' }}>
            当前已开启「自动回复」,AI 整合不会生效。
          </div>
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

        <Field label="接口地址">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
            placeholder="https://api.deepseek.com/v1"
            spellCheck={false}
            value={llm?.baseUrl ?? ''}
            onChange={(e) => updateLlm({ baseUrl: e.target.value })}
          />
        </Field>

        <Field label="API Key">
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
          <Btn variant="ghost" onClick={() => setShowKey((v) => !v)}>
            {showKey ? '隐藏' : '显示'}
          </Btn>
        </Field>

        <Field label="模型名">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
            placeholder="deepseek-chat"
            spellCheck={false}
            value={llm?.model ?? ''}
            onChange={(e) => updateLlm({ model: e.target.value })}
          />
        </Field>

        <div className="pddcs-srow pddcs-srow-wrap pddcs-hair">
          <Btn
            /* 主钮态绑在"有事可做"上:**主钮态绑在"有事可做"上** ——
               没有未保存改动时它是个描边钮,有改动才变墨底白字。
               顺带把"我改了没保存"从一句灰字变成了一眼可见 */
            variant={llmDirty ? 'primary' : 'default'}
            disabled={busy || !llmDirty}
            title={llmDirty ? '保存接口配置' : '没有改动'}
            onClick={() => void saveLlm()}
          >
            保存
          </Btn>
          <Btn
            disabled={busy || test.phase === 'testing' || !llmFormReady(llm ?? { baseUrl: '', apiKey: '', model: '' })}
            title="用当前填写的地址与模型发一次最小请求,验证是否可用"
            onClick={() => void testLlm()}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {/* 只在途时给转圈;成功/失败的结论交给右侧那行文字,不进按钮(免得读成"✕ 测试连接") */}
              {test.phase === 'testing' && <LoaderIcon size={size.icon} strokeWidth={2} />}
              测试连接
            </span>
          </Btn>
          {/* 测试结论就地显示在按钮右侧(不弹 toast:用户正盯着这一行等结果) */}
          {test.phase !== 'idle' && (
            <span
              style={{
                fontSize: formType.desc.size,
                fontWeight: formType.desc.weight,
                color: test.phase === 'ok' ? 'var(--pddcs-text-tertiary)' : llmTestFailed(test) ? 'var(--pddcs-danger)' : 'var(--pddcs-text-tertiary)',
                lineHeight: 1.5,
              }}
            >
              {llmTestLabel(test)}
            </span>
          )}
        </div>

        {/* 两处"配了但不会生效"的自查提示:开启未配置 / 改了没保存,都是静默失效的重灾区 */}
        {draft.aiIntegrateEnabled && !llmFormReady(llmFormFromSettings(draft)) && (
            <div className="pddcs-srow pddcs-srow-blk pddcs-hair" style={{ color: 'var(--pddcs-danger)' }}>
              已开启,但接口地址 / API Key / 模型名尚未填全,推荐面板不会出现整合行。
            </div>
          )}
        {llmDirty && (
          <div className="pddcs-srow pddcs-srow-blk pddcs-hair" style={{ color: 'var(--pddcs-text-tertiary)' }}>
            有未保存的修改。
          </div>
        )}
      </Section>

      {/* 问题分类(第五十七轮 Task 3):结构逐段对应上面的「AI 整合」——
          同一套显式保存(草稿边填边存、点保存才落库)与「测试连接」就地结论。
          ⚠ 本卡与「AI 整合」卡是**刻意的平行实现**(不同的外发通道与门禁,故意不共用组件)。
          改这里的结构/状态时必须**同时核对那张卡**:① 主机权限申请必须是手势里的第一个
          await;② 字段改名必须走 `*SettingsPatch`。 */}
      <Section title="问题分类">
        <Toggle
          label="自动分类"
          desc="开启后,新捕获的问答与手工新建的标准回答会自动归类;但检索也会调这个接口 —— 每次搜索都会把问题文本发往接口,并按判出的类型收窄检索范围。存量历史要在下方点一次按钮"
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

        <Field label="接口地址">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
            placeholder="https://api.typesafe.ai"
            spellCheck={false}
            value={jev?.baseUrl ?? ''}
            onChange={(e) => updateJev({ baseUrl: e.target.value })}
          />
        </Field>

        <Field label="API Key">
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
          <Btn variant="ghost" onClick={() => setShowJevKey((v) => !v)}>
            {showJevKey ? '隐藏' : '显示'}
          </Btn>
        </Field>

        <Field label="模型名">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(controlH.form), flex: 1, minWidth: 0 }}
            placeholder="jev-latest"
            spellCheck={false}
            value={jev?.model ?? ''}
            onChange={(e) => updateJev({ model: e.target.value })}
          />
        </Field>

        {/* 与「AI 整合」卡的保存/测试行**逐字对应** —— 这一行曾经是裸 flex div,
            比它上面那张卡的同名行少了 16px 内边距与下缘发丝线,两张"平行实现"的卡
            在视觉上因此不对称 */}
        <div className="pddcs-srow pddcs-srow-wrap pddcs-hair">
          <Btn
            variant={jevDirty ? 'primary' : 'default'}
            disabled={busy || !jevDirty}
            title={jevDirty ? '保存分类接口配置' : '没有改动'}
            onClick={() => void saveJev()}
          >
            保存
          </Btn>
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
              {jevTest.phase === 'testing' && <LoaderIcon size={size.icon} strokeWidth={2} />}
              测试连接
            </span>
          </Btn>
          {/* 测试结论就地显示在按钮右侧(不弹 toast:用户正盯着这一行等结果) */}
          {jevTest.phase !== 'idle' && (
            <span
              style={{
                fontSize: formType.desc.size,
                fontWeight: formType.desc.weight,
                color:
                  jevTest.phase === 'ok'
                    ? 'var(--pddcs-text-tertiary)'
                    : jevTestFailed(jevTest)
                      ? 'var(--pddcs-danger)'
                      : 'var(--pddcs-text-tertiary)',
                lineHeight: 1.5,
              }}
            >
              {jevTestLabel(jevTest)}
            </span>
          )}
        </div>

        {/* 两处"配了但不会生效"的自查提示(同 AI 区):开启未配置 / 改了没保存 */}
        {draft.classifyEnabled && !jevFormReady(jevFormFromSettings(draft)) && (
          <div className="pddcs-srow pddcs-srow-blk pddcs-hair" style={{ color: 'var(--pddcs-danger)' }}>
            已开启,但接口地址 / API Key / 模型名尚未填全,分类不会生效。
          </div>
        )}
        {jevDirty && (
          <div className="pddcs-srow pddcs-srow-blk pddcs-hair" style={{ color: 'var(--pddcs-text-tertiary)' }}>
            有未保存的修改。
          </div>
        )}

        {/* 补存量(第五十七轮 Task 4):跑在 SW 里、关弹窗也继续 —— 状态从后台轮询读回。
            待办数来自 GET_BACKFILL_STATE 的 pending(与快照同口径,manual 不计入)。 */}
        {/* 这一块同样是「一行小标题 + 行」里的一行:内边距与发丝线跟别的行一样。
            块内两段之间的关系由下面这枚 marginBottom 给(块式行里 span 是块级,
            相互间距见 popup-css `.pddcs-srow-blk > span + span`) */}
        <div className="pddcs-srow pddcs-srow-blk pddcs-hair">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.sm,
              flexWrap: 'wrap',
              marginBottom: formGap.labelControl,
            }}
          >
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
            {backfillRunning && backfillStatus && (
              <span
                // 进度是数字读数:与页面上其它数字(计数、时间戳、滑杆读数)同走 .pddcs-num
                className="pddcs-num"
                style={{
                  fontSize: formType.desc.size,
                  fontWeight: formType.desc.weight,
                  color: 'var(--pddcs-text-tertiary)',
                }}
              >
                {backfillStatus.done} / {backfillStatus.total}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: formType.desc.size,
              fontWeight: formType.desc.weight,
              color:
                !backfillReady && !backfillRunning && backfillStatus?.phase !== 'done'
                  ? 'var(--pddcs-danger)'
                  : 'var(--pddcs-text-tertiary)',
              lineHeight: 1.6,
            }}
          >
            {backfillRunning
              ? '正在补分类,可随时中断;已跑完的条目会保留。'
              : backfillStatus?.phase === 'done'
                ? `成功 ${backfillStatus.ok} · 失败 ${backfillStatus.failed} · 跳过 ${backfillStatus.skipped}${
                    backfillStatus.stopped ? '(已中断,未跑完)' : ''
                  }`
                : backfillReady
                  ? `将把 ${fmtCount(backfill?.pending.history ?? 0)} 条历史问题 + ${fmtCount(
                      backfill?.pending.golden ?? 0,
                    )} 条标准回答的问题发送到 ${hostOf(draft.jevBaseUrl)}(不含任何回复内容)`
                  : '先开启自动分类并填全配置'}
          </span>
          {/* done 态必须**同时**保留知情行(ADR-0007 / spec §11.1 / 决策 D7:按钮文案先算条数)。
              轮询到 done 就停了,后台在 done 这个转换点补算一次 pending —— 这里把这行与完成
              报告并排渲染:报告回答"刚刚跑得怎么样",预览行回答"下一次会外发多少"。缺了它,
              同一会话里第二次点「开始分类全部历史」就是在没有条数的情况下开始的。 */}
          {backfillStatus?.phase === 'done' && backfillReady && (
            <span
              style={{
                fontSize: formType.desc.size,
                fontWeight: formType.desc.weight,
                color: 'var(--pddcs-text-tertiary)',
                lineHeight: 1.6,
              }}
            >
              {`将把 ${fmtCount(backfill?.pending.history ?? 0)} 条历史问题 + ${fmtCount(
                backfill?.pending.golden ?? 0,
              )} 条标准回答的问题发送到 ${hostOf(draft.jevBaseUrl)}(不含任何回复内容)`}
            </span>
          )}
        </div>
      </Section>

      <Section title="导入与导出">
        <Toggle
          label="导出包含记忆数据"
          desc="额外导出问答记录与回复"
          checked={includeMemory}
          onChange={setIncludeMemory}
        />
        <div className="pddcs-srow pddcs-hair">
          <Btn variant="primary" disabled={busy} onClick={() => void exportJson()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <DownloadIcon size={size.icon} strokeWidth={2} />导出 JSON
            </span>
          </Btn>
          <Btn disabled={busy} onClick={() => fileRef.current?.click()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UploadIcon size={size.icon} strokeWidth={2} />导入 JSON
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
        </div>
      </Section>

      <Section title="存储">
        <div className="pddcs-srow pddcs-hair">
          <span
            // 计数一整排都是数字:等宽 + 表格数字走 .pddcs-num 单点,
            // 不再各写一份 'ui-monospace, Consolas, monospace'
            className="pddcs-srow-label pddcs-num"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: `4px ${formGap.row}px`,
              color: 'var(--pddcs-text-tertiary)',
            }}
          >
          {stats && (
            <>
              <span>问答 {stats.qaCount}</span>
              <span>回复 {stats.replyCount}</span>
              <span>标准回答 {stats.goldenCount}</span>
              <span>知识 {stats.knowledgeCount}</span>
              <span>文件夹 {stats.folderCount}</span>
            </>
          )}
          {storage && storage.quota > 0 && (
            <span>
              已用 {fmtBytes(storage.usage)}(配额约 {fmtBytes(storage.quota)})
            </span>
          )}
          </span>
        </div>
        <div className="pddcs-srow pddcs-hair">
          {confirmClear ? (
            <>
              <span
                style={{
                  fontSize: formType.desc.size,
                  fontWeight: formType.desc.weight,
                  color: 'var(--pddcs-danger)',
                }}
              >
                清空全部问答与回复?标准回答/知识库/文件夹保留。
              </span>
              <Btn variant="danger" disabled={busy} onClick={() => void clearMemory()}>
                确认清空
              </Btn>
              <Btn variant="ghost" onClick={() => setConfirmClear(false)}>
                取消
              </Btn>
            </>
          ) : (
            <Btn variant="danger" onClick={() => setConfirmClear(true)}>
              清空问答数据
            </Btn>
          )}
        </div>
      </Section>

      {/*
        使用统计(v0.16):回答"这工具到底帮没帮上忙"。全部本地计数,不联网、不随导出外发。
        只在有数时展开 —— 新装的库给一排 0 既没信息量,又让人怀疑是不是坏了。
      */}
      <Section title="使用统计">
        {usageIsEmpty(stats?.metrics) ? (
          <div className="pddcs-srow pddcs-hair" style={{ color: 'var(--pddcs-text-tertiary)' }}>
            还没有使用记录
          </div>
        ) : (
          // 这里曾经外裹一个 gap:16px 的列容器 —— 行自带 12px 内边距与下缘发丝线,
          // 再插一层行距会把发丝线从行底"浮"起来(线下面一段空档,像是分隔了别的东西)。
          // 与 v4.1 修设置页时删掉的那批 gap 是同一个毛病,漏了这一处。
          <>
            {usageRows(stats?.metrics).map((r) => (
              // 同一套设置行:标签在左、数值在右(数值走等宽,一列数字竖着扫得下去)
              <div className="pddcs-srow pddcs-hair" key={r.key}>
                <span className="pddcs-srow-label">
                  <span className="n">{r.label}</span>
                </span>
                <span className="pddcs-srow-value">{r.value}</span>
              </div>
            ))}
          </>
        )}
        <div className="pddcs-srow pddcs-hair">
          {confirmResetUsage ? (
            <>
              <span
                style={{
                  fontSize: formType.desc.size,
                  fontWeight: formType.desc.weight,
                  color: 'var(--pddcs-text-tertiary)',
                }}
              >
                重置为 0?问答/标准回答/知识库都不受影响。
              </span>
              <Btn variant="ghost" disabled={busy} onClick={() => void resetUsage()}>
                确认重置
              </Btn>
              <Btn variant="ghost" onClick={() => setConfirmResetUsage(false)}>
                取消
              </Btn>
            </>
          ) : (
            <Btn variant="ghost" onClick={() => setConfirmResetUsage(true)}>
              重置统计
            </Btn>
          )}
          <span
            style={{
              fontSize: formType.desc.size,
              fontWeight: formType.desc.weight,
              color: 'var(--pddcs-text-tertiary)',
            }}
          >
            只记在本机,不联网、不随导出外发。
          </span>
        </div>
      </Section>

      {/*
        关于(v3.0 精简):原来那一段 150 字,把"合规声明"与"数据边界"混在一坨里,
        读的人要么全读要么全不读。现在压成三行 —— 一行一件事,
        外发边界从此**只在这里讲一次**(各联网卡片不再各说一遍)。
      */}
      <Section title="关于">
        <div
          className="pddcs-srow pddcs-srow-blk pddcs-hair"
          style={{ color: 'var(--pddcs-text-tertiary)', lineHeight: 1.75 }}
        >
          <span>只读取聊天页内容、只填官方输入框 —— 发送始终由你手动完成。</span>
          <span>全部数据仅存本机 IndexedDB;嵌入模型已内置,离线可用,无任何远程下载。</span>
          <span>
            默认全程不联网。只有你亲手配置接口、打开「AI 整合」或「自动分类」,
            才会把<strong>问题文本</strong>与你配置的接口通信;回复正文与标准回答正文永不外发。
          </span>
        </div>
      </Section>
    </div>
  )
}


// ─── AI 整合:带标签的输入行 ─────────────────────────────────────────────────────

/**
 * 文本框行(标签 / 控件两件套),与 Toggle、Slider、HotkeyRow 同构:
 * 字号走 formType、标签与控件的间距走 formGap.labelControl —— 设置页不允许出现第四种行样式。
 *
 * 第五十二轮按用户「接口地址、apikey、模型名下方的解释文案删除」去掉 desc 一行:
 * 三行只留标签与输入框(placeholder 已在示例,「关于」卡与数据边界段仍在讲密钥去向)。
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // 与 Toggle / Slider / HotkeyRow 共用 .pddcs-srow:同样的内边距、同样的缩进发丝线。
    // 标签走 .n 档(15px 常规)—— 设置页不允许出现第四种行样式
    <div className="pddcs-srow pddcs-srow-blk pddcs-hair">
      <span className="pddcs-srow-label">
        <span className="n">{label}</span>
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginTop: formGap.labelControl }}>
        {children}
      </div>
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

// ─── 快捷键行:展示 + 按键录入 ────────────────────────────────────────────────────

/** 字节 → 人类可读(KB/MB/GB,一位小数) */
function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`
  return `${n} B`
}

function HotkeyRow({
  hotkey,
  label = '快捷键',
  desc = '在聊天页按此键唤起推荐回复',
  allowPlainKey = false,
  onChange,
}: {
  hotkey: HotkeyConfig
  label?: string
  desc?: string
  /** 允许纯主键(无修饰键)录入:面板导航键默认 Tab,须放开;唤起键仍要求带修饰键 */
  allowPlainKey?: boolean
  onChange: (hk: HotkeyConfig) => void
}) {
  const [recording, setRecording] = useState(false)

  // 录入态:捕获下一次按键(修饰键单独按下先等待主键;Esc 取消)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      if (isModifierOnly(e.key)) return
      if (!allowPlainKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        // 纯主键(无修饰键)容易与日常输入冲突:唤起键不允许,导航键(allowPlainKey)放开
        setRecording(false)
        return
      }
      const hk: HotkeyConfig = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key: e.key }
      setRecording(false)
      onChange(hk)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange, allowPlainKey])

  return (
    // 两行结构(2026-09-15 第十七轮重排):行1 = 标签 + kbd + 「修改」推至行右,
    // kbd 显式取 controlH.form 与按钮严格等高(等高铁律);行2 = 说明/录入提示。
    // 第四十一轮:标签走 formType.label、说明走 formType.desc,两者间距取 formGap.labelDesc
    // —— 与 Toggle / Slider 三种行完全同构。
    //
    // v4.1 补:外层同样走 .pddcs-srow —— 这一行曾经是本页唯一**没**套行样式的行
    // (裸 flex div,既没有 16px 内边距也没有下缘发丝线),于是「快捷键」比它上下
    // 所有的行都靠左 16px、且把两行行距撑成 4px 而不是行的 12px。四种行样式
    // (Toggle / Slider / Field / HotkeyRow)现在同源。
    <div className="pddcs-srow pddcs-srow-blk pddcs-hair">
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <span
          style={{
            fontSize: formType.label.size,
            fontWeight: formType.label.weight,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
        <kbd
          // 键帽:等宽走 .pddcs-num(不再自带一份字体栈),圆角取控件档
          // —— 曾经是写死的 6px,不在三档圆角里;聊天页面板的键帽写的是 5px,
          // 同一件东西两个值,正是因为两边都不引用令牌
          className="pddcs-num"
          style={{
            height: controlH.form,
            display: 'inline-flex',
            alignItems: 'center',
            padding: `0 ${spacing.lg}px`,
            borderRadius: radius.control,
            border: `1px solid ${'var(--pddcs-separator)'}`,
            backgroundColor: 'var(--pddcs-fill)',
            color: 'var(--pddcs-text)',
            fontSize: fontSize.cap,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {formatHotkey(hotkey)}
        </kbd>
        {!recording && (
          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <Btn title="按下新的组合键即可替换当前快捷键" onClick={() => setRecording(true)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <PencilIcon size={size.icon} strokeWidth={2} />修改
              </span>
            </Btn>
          </div>
        )}
      </div>
      {recording ? (
        // 录入提示是"当前状态"而非普通说明:保留 accent 色以示激活(字号仍走 formType.desc)
        <span
          style={{
            fontSize: formType.desc.size,
            fontWeight: formType.desc.weight,
            color: 'var(--pddcs-text)',
            lineHeight: 1.5,
          }}
        >
          请按下新的快捷键(Esc 取消{allowPlainKey ? ';可用单键(如 Tab)' : ';需带 Ctrl/Alt/Shift'})
        </span>
      ) : desc ? (
        <span
          style={{
            fontSize: formType.desc.size,
            fontWeight: formType.desc.weight,
            color: 'var(--pddcs-text-tertiary)',
            lineHeight: 1.5,
          }}
        >
          {desc}
        </span>
      ) : null}
    </div>
  )
}
