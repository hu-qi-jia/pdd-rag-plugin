/**
 * 记忆列表页(P3,设计文档 §7):问答记录流,展开看回复;
 * 操作:设为金标准(按回复)/ 删除单条 / 关键词筛选 / 剩余保留天数标注。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../utils/message-passing'
import type {
  AddGoldenResponse,
  DeleteQaResponse,
  GetMemoryListResponse,
  MemoryListItem,
} from '../types/messages'
import { filterQaRecords, remainingDays } from '../utils/panelLogic'
import { MAX_GOLDENS_PER_QUESTION } from '../types/memory'
import {
  Btn,
  Card,
  EmptyState,
  Notice,
  SearchInput,
  formatTs,
  type NoticeMsg,
} from '../ui/components'
import { controlH, fontSize, fontWeight, motion, radius, spacing } from '../ui/design'
import { CheckIcon, ChevronDownIcon } from '../ui/icons'

export function MemoryListTab({
  tk,
  retentionDays,
  onDataChanged,
}: {
  tk: ThemeTokens
  retentionDays: number
  onDataChanged: () => Promise<void> | void
}) {
  const [items, setItems] = useState<MemoryListItem[]>([])
  const [keyword, setKeyword] = useState('')
  // 默认全部展开(问题+回复直接可见);记录用户手动折叠的条目
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)
  // 「设置标准回答」的行内即时反馈:请求中
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetMemoryListResponse>({ type: 'GET_MEMORY_LIST' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setItems(resp.payload.items)
      }
    } catch (err) {
      setMsg({ ok: false, text: `读取失败:${String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => filterQaRecords(items, keyword), [items, keyword])
  const now = Date.now()

  // 持久金标徽标(2026-09-15 PM1):从数据派生(GET_MEMORY_LIST 按 goldens.sourceReplyId
  // 回带 goldenId),不再是会话级 state —— 重开 popup、于文件夹页取消后都如实反映库内状态
  const goldenReplyIds = useMemo(() => {
    const s = new Set<string>()
    for (const it of items) for (const r of it.replies) if (r.goldenId) s.add(r.id)
    return s
  }, [items])

  /**
   * 设为标准回答。
   * 2026-09-15 用户反馈「点击无效、没有反应」真因:写入其实成功(goldenCount +1),
   * 但反馈只有列表顶部一条 Notice,列表一长就在视口外;且头部统计没有刷新、
   * 列表本身也不会变化 → 界面看上去毫无动静。现补三重可见反馈:
   *   ① 按钮原位变「设置中…」→「已设为标准回答」(最贴近点击点的反馈);
   *   ② 头部统计立即刷新(标准回答 N);
   *   ③ Notice(已改为吸附在滚动区顶部)。
   */
  const setGolden = async (item: MemoryListItem, replyId: string, text: string) => {
    setBusyReplyId(replyId)
    try {
      const resp = await sendMessage<AddGoldenResponse>({
        type: 'ADD_GOLDEN',
        payload: {
          question: item.question,
          answer: text,
          sourceRecordId: item.id,
          sourceReplyId: replyId,
        },
      })
      const p = resp.payload
      if (p.error) {
        setMsg({ ok: false, text: `设置标准回答失败:${p.error}` })
        return
      }
      if (p.limitReached) {
        setMsg({
          ok: false,
          text: `该问题已有 ${p.count} 条标准回答(上限 ${MAX_GOLDENS_PER_QUESTION} 条),请先在文件夹页取消一条`,
        })
        return
      }
      setMsg(
        p.exists
          ? { ok: true, text: '该回复已是该问题的标准回答,未重复创建' }
          : {
              ok: true,
              text: `已设为标准回答${p.count ? `(${p.count}/${MAX_GOLDENS_PER_QUESTION})` : ''},后台将自动向量化`,
            },
      )
      // 库内已写入 sourceReplyId → 重新拉取列表,徽标由数据派生持久生效
      await load()
      await onDataChanged()
    } catch (err) {
      setMsg({ ok: false, text: `设置标准回答失败:${String(err)}` })
    } finally {
      setBusyReplyId(null)
    }
  }

  const deleteQa = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteQaResponse>({
        type: 'DELETE_QA',
        payload: { id },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '已删除该问答及其回复' })
        await load()
        await onDataChanged()
      } else {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmDeleteId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <SearchInput tk={tk} value={keyword} onChange={setKeyword} placeholder="搜索历史问题" />

      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      {loading && <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>}
      {!loading && shown.length === 0 && (
        <EmptyState tk={tk}>
          {items.length === 0 ? (
            <>
              暂无记录
              <br />
              在聊天页与买家对话后将自动捕获
            </>
          ) : (
            '没有匹配的问题'
          )}
        </EmptyState>
      )}

      {shown.map((item) => {
        const days = remainingDays(item.questionTs, now, retentionDays)
        const expanded = !collapsedIds.has(item.id)
        const toggle = () =>
          setCollapsedIds((prev) => {
            const next = new Set(prev)
            if (next.has(item.id)) next.delete(item.id)
            else next.add(item.id)
            return next
          })
        return (
          <Card key={item.id} tk={tk} style={{ padding: `${spacing.xl - 2}px ${spacing.xl + 2}px`, gap: 0 }}>
            {/* 问题行:问题与元信息居左,折叠按钮移到行尾(2026-09-15 用户要求);整行可点 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
              <div onClick={toggle} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div
                  style={{
                    fontSize: fontSize.body,
                    fontWeight: fontWeight.semibold,
                    lineHeight: 1.45,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  {item.question}
                </div>
                <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTs(item.questionTs)} · {item.replyCount} 条回复 ·{' '}
                  <span style={{ color: days <= 7 ? tk.errorText : undefined }}>剩 {days} 天</span>
                </div>
              </div>

              <button
                type="button"
                title={expanded ? '折叠该问题' : '展开该问题'}
                aria-expanded={expanded}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle()
                }}
                style={{
                  flexShrink: 0,
                  width: controlH.inline,
                  height: controlH.inline,
                  marginTop: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  border: 'none',
                  borderRadius: radius.sm,
                  backgroundColor: 'transparent',
                  color: tk.textTertiary,
                  cursor: 'pointer',
                  transition: `background-color ${motion.fast}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = tk.btnHoverBg
                  e.currentTarget.style.color = tk.text
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = tk.textTertiary
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    transform: expanded ? 'none' : 'rotate(-90deg)',
                    transition: `transform ${motion.fast}`,
                  }}
                >
                  <ChevronDownIcon size={13} strokeWidth={2.2} />
                </span>
              </button>
            </div>

            {/* 展开区:回复列表(与问题文字同左基线,不再给折叠钮留缩进) */}
            {expanded && (
              <div
                style={{
                  marginTop: spacing.md,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: spacing.md,
                }}
              >
                {item.replies.length === 0 && (
                  <div style={{ fontSize: fontSize.secondary, color: tk.textTertiary }}>无回复(未结段)</div>
                )}
                {item.replies.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      borderTop: `1px solid ${tk.separator}`,
                      paddingTop: spacing.md,
                      display: 'flex',
                      gap: spacing.md,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        fontSize: fontSize.secondary,
                        lineHeight: 1.55,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: tk.textMuted,
                      }}
                    >
                      {r.text}
                    </div>
                    {goldenReplyIds.has(r.id) ? (
                      <span
                        title="该回复已设为标准回答;可在文件夹页取消"
                        style={{
                          height: controlH.form,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          flexShrink: 0,
                          fontSize: fontSize.caption,
                          fontWeight: fontWeight.medium,
                          color: tk.successText,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <CheckIcon size={12} strokeWidth={2.4} />
                        已设为标准回答
                      </span>
                    ) : (
                      <Btn
                        tk={tk}
                        variant="primary"
                        disabled={busyReplyId === r.id}
                        onClick={() => void setGolden(item, r.id, r.text)}
                        title="将此问题与回复设为标准回答"
                      >
                        {busyReplyId === r.id ? '设置中…' : '设置标准回答'}
                      </Btn>
                    )}
                  </div>
                ))}
                {/* 删除单条(内联二次确认) */}
                <div style={{ borderTop: `1px solid ${tk.separator}`, paddingTop: spacing.md, display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                  {confirmDeleteId === item.id ? (
                    <>
                      <span style={{ fontSize: fontSize.caption + 0.5, color: tk.errorText }}>删除该问答及其全部回复?</span>
                      <Btn tk={tk} variant="danger" onClick={() => void deleteQa(item.id)}>
                        确认
                      </Btn>
                      <Btn tk={tk} variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                        取消
                      </Btn>
                    </>
                  ) : (
                    <Btn tk={tk} variant="danger" onClick={() => setConfirmDeleteId(item.id)}>
                      删除
                    </Btn>
                  )}
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
