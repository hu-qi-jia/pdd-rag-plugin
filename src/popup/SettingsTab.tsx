/**
 * 设置页(P3,设计文档 §7/§8):直接填充开关、唤起/候选切换快捷键、金标准优先、
 * 相似度/金标准/知识库阈值、保留期天数;导入/导出 v2(默认金标准+文件夹+设置,记忆可选);
 * 关于与合规说明。P0 自检卡按设计移除。
 * 复用组件:Card / Toggle / Slider / Btn / Notice(见 ui/components.tsx)。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  ClearMemoryDataResponse,
  ExportDataResponse,
  GetStatsResponse,
  ImportDataResponse,
  UpdateSettingsResponse,
} from '../types/messages'
import type { HotkeyConfig, PddSettings } from '../types/memory'
import { Btn, Card, Notice, Slider, Toggle, controlStyle, type NoticeMsg } from '../ui/components'
import { controlH, fontSize, formGap, formType, spacing } from '../ui/design'
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
import { LLM_TIMEOUT_MAX_MS, LLM_TIMEOUT_MIN_MS } from '../shared/constants'
import type { TestLlmResponse } from '../types/messages'

/**
 * 设置页所有卡片的统一行距(配置项之间,第四十一轮用户"各配置项之间间距增大,并做统一")——
 * Card 默认 spacing.lg(10px)偏挤,设置页统一提到 formGap.row(16px);
 * 四个卡片共用同一个常量对象,禁止逐卡微调,否则"统一"立刻失效。
 */
const SETTINGS_CARD_STYLE: React.CSSProperties = { gap: formGap.row }

