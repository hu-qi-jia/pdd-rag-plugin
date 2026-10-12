/**
 * 记忆页 — **命令台**(v3.1 方向 1:Raycast / fzf 式)。
 *
 * 结构(`UI设计稿-方向探索.html` 方向 1 定稿):
 *
 * ```
 * ❯ [搜索问题或回复…]                    ← 44px,打开即聚焦,输入框即整个界面
 * 命中 12 / 88 条 · 未分类 2 条           ← 统计行(顺带暴露一点"仪器感")
 * 全部 88 | 售后退换 7 | …               ← 分类导航(墨块,滚轮横移)
 * 1  退货运费谁承担?              ★ 售后退换   ← 34px 结果行
 * 2  怎么申请退货?                    售后退换   ← 选中行反白,就地展开
 *    › 订单页申请售后 → …          ★ ⧉
 * ↑↓ 选择 · ↵ 填进聊天框 · 1-9 按序号快速填 · ⇥ 切分类
 * ```
 *
 * 三条与旧版的根本差别:
 *  1. **输入框是唯一主角** —— 检索优先:客服记得关键词,直接打字比翻列表快;
 *  2. **结果行 34px 超紧凑**,一屏看 12+ 条;**选中行就地展开回复**,不跳页;
 *  3. **分类从"入口"降级成"属性"** —— 它退到结果行的行尾灰标(以及 ⇥ 循环切换),
 *     不再占据列表里的分区标题。
 *
 * 键盘是一等公民:↑↓ 选择、↵ 填充、1-9 按序号直填、⇥ 切分类。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  AddGoldenResponse,
  DeleteGoldenResponse,
  DeleteQaResponse,
  FillInputResponse,
  GetMemoryListResponse,
  MemoryListItem,
  MemoryReplyItem,
  PanelCategory,
} from '../types/messages'
import { categoryNavItems, filterQaRecords, groupByCategory, navBucketOf, remainingDays } from './logic'
import { MAX_GOLDENS_PER_QUESTION, UNCATEGORIZED_CATEGORY_ID } from '../shared/constants'
import { ConfirmRow, EmptyState, Notice, SearchInput, GLYPH, IconBtn, type NoticeMsg } from '../ui/components'
import { ALL_CATEGORIES, CategoryNav } from '../ui/CategoryNav'
import { fontSize, fontWeight, motion, radius, spacing } from '../ui/design'
import { CopyIcon } from '../ui/icons'

/**
 * 问题文字的左缘 = 行内边距 + 序号列宽 + 两者之间的间距。
 *
 * 由三个已有量推出而不是写死 42:序号列一改宽、行内边距一调节,这条线自动跟上 ——
 * 元信息行与回复块都站在它上面,三行共用同一条竖线(用户第 3 条的"回复居左,和问题左侧对齐")。
 */
const ROW_TEXT_X = spacing.xxl + 16 + spacing.lg

