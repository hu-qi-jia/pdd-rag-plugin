/**
 * 标准回答页 — **手册卡片**(v3.1 方向 5:一页印刷的应答手册)。
 *
 * ```
 * ＋ 新建类型                              ← 主钮压在导航栏上方(§五.5,一页至多一枚)
 * 全部 26 | 售后退换 7 | 尺码推荐 0 | …    ← 分类导航(单行,滚轮横移)
 * ─────────────────────────────────────
 * Q  怎么申请退货?
 *    [已指定] [被用 8 次]                  ← 方括号灰标,零信息的标签不上
 * A  订单页申请售后 → 选择「退货退款」…     ← 答案**完整直出**,不折叠不截断
 *                              ✎  ⇢  ✕   ← 操作图标钮收在右下角
 * ```
 *
 * 三条与旧版的差别(方向 5 的"优化了什么"):
 *  ① 答案加了 **A 前缀**,不再是一段无标记的灰段落 —— Q/A 两个字母固定成一列(12px 槽位),
 *     问题与答案的正文左缘因此**严格对齐**,"哪句是问、哪句是答"由结构保证,不靠猜;
 *  ② 操作图标化(✎/⇢/✕),与记忆页的 ★/⧉ **同规格同语言**(20×20 图标钮);
 *  ③ 操作行顶线删除 —— 靠间距分层,不再多一根线。
 *
 * 一页至多一枚主钮(＋ 新建类型);其余动作用文字指令钮或图标钮。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  CreateCategoryResponse,
  DeleteCategoryResponse,
  DeleteGoldenResponse,
  GetPanelDataResponse,
  PanelCategory,
  PanelGolden,
  RenameCategoryResponse,
  UpdateGoldenCategoryResponse,
  UpdateGoldenResponse,
} from '../types/messages'
import { MAX_GOLDENS_PER_QUESTION } from '../shared/constants'
import {
  categoryNavItems,
  categoryOrder,
  countGoldensByQuestion,
  criteriaOverlapsPresets,
  navBucketOf,
  orderGoldensByRecency,
} from './logic'
import { hashText } from '../shared/text'
import {
  Btn,
  ConfirmRow,
  CreateBtn,
  EmptyState,
  GLYPH,
  IconBtn,
  Notice,
  controlStyle,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { ALL_CATEGORIES, CategoryNav } from '../ui/CategoryNav'
import { fontSize, fontWeight, spacing } from '../ui/design'
import { MoveRightIcon } from '../ui/icons'

/** 元信息灰标:[已指定] / [被用 8 次] / [同问题 2 条] —— 方括号取更浅一档,不跟正文抢墨 */
function Tag({ tk, amber = false, title, children }: {
  tk: ThemeTokens
  /** 唯一的彩色:已指定(用户手工摆的标答) */
  amber?: boolean
  title?: string
  children: React.ReactNode
}) {
  const bracket = { color: tk.border, fontWeight: fontWeight.regular } as const
  return (
    <span title={title} style={{ color: amber ? tk.goldenText : tk.textFaint, fontWeight: amber ? fontWeight.semibold : fontWeight.regular, whiteSpace: 'nowrap' }}>
      <span style={bracket}>[</span>
      {children}
      <span style={bracket}>]</span>
    </span>
  )
}

/** Q / A 字母槽:两行共用同一个宽度,正文左缘因此严格对齐 */
const qaStyle: React.CSSProperties = {
  width: 12,
  flexShrink: 0,
  fontSize: fontSize.caption,
  fontWeight: fontWeight.semibold,
  paddingTop: 3,
}

