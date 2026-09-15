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
import {
  Btn,
  Card,
  EmptyState,
  Notice,
  SearchInput,
  formatTs,
  type NoticeMsg,
} from '../ui/components'
import { fontSize, fontWeight, spacing } from '../ui/design'

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

  const setGolden = async (item: MemoryListItem, replyId: string, text: string) => {
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
      if (p.error) setMsg({ ok: false, text: `设置标准回答失败:${p.error}` })
      else if (p.exists) setMsg({ ok: true, text: '该问题的标准回答已存在,未重复创建' })
      else setMsg({ ok: true, text: '已设为标准回答,后台将自动向量化' })
    } catch (err) {
      setMsg({ ok: false, text: `设置标准回答失败:${String(err)}` })
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

      <Notice tk={tk} msg={msg} />

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
        return (
          <Card key={item.id} tk={tk} style={{ padding: `${spacing.xl - 2}px ${spacing.xl + 2}px`, gap: 0 }}>
            {/* 问题行 */}
            <div
              onClick={() =>
                setCollapsedIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })
              }
              style={{ cursor: 'pointer' }}
            >
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

            {/* 展开区:回复列表 */}
            {expanded && (
              <div style={{ marginTop: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
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
                    <Btn tk={tk} variant="primary" onClick={() => void setGolden(item, r.id, r.text)} title="将此问题与回复设为标准回答">
                      设置标准回答
                    </Btn>
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
