/**
 * 待沉淀清单页(v0.16):问过很多遍、却始终没有标准回答的问题,按出现次数倒序。
 *
 * 为什么要有这一页:历史记录按 90 天保留期自然衰退 —— 同一件事被问得越多,
 * 越说明它值得固化,但此前没有任何地方把这件事说出来。用户得自己翻记忆列表
 * 才可能察觉"这个问题我已经答过八遍了"。
 *
 * 交互:每条给出最近一次的回复作为提升候选(可展开换一条),一键设为标准回答;
 * 不需要沉淀的可以「忽略」(不再出现)。聚合口径见 background/backlogPlan.ts。
 */
import React, { useCallback, useEffect, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  AddGoldenResponse,
  BacklogItem,
  GetBacklogResponse,
  IgnoreBacklogResponse,
} from '../types/messages'
import { MAX_GOLDENS_PER_QUESTION } from '../shared/constants'
import {
  Btn,
  Card,
  ConfirmRow,
  EmptyState,
  Notice,
  formatTs,
  type NoticeMsg,
} from '../ui/components'
import { controlH, fontSize, fontWeight, motion, radius, spacing } from '../ui/design'
import { ChevronDownIcon, XIcon } from '../ui/icons'

export function BacklogTab({
  tk,
  onDataChanged,
  onCountChange,
}: {
  tk: ThemeTokens
  onDataChanged: () => Promise<void> | void
  /** 待沉淀条数回传给外壳(顶部概览行)—— 免得外壳为了一个数字把全表再聚合一遍 */
  onCountChange?: (total: number) => void
}) {
  const [items, setItems] = useState<BacklogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)
  const [confirmIgnore, setConfirmIgnore] = useState<string | null>(null)
  /** 展开查看其它回复的条目(默认只显示最近一条) */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetBacklogResponse>({ type: 'GET_BACKLOG' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setItems(resp.payload.items)
        setTotal(resp.payload.total)
        onCountChange?.(resp.payload.total)
      }
    } catch (err) {
      setMsg({ ok: false, text: `读取失败:${String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => {
    void load()
  }, [load])

  const toggleExpand = (hash: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })

  /**
   * 提升为标准回答:与记忆列表同一入口(ADD_GOLDEN),只是答案来源换成了这条回复。
   * 提升成功后该问题已有标准回答,自然从清单消失 —— 重新拉取即是"划掉"。
   */
  const promote = async (item: BacklogItem, replyId: string, text: string) => {
    const reply = item.replies.find((r) => r.id === replyId)
    if (!reply) return
    setBusyReplyId(replyId)
    try {
      const resp = await sendMessage<AddGoldenResponse>({
        type: 'ADD_GOLDEN',
        payload: {
          question: item.question,
          answer: text,
          sourceRecordId: reply.qaId,
          sourceReplyId: reply.id,
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
              text: `已沉淀为标准回答${p.count ? `(${p.count}/${MAX_GOLDENS_PER_QUESTION})` : ''},后台将自动向量化`,
            },
      )
      await load()
      await onDataChanged()
    } catch (err) {
      setMsg({ ok: false, text: `设置标准回答失败:${String(err)}` })
    } finally {
      setBusyReplyId(null)
    }
  }

  /** 「不再提示」:只加一条忽略标记,问答记录与标准回答都不受影响 */
  const ignore = async (item: BacklogItem) => {
    try {
      const resp = await sendMessage<IgnoreBacklogResponse>({
        type: 'IGNORE_BACKLOG',
        payload: { questionHash: item.questionHash, question: item.question },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '已从待沉淀清单移除(历史记录不受影响)' })
        await load()
      } else {
        setMsg({ ok: false, text: `操作失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `操作失败:${String(err)}` })
    }
    setConfirmIgnore(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        按问题原文归并:措辞不同的同类问题暂不合并,已有标准回答的问题不再出现。
        提升后该问题会从本页消失 —— 它已经沉淀好了。
      </div>

      {loading && <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>}

      {!loading && items.length === 0 && (
        <EmptyState tk={tk}>
          暂无待沉淀问题
          <br />
          同一问题被问过多次、又还没有标准回答时,会出现在这里
        </EmptyState>
      )}

      {items.map((item) => {
        const isExpanded = expanded.has(item.questionHash)
        const shownReplies = isExpanded ? item.replies : item.replies.slice(0, 1)
        return (
          <Card
            key={item.questionHash}
            tk={tk}
            style={{ padding: `${spacing.xl - 2}px ${spacing.xl + 2}px`, gap: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
              <div style={{ flex: 1, minWidth: 0 }}>
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
                <div
                  style={{
                    fontSize: fontSize.caption,
                    color: tk.textTertiary,
                    marginTop: 3,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  问过 {item.count} 次 · 最近 {formatTs(item.lastTs)}
                </div>
              </div>

              {/* 忽略入口:幽灵图标钮,确认条在问题行下方(与记忆列表删二维码同一套) */}
              <button
                type="button"
                title="不再提示这个问题(历史记录不受影响)"
                onClick={() => setConfirmIgnore(item.questionHash)}
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
                  transition: `background-color ${motion.fast}, color ${motion.fast}`,
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
                <XIcon size={13} strokeWidth={2.2} />
              </button>
            </div>

            {confirmIgnore === item.questionHash && (
              <div style={{ marginTop: spacing.md }}>
                <ConfirmRow
                  tk={tk}
                  text="不再提示这个问题?历史记录与标准回答都不受影响。"
                  onOk={() => void ignore(item)}
                  onCancel={() => setConfirmIgnore(null)}
                />
              </div>
            )}

            <div
              style={{
                marginTop: spacing.md,
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.md,
              }}
            >
              {shownReplies.map((r) => (
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
                  <Btn
                    tk={tk}
                    variant="ghost"
                    disabled={busyReplyId === r.id}
                    onClick={() => void promote(item, r.id, r.text)}
                  >
                    {busyReplyId === r.id ? '设置中…' : '设为标准'}
                  </Btn>
                </div>
              ))}
            </div>

            {/* 换一条:同问题答过几种说法时,挑最合适的那条来沉淀 */}
            {item.replies.length > 1 && (
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(item.questionHash)}
                style={{
                  marginTop: spacing.md,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: 0,
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: tk.textTertiary,
                  fontSize: fontSize.caption,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    transform: isExpanded ? 'none' : 'rotate(-90deg)',
                  }}
                >
                  <ChevronDownIcon size={12} strokeWidth={2.2} />
                </span>
                {isExpanded ? '收起' : `换一条(还有 ${item.replies.length - 1} 条回复)`}
              </button>
            )}
          </Card>
        )
      })}

      {/* 截断如实说明:50 条之后的没有被悄悄丢掉,只是这一屏不显示 */}
      {!loading && items.length > 0 && (
        <div
          style={{
            textAlign: 'center',
            fontSize: fontSize.caption,
            color: tk.textTertiary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {total > items.length
            ? `共 ${total} 条待沉淀,已显示前 ${items.length} 条(先处理高频的)`
            : `共 ${total} 条待沉淀`}
        </div>
      )}
    </div>
  )
}