export function FoldersTab({
  tk,
  onDataChanged,
}: {
  tk: ThemeTokens
  onDataChanged: () => Promise<void> | void
}) {
  const [categories, setCategories] = useState<PanelCategory[]>([])
  const [goldens, setGoldens] = useState<PanelGolden[]>([])
  // 逐条用量(v0.16):条目 id → 被填充次数;"哪条话术真在用"只有这里看得出来
  const [itemUsage, setItemUsage] = useState<Record<string, number>>({})
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)

  // 内联交互状态(同一时刻至多一个激活)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftQ, setDraftQ] = useState('')
  const [draftA, setDraftA] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)
  const [confirmGoldenDelete, setConfirmGoldenDelete] = useState<string | null>(null)

  // 类型 CRUD:新建表单 / 导航行上的改名 / 删除二次确认
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCriteria, setNewCriteria] = useState('')
  const [renamingCat, setRenamingCat] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [confirmCatDelete, setConfirmCatDelete] = useState<string | null>(null)

  /** 当前选中的类型(`ALL_CATEGORIES` = 全部);改名 / 删除跟着它走 */
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const selectCat = (id: string) => {
    setActiveCat(id)
    // 切走时收起改名 / 删除态:它们只对"当前选中的那个类型"有意义
    setRenamingCat(null)
    setConfirmCatDelete(null)
  }

  /** 同问题标准回答条数(questionHash → n) */
  const questionCounts = useMemo(() => countGoldensByQuestion(goldens), [goldens])

  /**
   * 排序:GET_PANEL_DATA 回来的是 `db.goldens.toArray()` = id 序 = **最旧在前** ——
   * 直接渲染会让同问题多条答案把最旧的顶到最前,与"最近设置的靠前"相反。
   */
  const orderedGoldens = useMemo(() => orderGoldensByRecency(goldens), [goldens])

  /** 导航条目 = 全部 + 各类型(含 0 条的)。计数与下面的筛选同源(logic#navBucketOf) */
  const navItems = useMemo(
    () => [
      { id: ALL_CATEGORIES, name: '全部', count: orderedGoldens.length },
      ...categoryNavItems(orderedGoldens, categories),
    ],
    [orderedGoldens, categories],
  )

  /** 当前选中的类型(改名 / 删除入口只对自定义类型给) */
  const activeCategory = useMemo(
    () => categoryOrder(categories).find((c) => c.id === activeCat) ?? null,
    [categories, activeCat],
  )
  const activeIsCustom = activeCategory?.kind === 'custom'

  /**
   * 列表 = 某一类型下的标答,**平铺不分区**。
   * 口径与导航计数同源(`navBucketOf`)—— 两边各自实现一份"这条属于哪一类",
   * 迟早出现"导航写着 3 条、点进去一条都没有"。
   */
  const shownGoldens = useMemo(
    () =>
      activeCat === ALL_CATEGORIES
        ? orderedGoldens
        : orderedGoldens.filter((g) => navBucketOf(g.categoryId, categories) === activeCat),
    [orderedGoldens, categories, activeCat],
  )

  /** 判定说明与预置描述的字符重合度警示(spec §五.3) */
  const overlapWarn = useMemo(
    () => (newCriteria.trim() ? criteriaOverlapsPresets(newCriteria.trim()) : false),
    [newCriteria],
  )

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetPanelDataResponse>({ type: 'GET_PANEL_DATA' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setGoldens(resp.payload.goldens)
        setCategories(resp.payload.categories ?? [])
        setItemUsage(resp.payload.itemUsage ?? {})
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

  const refresh = async () => {
    await load()
    await onDataChanged()
  }

  // ─── 标准回答操作 ──────────────────────────────────────────────────────────────

  const copyGolden = async (g: PanelGolden) => {
    try {
      await navigator.clipboard.writeText(g.answer)
      setMsg({ ok: true, text: '已复制到剪贴板' })
    } catch {
      setMsg({ ok: false, text: '复制失败' })
    }
  }

  const startEdit = (g: PanelGolden) => {
    setEditingId(g.id)
    setDraftQ(g.question)
    setDraftA(g.answer)
    setMovingId(null)
    setConfirmGoldenDelete(null)
  }

  const submitEdit = async () => {
    if (!editingId) return
    try {
      const resp = await sendMessage<UpdateGoldenResponse>({
        type: 'UPDATE_GOLDEN',
        payload: { id: editingId, question: draftQ, answer: draftA },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `保存失败:${resp.payload.error}` })
        return
      }
      setMsg({ ok: true, text: resp.payload.reembed ? '已保存,正在重新生成问题向量' : '已保存' })
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `保存失败:${String(err)}` })
    }
    setEditingId(null)
  }

  /** 移到其他类型:落库即标 manual(机器永不许覆盖用户手工摆放) */
  const moveGolden = async (goldenId: string, categoryId: string) => {
    try {
      const resp = await sendMessage<UpdateGoldenCategoryResponse>({
        type: 'UPDATE_GOLDEN_CATEGORY',
        payload: { id: goldenId, categoryId },
      })
      if (!resp.payload.success) {
        setMsg({ ok: false, text: `移动失败:${resp.payload.error ?? '未知错误'}` })
      } else {
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `移动失败:${String(err)}` })
    }
    setMovingId(null)
  }

  const deleteGolden = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteGoldenResponse>({ type: 'DELETE_GOLDEN', payload: { id } })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '标准回答已删除,历史记录不受影响' })
        await refresh()
      } else {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmGoldenDelete(null)
  }

  // ─── 类型操作 ──────────────────────────────────────────────────────────────────

  const closeCreate = () => {
    setCreating(false)
    setNewName('')
    setNewCriteria('')
  }

  const submitCreate = async () => {
    try {
      const resp = await sendMessage<CreateCategoryResponse>({
        type: 'CREATE_CATEGORY',
        payload: { name: newName, criteria: newCriteria },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `新建失败:${resp.payload.error}` })
        return
      }
      setMsg({ ok: true, text: `类型「${newName.trim()}」已新建` })
      closeCreate()
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `新建失败:${String(err)}` })
    }
  }

  const submitRename = async (id: string) => {
    try {
      const resp = await sendMessage<RenameCategoryResponse>({
        type: 'RENAME_CATEGORY',
        payload: { id, name: renameName },
      })
      if (!resp.payload.success) {
        setMsg({ ok: false, text: `改名失败:${resp.payload.error ?? '未知错误'}` })
        return
      }
      setMsg({ ok: true, text: '类型已改名' })
      setRenamingCat(null)
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `改名失败:${String(err)}` })
    }
  }

  const deleteCategory = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteCategoryResponse>({ type: 'DELETE_CATEGORY', payload: { id } })
      if (!resp.payload.success) {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      } else {
        const moved = resp.payload.movedGoldens ?? 0
        setMsg({
          ok: true,
          text: moved > 0 ? `类型已删除,其中 ${moved} 条标准回答已移到未分类` : '类型已删除',
        })
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmCatDelete(null)
  }

  /** 类型下拉的选项:未分类在内,已删除的类型不在 */
  const categoryOptions = useMemo(
    () =>
      categoryOrder(categories).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      )),
    [categories],
  )

  /**
   * 卡片上的**方括号灰标串**(方向 5 §④)。
   * **零信息标签一律不上**:被用 0 次、向量正常、同问题 1 条 —— 它们不改变用户的判断,
   * 却要在每一张卡上占一行。这条在旧版是一条条加出来的(`>0` 才渲染),这里收成一处。
   */
  const tagsOf = (g: PanelGolden) => {
    const out: { key: string; node: React.ReactNode }[] = []
    if (g.categorySource === 'manual') {
      out.push({
        key: 'manual',
        node: (
          <Tag tk={tk} amber title="这个类型是你手动指定的,机器补分类会跳过它">
            已指定
          </Tag>
        ),
      })
    }
    const n = questionCounts.get(hashText(g.question)) ?? 1
    if (n >= 2) {
      out.push({
        key: 'same',
        node: (
          <Tag
            tk={tk}
            title={`同一问题的标准回答共 ${n} 条(上限 ${MAX_GOLDENS_PER_QUESTION} 条),按设置时间倒序展示`}
          >
            同问题 {n} 条{n >= MAX_GOLDENS_PER_QUESTION ? ' 已满' : ''}
          </Tag>
        ),
      })
    }
    if (itemUsage[g.id] > 0) {
      out.push({
        key: 'usage',
        node: (
          <Tag tk={tk} title={`这条标准回答已被填入输入框 ${itemUsage[g.id]} 次(仅本机计数)`}>
            被用 {itemUsage[g.id]} 次
          </Tag>
        ),
      })
    }
    if (g.hasEmbedding === 0) {
      out.push({ key: 'emb', node: <Tag tk={tk} title="向量还没生成完,生成后才能被检索命中">向量生成中</Tag> })
    }
    if (g.hasEmbedding === -1) {
      out.push({
        key: 'err',
        node: (
          <Tag tk={tk} title="嵌入失败,后台将自动重试">
            嵌入失败
          </Tag>
        ),
      })
    }
    return out
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* 内联新建表单:box 形态(整圈 1px 描边),与下方卡片明确分开 */}
      {creating ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.sm,
            border: `1px solid ${tk.border}`,
            padding: spacing.xl,
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="类型名(如:发票咨询)"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk)}
          />
          <textarea
            value={newCriteria}
            onChange={(e) => setNewCriteria(e.target.value)}
            rows={3}
            placeholder="判定说明(必填):这个类型涵盖哪些问题"
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          <div
            style={{
              fontSize: fontSize.caption,
              lineHeight: 1.6,
              color: overlapWarn ? tk.text : tk.textFaint,
              fontWeight: overlapWarn ? fontWeight.semibold : fontWeight.regular,
            }}
          >
            {overlapWarn ? '! ' : ''}与预置类型含义相近时,分类模型会在两者之间摇摆,全部类型的判断质量一起下降。
          </div>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn tk={tk} variant="primary" onClick={() => void submitCreate()}>
              创建
            </Btn>
            <Btn tk={tk} variant="ghost" onClick={closeCreate}>
              取消
            </Btn>
          </div>
        </div>
      ) : (
        /* 主钮**压在导航栏上方**(§五.5):一页至多一枚,其余动作退成图标钮 / 文字指令钮 */
        <div style={{ display: 'flex' }}>
          <CreateBtn tk={tk} label="新建类型" onClick={() => setCreating(true)} />
        </div>
      )}

      {/* 分类导航 + 当前类型的改名 / 删除(自定义类型才有) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CategoryNav tk={tk} items={navItems} active={activeCat} onSelect={selectCat} />
        </div>
        {activeIsCustom && activeCategory && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <IconBtn
              tk={tk}
              title="重命名类型"
              onClick={() => {
                setRenamingCat(activeCategory.id)
                setRenameName(activeCategory.name)
                setConfirmCatDelete(null)
              }}
            >
              {GLYPH.edit}
            </IconBtn>
            <IconBtn
              tk={tk}
              title="删除类型"
              onClick={() => {
                setConfirmCatDelete(activeCategory.id)
                setRenamingCat(null)
              }}
            >
              {GLYPH.close}
            </IconBtn>
          </div>
        )}
      </div>

      {renamingCat && (
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
          <input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            autoFocus
            className="pddcs-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename(renamingCat)
              if (e.key === 'Escape') setRenamingCat(null)
            }}
            style={controlStyle(tk, 26, { flex: 1, minWidth: 0 })}
          />
          <Btn tk={tk} variant="primary" onClick={() => void submitRename(renamingCat)}>
            保存
          </Btn>
          <Btn tk={tk} variant="ghost" onClick={() => setRenamingCat(null)}>
            取消
          </Btn>
        </div>
      )}
      {confirmCatDelete && activeCategory && (
        <ConfirmRow
          tk={tk}
          text={`删除「${activeCategory.name}」?其中的标准回答会移到未分类,不会消失`}
          onOk={() => void deleteCategory(confirmCatDelete)}
          onCancel={() => setConfirmCatDelete(null)}
        />
      )}

      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      {shownGoldens.length === 0 && (
        <EmptyState tk={tk}>
          {goldens.length === 0 ? (
            <>
              暂无标准回答
              <br />
              在聊天页候选弹窗或记忆列表中可将优质回复沉淀为标准回答
            </>
          ) : activeIsCustom ? (
            <>
              这个类型下还没有标准回答
              <br />
              用卡片上的「移动到其他类型」把标答摆进来
            </>
          ) : (
            '这个分类下还没有标准回答'
          )}
        </EmptyState>
      )}

      {/* ── 手册卡片 ─────────────────────────────────────────────────────────── */}
      {shownGoldens.map((g) => (
        <div
          key={g.id}
          style={{
            // 用户第 4 条「每一个卡片中的上下空隙也减小,使其紧凑一点」:11/8 → 8/6
            padding: `${spacing.md}px ${spacing.xxl}px ${spacing.sm}px`,
            borderBottom: `1px solid ${tk.borderLight}`,
            transition: `background-color ${motionFast}, box-shadow ${motionFast}`,
          }}
          onMouseEnter={(e) => {
            // §四:悬浮 = 浅底 + 左缘 2px 墨条(inset,零位移)
            e.currentTarget.style.backgroundColor = tk.rowHoverBg
            e.currentTarget.style.boxShadow = `inset 2px 0 0 0 ${tk.rowHoverBar}`
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          {editingId === g.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              <input
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                className="pddcs-input"
                style={inputStyle(tk)}
              />
              <textarea
                value={draftA}
                onChange={(e) => setDraftA(e.target.value)}
                rows={4}
                className="pddcs-input"
                style={inputStyle(tk, { resize: 'vertical' })}
              />
              <div style={{ display: 'flex', gap: spacing.sm }}>
                <Btn tk={tk} variant="primary" title="保存后自动重新生成问题向量" onClick={() => void submitEdit()}>
                  保存
                </Btn>
                <Btn tk={tk} variant="ghost" onClick={() => setEditingId(null)}>
                  取消
                </Btn>
              </div>
            </div>
          ) : (
            <>
              {/* Q 行 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md }}>
                <span style={{ ...qaStyle, color: tk.textFaint }}>Q</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: fontSize.heading,
                    fontWeight: fontWeight.semibold,
                    color: tk.text,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                  }}
                >
                  {g.question}
                </span>
              </div>

              {/* 灰标串:左缩进 = Q 槽宽 + 间距,与 Q/A 的正文同一条左缘 */}
              {tagsOf(g).length > 0 && (
                <div
                  style={{
                    margin: `${spacing.xs - 1}px 0 0 ${12 + spacing.md}px`,
                    display: 'flex',
                    gap: 7,
                    flexWrap: 'wrap',
                    fontSize: fontSize.caption,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {tagsOf(g).map((t) => (
                    <React.Fragment key={t.key}>{t.node}</React.Fragment>
                  ))}
                </div>
              )}

              {/* A 行:**完整直出**,不折叠不截断 —— 标准回答是成品,扫一眼就要能确认能不能直接用 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md, marginTop: 5 }}>
                <span style={{ ...qaStyle, color: tk.textFaint }}>A</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: fontSize.answer,
                    color: tk.textMuted,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {g.answer}
                </span>
              </div>

              {confirmGoldenDelete === g.id && (
                <div style={{ marginTop: spacing.sm }}>
                  <ConfirmRow
                    tk={tk}
                    text="删除这条标准回答?(历史记录不受影响)"
                    onOk={() => void deleteGolden(g.id)}
                    onCancel={() => setConfirmGoldenDelete(null)}
                  />
                </div>
              )}

              {/* 操作收在**右下角**(方向 5 §③):✎ 编辑 / ⇢ 移动 / ✕ 删除。
                  与记忆页的 ★/⧉ 同规格同语言 —— 全站一套手势。
                  迁移态占用同一位置(下拉替掉这三个钮),状态切换时动作区不动窝 */}
              {/* 操作图标钮(v3.1 §五.4「收在卡片右下角」→ **用户第 4 条改为居左**):
                  左内边距取 `Q/A 槽宽 + 间距`,于是这四枚钮的**左缘与问题/答案的正文同一竖线**;
                  与上方文字的间距由 spacing.md(8)收到 spacing.xs(4),整张卡更紧凑 */}
              <div
                style={{
                  marginTop: spacing.xs,
                  paddingLeft: 12 + spacing.md,
                  display: 'flex',
                  gap: 2,
                }}
              >
                {movingId === g.id ? (
                  <select
                    autoFocus
                    value={g.categoryId}
                    onChange={(e) => void moveGolden(g.id, e.target.value)}
                    onBlur={() => setMovingId(null)}
                    className="pddcs-select"
                    style={{
                      maxWidth: 160,
                      borderColor: tk.border,
                      backgroundColor: tk.inputBg,
                      color: tk.text,
                      flexShrink: 0,
                    }}
                  >
                    {categoryOptions}
                  </select>
                ) : (
                  <>
                    <IconBtn tk={tk} title="复制这条回答" onClick={() => void copyGolden(g)}>
                      <CopyGlyph />
                    </IconBtn>
                    <IconBtn
                      tk={tk}
                      title="编辑"
                      onClick={() => {
                        setMovingId(null)
                        startEdit(g)
                      }}
                    >
                      {GLYPH.edit}
                    </IconBtn>
                    <IconBtn
                      tk={tk}
                      title="移动到其他类型"
                      onClick={() => {
                        setConfirmGoldenDelete(null)
                        setMovingId(g.id)
                      }}
                    >
                      <MoveRightIcon size={12} strokeWidth={2} />
                    </IconBtn>
                    <IconBtn
                      tk={tk}
                      title="删除(历史记录不受影响)"
                      onClick={() => {
                        setMovingId(null)
                        setConfirmGoldenDelete(g.id)
                      }}
                    >
                      {GLYPH.close}
                    </IconBtn>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      <div
        style={{
          padding: `${spacing.md}px 0 ${spacing.xxl}px`,
          textAlign: 'center',
          fontSize: fontSize.caption,
          color: tk.textFaint,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        … 共 {shownGoldens.length} 条标准回答
      </div>
    </div>
  )
}

/** 复制图标(⧉ 在 Windows 字体里常缺字,故这一枚继续用 SVG —— 见 components#GLYPH 的边界说明) */
function CopyGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

/** 动效时长(局部别名,避免为此多引一个令牌名) */
const motionFast = '0.12s linear'