export function MemoryListTab({
  tk,
  retentionDays,
  categories,
  onDataChanged,
}: {
  tk: ThemeTokens
  retentionDays: number
  /** 问题类型表(来源:GET_STATS);导航据此列出全部分类。不应由本页签自行拉取 */
  categories: PanelCategory[]
  onDataChanged: () => Promise<void> | void
}) {
  const [items, setItems] = useState<MemoryListItem[]>([])
  // 分页状态(PM2):total 为排除自检后的全量数,hasMore 由后台按 offset+页大小<total 推得
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [keyword, setKeyword] = useState('')
  /**
   * **光标**(v3.1 方向 1):结果是一列编号行,光标停在哪一行,那一行就反白并**就地展开**。
   * 旧版是"每行各带一个折叠箭头、各记各的展开态"—— 与命令台的心智不符:
   * 这里同时只有**一个**位置是"当前",展开是它的属性而不是每行独立的状态。
   */
  const [selIdx, setSelIdx] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)
  // 「设为标准回答」的行内即时反馈:请求中
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)
  /** 当前选中的分类(`ALL_CATEGORIES` = 全部) */
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)

  const applyPage = useCallback(
    (p: GetMemoryListResponse['payload'], append: boolean) => {
      setItems((prev) => (append ? [...prev, ...p.items] : p.items))
      setTotal(p.total)
      setHasMore(p.hasMore)
    },
    [],
  )

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetMemoryListResponse>({ type: 'GET_MEMORY_LIST' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        applyPage(resp.payload, false)
      }
    } catch (err) {
      setMsg({ ok: false, text: `读取失败:${String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [applyPage])

  /** 「加载更早」:offset = 已加载条数,追加下一页(PM2 显式翻页入口) */
  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const resp = await sendMessage<GetMemoryListResponse>({
        type: 'GET_MEMORY_LIST',
        payload: { offset: items.length },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        applyPage(resp.payload, true)
      }
    } catch (err) {
      setMsg({ ok: false, text: `读取失败:${String(err)}` })
    } finally {
      setLoadingMore(false)
    }
  }, [applyPage, items.length])

  useEffect(() => {
    void load()
  }, [load])

  const now = Date.now()

  /** 导航条目 = 全部 + 各分类(含 0 条的)。计数与下面的筛选同源(logic#navBucketOf) */
  const navItems = useMemo(
    () => [{ id: ALL_CATEGORIES, name: '全部', count: items.length }, ...categoryNavItems(items, categories)],
    [items, categories],
  )

  /** 结果 = 关键词筛选 ∩ 分类筛选。只作用于**已加载**的页(更早的要点「加载更早」才会参与) */
  const shown = useMemo(() => {
    const kw = filterQaRecords(items, keyword)
    if (activeCat === ALL_CATEGORIES) return kw
    return kw.filter((it) => navBucketOf(it.categoryId, categories) === activeCat)
  }, [items, keyword, activeCat, categories])

  // 只读说明行取**已加载全量**口径(不随筛选变动):它描述的是库内状态,不是当前筛选
  const uncategorizedCount = useMemo(
    () =>
      groupByCategory(items, categories).find(
        (g) => g.category.id === UNCATEGORIZED_CATEGORY_ID,
      )?.items.length ?? 0,
    [items, categories],
  )

  // 持久金标徽标:从数据派生(GET_MEMORY_LIST 按 goldens.sourceReplyId 回带 goldenId),
  // 重开 popup、于标准回答页取消后都如实反映库内状态
  const goldenReplyIds = useMemo(() => {
    const s = new Set<string>()
    for (const it of items) for (const r of it.replies) if (r.goldenId) s.add(r.id)
    return s
  }, [items])

  /** 分类名(结果行行尾的灰标);类型表里没有的 id 归未分类,与导航同源 */
  const catNameOf = useCallback(
    (categoryId: string) =>
      categories.find((c) => c.id === navBucketOf(categoryId, categories))?.name ?? '未分类',
    [categories],
  )

  /**
   * 结果集变化时把光标夹回范围内。
   * 不夹的话:筛到只剩 2 条而光标还停在第 7 位 —— 界面上"什么都没有选中",
   * 而 Enter 仍会按老下标去填一条看不见的记录。
   */
  useEffect(() => {
    setSelIdx((i) => Math.min(i, Math.max(0, shown.length - 1)))
  }, [shown.length])

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
          text: `该问题已有 ${p.count} 条标准回答(上限 ${MAX_GOLDENS_PER_QUESTION} 条),请先在标准回答页取消一条`,
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
      await load()
      await onDataChanged()
    } catch (err) {
      setMsg({ ok: false, text: `设置标准回答失败:${String(err)}` })
    } finally {
      setBusyReplyId(null)
    }
  }

  /**
   * ★ 的**开关**:未设 → 设为标准回答;已设 → **取消**(用户第 3 条「也可以取消,目前不支持取消」)。
   *
   * 取消走 `DELETE_GOLDEN{id: goldenId}` —— 与标准回答页上那枚 ✕ 同一条通道。
   * 为什么不是"再 ADD 一次":那只会命中 `exists` 幂等分支,永远取消不掉。
   * 取消**只解除身份**,历史问答记录分毫不受影响(数据库层面也是这个语义)。
   */
  const toggleGolden = async (item: MemoryListItem, r: MemoryReplyItem) => {
    if (!r.goldenId) {
      await setGolden(item, r.id, r.text)
      return
    }
    setBusyReplyId(r.id)
    try {
      const resp = await sendMessage<DeleteGoldenResponse>({
        type: 'DELETE_GOLDEN',
        payload: { id: r.goldenId },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '已取消标准回答,历史记录不受影响' })
        await load()
        await onDataChanged()
      } else {
        setMsg({ ok: false, text: `取消失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `取消失败:${String(err)}` })
    } finally {
      setBusyReplyId(null)
    }
  }

  const deleteQa = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteQaResponse>({ type: 'DELETE_QA', payload: { id } })
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

  const copyReply = async (r: MemoryReplyItem) => {
    try {
      await navigator.clipboard.writeText(r.text)
      setMsg({ ok: true, text: '已复制到剪贴板' })
    } catch {
      setMsg({ ok: false, text: '复制失败' })
    }
  }

  /**
   * 填充一条回复到聊天页输入框。
   *
   * **不带 `itemKind`** —— 逐条用量只对标准回答与知识库记账(`MetricItemKind` 里没有 history):
   * 历史问答 90 天就被 TTL 清掉,给它逐条计数只会攒下查不到主人的孤儿键。
   */
  const fillReply = async (r: MemoryReplyItem) => {
    try {
      const resp = await sendMessage<FillInputResponse>({
        type: 'FILL_INPUT',
        payload: { text: r.text },
      })
      if (resp.payload.success) setMsg({ ok: true, text: '已填充至输入框,发送由人工完成' })
      else setMsg({ ok: false, text: resp.payload.error ?? '填充失败' })
    } catch (err) {
      setMsg({ ok: false, text: `填充失败:${String(err)}` })
    }
  }

  /** 光标移动(夹在 [0, len-1]) */
  const move = (d: number) =>
    setSelIdx((i) => Math.min(Math.max(i + d, 0), Math.max(0, shown.length - 1)))

  /**
   * 键盘是一等公民(方向 1 的立身之本)。
   *
   * 处理挂在**容器**上而不是输入框上:事件从输入框冒泡上来,于是**一边打字一边按 ↑↓ 也生效** ——
   * 这正是 fzf / Raycast 的手感。(参考稿的 demo 里 `↑↓` 在输入框聚焦时被跳过,那是 demo 的将就,
   * 真实工具里"打完字想改选哪一条"是最常见的下一步。)
   *
   * 几个键的归属:
   *  - ↑↓ 移光标(要 `preventDefault`,否则输入框里光标会跳到首尾);
   *  - ↵ 填充**光标那一行的第一条回复** —— 行是问题、填充单位是回复,
   *    一条问题下有多条回复时取最新的那条;要填别的用那条自己的 ★/⧉ 所在行点它自己的填充;
   *  - 1-9 直接把光标跳到第 N 条(不直接填,免得手滑打错数字就填错话术);
   *  - ⇥ 循环切换分类(Shift+⇥ 反向)。
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
      return
    }
    if (e.key === 'Enter') {
      const it = shown[selIdx]
      const first = it?.replies[0]
      if (!first) return
      e.preventDefault()
      void fillReply(first)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ids = navItems.map((n) => n.id)
      const at = ids.indexOf(activeCat)
      const next = (at + (e.shiftKey ? -1 : 1) + ids.length) % ids.length
      setActiveCat(ids[next])
      return
    }
    if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1
      if (n < shown.length) {
        e.preventDefault()
        setSelIdx(n)
      }
    }
  }

  const kbd: React.CSSProperties = {
    border: `1px solid ${tk.border}`,
    padding: '0 4px',
    fontSize: fontSize.count,
    color: tk.textTertiary,
    marginRight: 3,
    backgroundColor: tk.bg,
    fontFamily: 'inherit',
  }

  return (
    <div
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}
    >
      {/* 搜索框(用户:「恢复成原来的样子」)—— 回到带放大镜的普通输入框,
          不再是命令台的 `❯` 提示行。
          **高度取表单档**(components#SearchInput 现在显式给 controlH.form):
          标准回答页那排的主钮也是这个高度,于是两页的**导航栏落在同一个 y 上**(用户第 2 条) */}
      <SearchInput tk={tk} value={keyword} onChange={setKeyword} placeholder="搜索历史问题" />

      <div style={{ padding: `0 ${spacing.xxl}px` }}>
        <CategoryNav tk={tk} items={navItems} active={activeCat} onSelect={setActiveCat} />
      </div>

      {/* 未分类待处理:只读状态,指向设置页(没有操作按钮)。
          「命中 N / M 条」那一行按用户要求删掉了;这一条是**库内状态**不是筛选结果,
          单独留着 —— 它原来就独立成行,是被并进统计行的那一个。
          位置在导航**之后**:放在前面的话,它一出现就把导航往下推,两页又对不齐了 */}
      {uncategorizedCount > 0 && (
        <div
          style={{
            padding: `0 ${spacing.xxl}px`,
            fontSize: fontSize.caption,
            color: tk.textFaint,
            lineHeight: 1.5,
          }}
        >
          未分类 {uncategorizedCount} 条 · 在设置页点「开始分类全部历史」
        </div>
      )}

      <div style={{ padding: `0 ${spacing.xxl}px` }}>
        <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />
      </div>

      {loading && (
        <div style={{ fontSize: fontSize.secondary, color: tk.textMuted, padding: `0 ${spacing.xxl}px` }}>
          读取中…
        </div>
      )}
      {!loading && shown.length === 0 && (
        <EmptyState tk={tk}>
          {items.length === 0 ? (
            <>
              暂无记录
              <br />
              在聊天页与买家对话后将自动捕获
            </>
          ) : hasMore ? (
            <>
              当前已加载的记录里没有匹配项
              <br />
              更早的记录要点下方「加载更早」拉上来才会参与筛选
            </>
          ) : (
            '没有匹配的记录'
          )}
        </EmptyState>
      )}

      {/* ── 结果列表:编号行,选中行反白并**就地展开** ───────────────────────── */}
      {shown.map((item, i) => {
        const on = i === selIdx
        const hasGolden = item.replies.some((r) => goldenReplyIds.has(r.id))
        const days = remainingDays(item.questionTs, now, retentionDays)
        // 反白行上的次要文字:用半透明白叠出层次,而不是再开一种颜色
        const dim = on ? 'rgba(255,255,255,0.6)' : undefined
        return (
          <div key={item.id} style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
            <div
              onClick={() => setSelIdx(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: spacing.lg,
                height: 34,
                padding: `0 ${spacing.xxl}px`,
                cursor: 'pointer',
                fontSize: fontSize.body,
                backgroundColor: on ? tk.text : 'transparent',
                color: on ? tk.bg : tk.textMuted,
                transition: `background-color ${motion.fast}, color ${motion.fast}`,
              }}
              onMouseEnter={(e) => {
                if (on) return
                // §四:列表行悬浮 = 浅底 + 左缘 2px 墨条(inset,零位移)
                e.currentTarget.style.backgroundColor = tk.rowHoverBg
                e.currentTarget.style.boxShadow = `inset 2px 0 0 0 ${tk.rowHoverBar}`
              }}
              onMouseLeave={(e) => {
                if (on) return
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <span
                style={{
                  width: 16,
                  flexShrink: 0,
                  fontSize: fontSize.count,
                  color: dim ?? tk.textFaint,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.question}
              </span>
              {hasGolden && (
                <span
                  title="该问题下已有标准回答"
                  style={{ fontSize: fontSize.count, color: on ? tk.goldenBright : tk.goldenText, flexShrink: 0 }}
                >
                  {GLYPH.star}
                </span>
              )}
              {/* 分类退到行尾灰标(方向 1:「它从『入口』降级成『属性』」)。
                  只有在「全部」视图下才有信息量 —— 已经按某一类筛过时,每行再写一遍类名是纯噪声 */}
              {activeCat === ALL_CATEGORIES && (
                <span style={{ fontSize: fontSize.caption, color: dim ?? tk.textFaint, flexShrink: 0 }}>
                  {catNameOf(item.categoryId)}
                </span>
              )}
              {/* 删除是行级动作,常驻可见(悬浮才显在本项目里被否决过两次)。
                  **点它必须同时把光标移到这一行** —— 确认条画在"光标那行"的展开块里,
                  不移光标的话,点非当前行的 ✕ 会 setConfirmDeleteId 而界面上什么都不出现,
                  看起来就是"点了没反应"(实测踩到)。"对某行动手 = 先选中它"本身也更好懂 */}
              <IconBtn
                tk={tk}
                title="删除该问答(需确认)"
                onClick={() => {
                  setSelIdx(i)
                  setConfirmDeleteId(item.id)
                }}
              >
                {GLYPH.close}
              </IconBtn>
            </div>

            {/* ── 元信息:**常驻在问题下方**(用户第 3 条「时间、回复条数、剩余时间放在问题的下方」)。
                它原来只在展开块里出现 —— 那样"这条还剩几天过期"要选中才看得见,
                而它恰恰是决定"要不要用这条"的信息之一。
                左缘与问题文字同线(ROW_TEXT_X),三行(问题 / 元信息 / 回复)共用同一条竖线 */}
            <div
              style={{
                padding: `0 ${spacing.xxl}px 0 ${ROW_TEXT_X}px`,
                fontSize: fontSize.caption,
                color: tk.textFaint,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.5,
              }}
            >
              {formatTsLocal(item.questionTs)} · {item.replyCount} 条回复 · 剩 {days} 天
            </div>

            {/* ── 选中行就地展开:回复 + 确认行 ────────────────────────────── */}
            {on && (
              <div
                style={{
                  backgroundColor: tk.rowHoverBg,
                  // 左内边距取 **ROW_TEXT_X**:回复的 `›` 与问题文字落在同一条左缘上
                  //(用户第 3 条「回复居左,和问题的左侧对齐」)。原来是 40px 的魔数,
                  // 与问题文字那条线差 2px —— 现在由"行内边距 + 序号宽 + 间距"推出来,不会再漂
                  padding: `${spacing.sm}px ${spacing.xxl}px ${spacing.lg}px ${ROW_TEXT_X}px`,
                }}
              >
                {item.replies.length === 0 && (
                  <div style={{ fontSize: fontSize.secondary, color: tk.textFaint }}>无回复(未结段)</div>
                )}
                {item.replies.map((r, j) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      fontSize: fontSize.secondary,
                      lineHeight: 1.65,
                      color: tk.textMuted,
                      padding: `${spacing.xs}px 0`,
                      borderTop: j > 0 ? `1px solid ${tk.borderLight}` : 'none',
                    }}
                  >
                    <span style={{ color: tk.textFaint, flexShrink: 0 }}>{GLYPH.mark}</span>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {r.text}
                    </span>
                    {/* 每条回复**各自**带两枚图标钮(§五.3 末句:不共享一行按钮) */}
                    <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <IconBtn
                        tk={tk}
                        active={goldenReplyIds.has(r.id)}
                        disabled={busyReplyId === r.id}
                        title={
                          goldenReplyIds.has(r.id)
                            ? '已设为标准回答;再点一次取消'
                            : '将此回复设为标准回答'
                        }
                        onClick={() => void toggleGolden(item, r)}
                      >
                        {GLYPH.star}
                      </IconBtn>
                      <IconBtn tk={tk} title="复制该条回复" onClick={() => void copyReply(r)}>
                        <CopyIcon size={12} strokeWidth={2} />
                      </IconBtn>
                    </span>
                  </div>
                ))}

                {confirmDeleteId === item.id && (
                  <div style={{ marginTop: spacing.sm }}>
                    <ConfirmRow
                      tk={tk}
                      text="删除该问答及其全部回复?"
                      onOk={() => void deleteQa(item.id)}
                      onCancel={() => setConfirmDeleteId(null)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* 分页入口(PM2):显式"加载更早"取代静默截断 */}
      {!loading && hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: `0 ${spacing.xxl}px` }}>
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            style={{
              border: `1px solid ${tk.border}`,
              background: 'transparent',
              color: tk.textMuted,
              fontFamily: 'inherit',
              fontSize: fontSize.caption,
              padding: '4px 12px',
              cursor: loadingMore ? 'default' : 'pointer',
            }}
          >
            {loadingMore ? '读取中…' : `加载更早(${items.length}/${total})`}
          </button>
        </div>
      )}

      {/* ── 底部快捷键条:键盘是一等公民,鼠标是备胎 ──────────────────────────
          sticky bottom:结果一屏放不下时它仍然在 —— 提示条滚走就等于没有提示 */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          gap: spacing.xxl,
          padding: `6px ${spacing.xxl}px`,
          borderTop: `1px solid ${tk.borderStrong}`,
          backgroundColor: tk.bg,
          fontSize: fontSize.caption,
          color: tk.textFaint,
        }}
      >
        <span>
          <kbd style={kbd}>↑↓</kbd>选择
        </span>
        <span>
          <kbd style={kbd}>↵</kbd>填进聊天框
        </span>
        <span>
          <kbd style={kbd}>1-9</kbd>跳到第 N 条
        </span>
        <span>
          <kbd style={kbd}>⇥</kbd>切分类
        </span>
      </div>
    </div>
  )
}

/** 本地时间戳(MM-DD HH:mm):命令台的行内元信息,不引组件库那份以免多一层依赖 */
function formatTsLocal(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
