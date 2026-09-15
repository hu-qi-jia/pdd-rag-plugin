/**
 * 设置页(P3,设计文档 §7/§8):直接填充开关、金标准优先、相似度/金标准阈值、
 * 保留期天数;导入/导出 v2(默认金标准+文件夹+设置,记忆可选);
 * 关于与合规说明。P0 自检卡按设计移除。
 * 复用组件:Card / Toggle / Slider / Btn / Notice(见 ui/components.tsx)。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../utils/message-passing'
import type {
  ClearMemoryDataResponse,
  ExportDataResponse,
  GetStatsResponse,
  ImportDataResponse,
  UpdateSettingsResponse,
} from '../types/messages'
import type { HotkeyConfig, PddSettings } from '../types/memory'
import { Btn, Card, Notice, Slider, Toggle, type NoticeMsg } from '../ui/components'
import { fontSize, fontWeight, spacing } from '../ui/design'
import { DownloadIcon, PencilIcon, UploadIcon } from '../ui/icons'
import { formatHotkey, isModifierOnly } from '../utils/hotkey'

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
    async (next: PddSettings) => {
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
        } else {
          setDraft(resp.payload.settings ?? next)
          setMsg({ ok: true, text: '已保存' })
          await onDataChanged()
        }
      } catch (err) {
        setMsg({ ok: false, text: `保存失败:${String(err)}` })
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
        <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      <Card tk={tk} title="检索与填充(改动即时生效)">
        <Toggle
          tk={tk}
          label="自动回复"
          desc="开启后点击「AI回复」或按快捷键,直接填充第一条推荐回复;关闭后总是弹出推荐回复面板,由你点选(或按 Enter 填第一条)。两种方式都不会自动发送"
          checked={draft.directFillEnabled}
          onChange={(v) => void persist({ ...draft, directFillEnabled: v })}
        />
        <HotkeyRow
          tk={tk}
          hotkey={draft.autoReplyHotkey}
          onChange={(hk) => void persist({ ...draft, autoReplyHotkey: hk })}
        />
        <Toggle
          tk={tk}
          label="标准回答优先"
          desc="候选排序时标准回答置顶(建议保持开启)"
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
          label="保留期天数"
          value={draft.retentionDays}
          min={30}
          max={365}
          step={5}
          onChange={(v) => persistSlider({ retentionDays: v })}
          format={(v) => `${v} 天`}
        />
      </Card>

      <Card tk={tk} title="导入与导出">
        <Toggle
          tk={tk}
          label="导出包含记忆数据"
          desc="问答记录与回复一并导出(向量不导出,导入后自动重嵌);默认仅导出标准回答、文件夹与设置"
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
        <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
          导入按内容幂等:已存在的标准回答与问答自动跳过并计数,不覆盖本地编辑;版本不符将拒绝导入。
        </div>
      </Card>

      <Card tk={tk} title="存储">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `4px ${spacing.lg}px`,
            fontSize: fontSize.caption,
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
              <span style={{ fontSize: fontSize.caption + 0.5, color: tk.errorText }}>
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
        <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
          问答记录与回复按保留期自动清理;此操作立即清空全部问答数据(含自检数据),不可撤销。
        </div>
      </Card>

      <Card tk={tk} title="关于">
        <div style={{ fontSize: fontSize.secondary - 0.5, color: tk.textMuted, lineHeight: 1.7 }}>
          本工具仅读取聊天页内容并填充官方输入框,发送始终由人工完成;
          全部数据仅存本机 IndexedDB,不上传任何服务器;模型文件仅从 hf-mirror.com 镜像下载。
          请勿用于自动群发等违反平台规则的场景。
        </div>
      </Card>
    </div>
  )
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
  onChange,
}: {
  tk: ThemeTokens
  hotkey: HotkeyConfig
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
      if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
        // 纯主键(无修饰键)容易与日常输入冲突,不允许录入
        setRecording(false)
        return
      }
      const hk: HotkeyConfig = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key: e.key }
      setRecording(false)
      onChange(hk)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    // 控件一行(标签 + kbd + 修改),说明文字整行换行展示(2026-09-15 用户反馈:
    // popup 宽度有限,四段挤一行会把「快捷键」标签压成竖排)
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 6 }}>
      <span style={{ fontSize: fontSize.body, fontWeight: fontWeight.medium, flexShrink: 0 }}>快捷键</span>
      <kbd
        style={{
          padding: '2px 8px',
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
      {recording ? (
        <span style={{ flexBasis: '100%', fontSize: fontSize.caption, color: tk.accent }}>
          请按下新的快捷键(Esc 取消;需带 Ctrl/Alt/Shift)
        </span>
      ) : (
        <Btn tk={tk} title="按下新的组合键即可替换当前快捷键" onClick={() => setRecording(true)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PencilIcon size={12} strokeWidth={2} />修改
          </span>
        </Btn>
      )}
      <span style={{ flexBasis: '100%', fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.5 }}>
        在聊天页按此键唤起推荐回复
      </span>
    </div>
  )
}