export function SettingsTab({
  tk,
  onDataChanged,
}: {
  tk: ThemeTokens
  onDataChanged: () => Promise<void> | void
}) {
  const [draft, setDraft] = useState<PddSettings | null>(null)
  // 存储(PM6a):各表计数 + 浏览器存储用量估算
  const [stats, setStats] = useState<GetStatsResponse['payload'] | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
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
        }) · 文件夹 +${p.addedFolders ?? 0} · 知识 +${p.addedKnowledge ?? 0}(跳过 ${p.skippedKnowledge ?? 0}) · 问答 +${p.addedQa ?? 0} · 回复 +${p.addedReplies ?? 0};向量后台重嵌`,
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
        <div style={{ fontSize: formType.desc.size, fontWeight: formType.desc.weight, color: tk.textMuted }}>
          读取中…
        </div>
        <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />
      </div>
    )
  }

  return (
    // 卡片之间与配置项之间同节奏(同取 formGap.row):全页一条 16px 栅格,
    // 避免"卡内比卡外还松"的错位
    <div style={{ display: 'flex', flexDirection: 'column', gap: formGap.row }}>
      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      <Card tk={tk} title="检索与填充" style={SETTINGS_CARD_STYLE}>
        <Toggle
          tk={tk}
          label="自动回复"
          desc="开:直接填充第一条;关:弹面板人工选择"
          checked={draft.directFillEnabled}
          onChange={(v) => void persist({ ...draft, directFillEnabled: v })}
        />
        <HotkeyRow
          tk={tk}
          hotkey={draft.autoReplyHotkey}
          onChange={(hk) => void persist({ ...draft, autoReplyHotkey: hk })}
        />
        <HotkeyRow
          tk={tk}
          label="候选切换键"
          desc="推荐面板打开时按此键在候选间循环切换(可用单键)"
          allowPlainKey
          hotkey={draft.panelNavHotkey}
          onChange={(hk) => void persist({ ...draft, panelNavHotkey: hk })}
        />
        <Toggle
          tk={tk}
          label="标准回答优先"
          desc="标准回答命中时置顶"
          checked={draft.goldenPriorityEnabled}
          onChange={(v) => void persist({ ...draft, goldenPriorityEnabled: v })}
        />
        <Slider
          tk={tk}
          label="历史相似度阈值"
          value={draft.simThreshold}
          min={0.3}
          max={0.9}
          step={0.05}
          onChange={(v) => persistSlider({ simThreshold: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          tk={tk}
          label="标准回答阈值(放宽)"
          value={draft.goldenThreshold}
          min={0.2}
          max={0.8}
          step={0.05}
          onChange={(v) => persistSlider({ goldenThreshold: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          tk={tk}
          label="知识库阈值(放宽)"
          value={draft.kbThreshold}
          min={0.2}
          max={0.8}
          step={0.05}
          onChange={(v) => persistSlider({ kbThreshold: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          tk={tk}
          label="保留期天数"
          value={draft.retentionDays}
          min={30}
          max={365}
          step={5}
          onChange={(v) => persistSlider({ retentionDays: v })}
          format={(v) => `${v} 天`}
        />
      </Card>

      <Card tk={tk} title="AI 整合" style={SETTINGS_CARD_STYLE}>
        <Toggle
          tk={tk}
          label="AI 整合"
          desc="开启后,推荐面板的知识库候选上方多一行「根据知识库内容整合并回复」,点击才生成"
          checked={draft.aiIntegrateEnabled}
          onChange={(v) => void persist({ ...draft, aiIntegrateEnabled: v })}
        />

        {/* 数据边界(ADR-0006):只留用户真正需要知道的三件事 —— 什么会出去、
            什么永远不出去、谁来决定发送。不解释实现细节,不堆加粗。 */}
        <div
          style={{
            fontSize: formType.desc.size,
            fontWeight: formType.desc.weight,
            color: tk.textMuted,
            lineHeight: 1.6,
          }}
        >
          点击那一行时,本轮命中的知识库内容与买家问题会发给你配置的接口。历史回答与标准回答永不外发,
          密钥只存本机,生成结果只填输入框、发送仍由你手动完成。
          {draft.directFillEnabled && ' 当前已开启「自动回复」,本功能不会生效。'}
        </div>

        {/* 滑杆读秒、设置存毫秒 —— 这里是两者**唯一**的换算点(第五十二轮修)。
            此前 value 喂的是毫秒(8000)、min/max 却是秒(2~30):值恒大于上限,浏览器把滑块
            钉在最右端,每次拖动刚算出的新值又超上限、又被钉回去 —— 观感就是"拖不动",
            读数还写着「8000 秒」。修法是让两侧同单位,而不是把 min/max 抬到毫秒。 */}
        <Slider
          tk={tk}
          label="整合超时"
          value={draft.llmTimeoutMs / 1000}
          min={LLM_TIMEOUT_MIN_MS / 1000}
          max={LLM_TIMEOUT_MAX_MS / 1000}
          step={1}
          onChange={(v) => persistSlider({ llmTimeoutMs: v * 1000 })}
          format={(v) => `${v} 秒`}
        />

        <Field tk={tk} label="接口地址">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(tk, controlH.form), flex: 1, minWidth: 0 }}
            placeholder="https://api.deepseek.com/v1"
            spellCheck={false}
            value={llm?.baseUrl ?? ''}
            onChange={(e) => updateLlm({ baseUrl: e.target.value })}
          />
        </Field>

        <Field tk={tk} label="API Key">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(tk, controlH.form), flex: 1, minWidth: 0 }}
            placeholder="sk-…"
            spellCheck={false}
            autoComplete="off"
            type={showKey ? 'text' : 'password'}
            value={llm?.apiKey ?? ''}
            onChange={(e) => updateLlm({ apiKey: e.target.value })}
          />
          <Btn tk={tk} variant="ghost" onClick={() => setShowKey((v) => !v)}>
            {showKey ? '隐藏' : '显示'}
          </Btn>
        </Field>

        <Field tk={tk} label="模型名">
          <input
            className="pddcs-input"
            style={{ ...controlStyle(tk, controlH.form), flex: 1, minWidth: 0 }}
            placeholder="deepseek-chat"
            spellCheck={false}
            value={llm?.model ?? ''}
            onChange={(e) => updateLlm({ model: e.target.value })}
          />
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Btn
            tk={tk}
            variant="primary"
            disabled={busy || !llmDirty}
            title={llmDirty ? '保存接口配置' : '没有改动'}
            onClick={() => void saveLlm()}
          >
            保存
          </Btn>
          <Btn
            tk={tk}
            disabled={busy || test.phase === 'testing' || !llmFormReady(llm ?? { baseUrl: '', apiKey: '', model: '' })}
            title="用当前填写的地址与模型发一次最小请求,验证是否可用"
            onClick={() => void testLlm()}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {/* 只在途时给转圈;成功/失败的结论交给右侧那行文字,不进按钮(免得读成"✕ 测试连接") */}
              {test.phase === 'testing' && <LoaderIcon size={12} strokeWidth={2} />}
              测试连接
            </span>
          </Btn>
          {/* 测试结论就地显示在按钮右侧(不弹 toast:用户正盯着这一行等结果) */}
          {test.phase !== 'idle' && (
            <span
              style={{
                fontSize: formType.desc.size,
                fontWeight: formType.desc.weight,
                color: test.phase === 'ok' ? tk.textMuted : llmTestFailed(test) ? tk.errorText : tk.textMuted,
                lineHeight: 1.5,
              }}
            >
              {llmTestLabel(test)}
            </span>
          )}
        </div>

        {/* 两处"配了但不会生效"的自查提示:开启未配置 / 改了没保存,都是静默失效的重灾区 */}
        {draft.aiIntegrateEnabled && !llmFormReady(llmFormFromSettings(draft)) && (
            <div style={{ fontSize: formType.desc.size, color: tk.errorText, lineHeight: 1.6 }}>
              已开启,但接口地址 / API Key / 模型名尚未填全,推荐面板不会出现整合行。
            </div>
          )}
        {llmDirty && (
          <div style={{ fontSize: formType.desc.size, color: tk.textMuted, lineHeight: 1.6 }}>
            有未保存的修改。
          </div>
        )}
      </Card>

      <Card tk={tk} title="导入与导出" style={SETTINGS_CARD_STYLE}>
        <Toggle
          tk={tk}
          label="导出包含记忆数据"
          desc="额外导出问答记录与回复"
          checked={includeMemory}
          onChange={setIncludeMemory}
        />
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Btn tk={tk} variant="primary" disabled={busy} onClick={() => void exportJson()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <DownloadIcon size={12} strokeWidth={2} />导出 JSON
            </span>
          </Btn>
          <Btn tk={tk} disabled={busy} onClick={() => fileRef.current?.click()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UploadIcon size={12} strokeWidth={2} />导入 JSON
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
      </Card>

      <Card tk={tk} title="存储" style={SETTINGS_CARD_STYLE}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            // 同一行内多项之间用 16px 列距(与配置项行距同值,横向也统一)
            gap: `4px ${formGap.row}px`,
            fontSize: formType.desc.size,
            fontWeight: formType.desc.weight,
            color: tk.textMuted,
            fontVariantNumeric: 'tabular-nums',
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
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
          {confirmClear ? (
            <>
              <span
                style={{
                  fontSize: formType.desc.size,
                  fontWeight: formType.desc.weight,
                  color: tk.errorText,
                }}
              >
                清空全部问答与回复?标准回答/知识库/文件夹保留。
              </span>
              <Btn tk={tk} variant="danger" disabled={busy} onClick={() => void clearMemory()}>
                确认清空
              </Btn>
              <Btn tk={tk} variant="ghost" onClick={() => setConfirmClear(false)}>
                取消
              </Btn>
            </>
          ) : (
            <Btn tk={tk} variant="danger" onClick={() => setConfirmClear(true)}>
              清空问答数据
            </Btn>
          )}
        </div>
      </Card>

      <Card tk={tk} title="关于" style={SETTINGS_CARD_STYLE}>
        <div
          style={{
            fontSize: formType.desc.size,
            fontWeight: formType.desc.weight,
            color: tk.textMuted,
            lineHeight: 1.7,
          }}
        >
          本工具仅读取聊天页内容并填充官方输入框,发送始终由人工完成;
          全部数据仅存本机 IndexedDB;嵌入模型已内置,离线可用,无任何远程下载。
          默认全程不联网 —— 只有你亲手填了接口与密钥、打开「AI 整合」、再点击面板里那一行,
          才会把当轮面板展示的知识库内容与买家问题发给你配置的接口;
          历史回答与标准回答永不外发,整合结果也只填进输入框,发送仍由你点。
          请勿用于自动群发等违反平台规则的场景。
        </div>
      </Card>
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
function Field({
  tk,
  label,
  children,
}: {
  tk: ThemeTokens
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: formGap.labelControl }}>
      <span style={{ fontSize: formType.label.size, fontWeight: formType.label.weight }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>{children}</div>
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
  tk,
  hotkey,
  label = '快捷键',
  desc = '在聊天页按此键唤起推荐回复',
  allowPlainKey = false,
  onChange,
}: {
  tk: ThemeTokens
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: formGap.labelDesc }}>
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
          style={{
            height: controlH.form,
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 10px',
            borderRadius: 6,
            border: `1px solid ${tk.border}`,
            backgroundColor: tk.bgSecondary,
            color: tk.text,
            fontSize: fontSize.caption,
            fontFamily: 'ui-monospace, Consolas, monospace',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {formatHotkey(hotkey)}
        </kbd>
        {!recording && (
          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <Btn tk={tk} title="按下新的组合键即可替换当前快捷键" onClick={() => setRecording(true)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <PencilIcon size={12} strokeWidth={2} />修改
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
            color: tk.accent,
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
            color: tk.textMuted,
            lineHeight: 1.5,
          }}
        >
          {desc}
        </span>
      ) : null}
    </div>
  )
}
