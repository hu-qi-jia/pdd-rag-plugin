/**
 * 标准回答页(P3,设计文档 §7)—— 按**问题类型**分区(第五十七轮 Task 6)。
 *
 * 结构:提示条 → 类型分区容器(标题「类型名 · 条数」)→ 标准回答行。
 *
 * 历史:本页原为两层文件夹树(工具栏新建 / 重命名 / 删除 / 遗留子夹拍平)。
 * folders 表与 goldens.folderId 保留不删(回滚用),但**本页不再读写它们** ——
 * 分区改由 categories 承担;类型的新建 / 改名 / 删除(第五十七轮 Task 7)也在这里:
 * 页头「新建类型」内联表单 + 自定义分区头的改名/删除图标钮(预置与未分类无钮;
 * 重名与空判定说明由后台 handler 硬拦截,删除时其中的标答落回未分类)。
 *
 * 行操作:**四个图标钮(移到类型/复制/编辑/删除)默认可见、整组靠右**。
 * (v2.6.29~v2.6.31 那版是靠左 + 负 margin 让图标左缘对齐正文;v3.0 第二版按用户
 *  「标准回答页面看起来怪怪的」改为靠右 —— 一行正文左下角单独吊着四个图标,
 *  读起来像"每条后面跟了一条工具栏",而靠右后它与问题行的右端元信息同处一条右缘。)
 * 填充能力保留在聊天页面板与知识库页。
 * 「移到其他类型」用仓库既有的原生 <select> 写法(不引入下拉组件),选中即发
 * UPDATE_GOLDEN_CATEGORY 并刷新。
 * 用户手工摆放过的标答(categorySource === 'manual')在问题行挂「已指定」徽标 ——
 * 让用户看得出哪些是机器打的、哪些是自己摆的。
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
  Card,
  ConfirmRow,
  CreateBtn,
  EmptyState,
  Notice,
  controlStyle,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { ALL_CATEGORIES, CategoryNav } from '../ui/CategoryNav'
import { controlH, fontSize, fontWeight, listRow, motion, radius, size, spacing } from '../ui/design'
import { CopyIcon, PencilIcon, TagIcon, TrashIcon } from '../ui/icons'

/**
 * 行内图标的渲染尺寸(铁律:改这里,不要在各处写 `size={13}`)。
 * 取 `design.size.icon`,与聊天页覆盖层的 `overlay-icons.ICON_SIZE` 同源。
 *
 * 这里原本还有一个 `ICON_BTN_INSET = (24 − 13) / 2 = 5.5px`,用来把**靠左排列**的
 * 图标钮组往左拉 5.5px,使**图标**(而非钮盒)与正文左缘对齐(v2.6.31 的铁律)。
 * v3.0 第二版操作组改为**靠右**之后,"靠左排列"这个前提没有了,该补偿量随之退役 ——
 * 靠右的组不需要补偿,它对齐的是右缘。
 */
export const ICON_SIZE = size.icon

/** 操作组对齐档:靠右顶到行尾(图标钮组与标题栏)/ 靠左贴正文(文字钮、类型下拉) */
type OpsAlign = 'right' | 'text'

/** 标准回答行与所在分区共用的左基线(第五十七轮:分区压平成一层,不再有深度参数) */
// 行内容的左缘补偿。**归零**(v3.0 第二版):此前行内容比分区标题右缩 12px,
// 于是同一页上有三条不同的左缘 —— 分区标题/分隔线在内容盒左缘(0),
// 行文字在其右 12px,操作钮盒又因负边距落在 5.5px(v2.6.29 那套"图标左缘对齐正文"的补偿)。
// 用户:「有很多字段的排版应该对齐」。现在全部归到**内容盒左缘**这一条竖线上:
// 分区标题、问题、答复预览、操作钮、上缘分隔线共用同一个 x。
const ROW_INDENT = 0

const clamp2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'break-word',
}

const clamp1: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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

  // 类型 CRUD(第五十七轮 Task 7):新建表单 / 分区头改名 / 删除二次确认(同一时刻至多一个)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCriteria, setNewCriteria] = useState('')
  const [renamingCat, setRenamingCat] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [confirmCatDelete, setConfirmCatDelete] = useState<string | null>(null)
  /**
   * 当前选中的类型(`ALL_CATEGORIES` = 全部)。
   *
   * v3.0 第四版:类型改由**顶部导航**表达,列表平铺不再分区(用户:「不要按照文件夹的样式设计了…
   * 在顶部增加导航栏,导航栏中展示全部分类」)。改名 / 删除于是跟着"当前选中的那个类型"走 ——
   * 它们原来挂在每个分区的标题行上,分区一没,入口就得有个新家。
   */
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const selectCat = (id: string) => {
    setActiveCat(id)
    // 切走时收起改名 / 删除态:它们只对"当前选中的那个类型"有意义
    setRenamingCat(null)
    setConfirmCatDelete(null)
  }

  /** 同问题标准回答条数(questionHash → n):多答案问题的行上标注 n / 已满 */
  const questionCounts = useMemo(() => countGoldensByQuestion(goldens), [goldens])

  /**
   * 分区前必须**先把顺序排好**(groupByCategory 的契约:组内保持传入顺序,它不排)。
   * GET_PANEL_DATA 回来的是 `db.goldens.toArray()` = id 序 = **最旧在前** ——
   * 直接喂给 groupByCategory 会让同问题的多条答案把最旧的顶到最前,与既定口径相反。
   * 这里补回旧路径(`buildFolderTree`)原有的 `orderGoldensByRecency`:同问题多条按
   * updatedAt 倒序(最近设置的靠前,与聊天页候选同一口径)。
   */
  const orderedGoldens = useMemo(() => orderGoldensByRecency(goldens), [goldens])

  /** 类型下拉的选项:未分类在内,已删除的类型不在(它本来就不在类型表里) */
  const categoryOptions = useMemo(
    () =>
      categoryOrder(categories).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      )),
    [categories],
  )

  /** 导航条目 = 全部 + 各类型(含 0 条的)。计数与下面的筛选同源(logic#navBucketOf) */
  const navItems = useMemo(
    () => [
      { id: ALL_CATEGORIES, name: '全部', count: orderedGoldens.length },
      ...categoryNavItems(orderedGoldens, categories),
    ],
    [orderedGoldens, categories],
  )

  /** 当前选中的类型(用于改名/删除:只有自定义类型给入口) */
  const activeCategory = useMemo(
    () => categoryOrder(categories).find((c) => c.id === activeCat) ?? null,
    [categories, activeCat],
  )
  const activeIsCustom = activeCategory?.kind === 'custom'

  /**
   * 列表 = 某一类型下的标答,**平铺不分区**。
   * 口径与导航计数同源(`navBucketOf`:类型表里没有的 categoryId 并进未分类)——
   * 两边各自实现一份"这条属于哪一类",迟早出现"导航写着 3 条、点进去一条都没有"。
   */
  const shownGoldens = useMemo(
    () =>
      activeCat === ALL_CATEGORIES
        ? orderedGoldens
        : orderedGoldens.filter((g) => navBucketOf(g.categoryId, categories) === activeCat),
    [orderedGoldens, categories, activeCat],
  )

  /** 判定说明与预置描述的字符重合度警示(spec §五.3):不做计算式拦截,只把说明行标红 */
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
      setMsg({
        ok: true,
        text: resp.payload.reembed ? '已保存,正在重新生成问题向量' : '已保存',
      })
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
      const resp = await sendMessage<DeleteGoldenResponse>({
        type: 'DELETE_GOLDEN',
        payload: { id },
      })
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

  // ─── 类型操作(第五十七轮 Task 7)────────────────────────────────────────────────

  const closeCreate = () => {
    setCreating(false)
    setNewName('')
    setNewCriteria('')
  }

  /** 新建类型:name 与 criteria 的合法性由后台 handler 判定,这里只回显拒绝理由 */
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

  /** 改名(仅自定义类型;判定说明不在此列,不必重填) */
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

  /** 删除自定义类型:其中的标答由后台在事务里落回未分类(不丢数据) */
  const deleteCategory = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteCategoryResponse>({
        type: 'DELETE_CATEGORY',
        payload: { id },
      })
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

  // ─── 视觉原语 ──────────────────────────────────────────────────────────────────

  /** 图标操作钮(透明底 → 浅灰,危险项悬浮红) */
  const iconBtn = (
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false,
  ): React.ReactNode => {
    const hoverBg = danger ? tk.errorBg : tk.btnHoverBg
    const hoverColor = danger ? tk.errorText : tk.text
    return (
      <button
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        style={{
          width: controlH.inline,
          height: controlH.inline,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: radius.sm,
          backgroundColor: 'transparent',
          color: tk.textTertiary,
          cursor: 'pointer',
          padding: 0,
          transition: `background-color ${motion.fast}, color ${motion.fast}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = hoverBg
          e.currentTarget.style.color = hoverColor
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = tk.textTertiary
        }}
      >
        {icon}
      </button>
    )
  }

  /**
   * 操作钮容器:整组**常驻可见**(v2.6.31 用户"默认展示吧,不要鼠标悬浮再展示",悬浮显隐机制退役)。
   * `align` 两档(v3.0 第二版:`icon` 档随"图标左缘对齐正文"那条铁律一并退役):
   *   - `right`(默认):靠右顶到行尾(行操作栏、分区标题栏);
   *   - `text` :靠左,钮盒直接贴正文左缘(文字钮与类型下拉 —— 钮自身有内边距,不再补偿)。
   */
  const opsWrap = (children: React.ReactNode, align: OpsAlign = 'right'): React.ReactNode => (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginLeft: align === 'right' ? 'auto' : 0,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )

  /** 内联确认行(删除二次确认):文案 + 确认/取消。样式在 ui/components#ConfirmRow(第五十一轮共享) */
  const confirmRow = (text: string, onOk: () => void, onCancel: () => void): React.ReactNode => (
    <div style={{ padding: `${spacing.xs}px 0 ${spacing.xs + 2}px` }}>
      <ConfirmRow tk={tk} text={text} onOk={onOk} onCancel={onCancel} />
    </div>
  )

  // ─── 标准回答行 ────────────────────────────────────────────────────────────────

  /**
   * 标准回答行的**行尾操作列**(v3.0 第三版:从"独占一行"上移到主行右端)。
   *
   * 三种状态占用**同一个位置**:常态四枚图标钮 / 删除确认的「确认 · 取消」/ 迁移的类型下拉。
   * 位置不变是关键 —— 状态切换时动作区不动窝,行高也不跳。
   * 整列常驻可见:悬浮才显在本项目里被明确否决过(「隐蔽入口不可发现」踩过两次坑)。
   */
  const renderGoldenOps = (g: PanelGolden): React.ReactNode =>
    confirmGoldenDelete === g.id ? (
      opsWrap(
        <>
          <BtnMini tk={tk} danger onClick={() => void deleteGolden(g.id)}>
            确认
          </BtnMini>
          <BtnMini tk={tk} onClick={() => setConfirmGoldenDelete(null)}>取消</BtnMini>
        </>,
        'text',
      )
    ) : movingId === g.id ? (
      opsWrap(
        <>
          {/* 迁移下拉:走 .pddcs-select —— 保留系统控件的原生外观(含系统箭头),
              只对齐高度、描边与字号。极客工具风要的正是"这是一枚系统控件",
              不重画箭头、不套自定义弹层 */}
          <select
            autoFocus
            value={g.categoryId}
            onChange={(e) => void moveGolden(g.id, e.target.value)}
            onBlur={() => setMovingId(null)}
            className="pddcs-select"
            style={{
              maxWidth: 140,
              borderColor: tk.btnBorder,
              backgroundColor: tk.inputBg,
              color: tk.text,
              flexShrink: 0,
            }}
          >
            {categoryOptions}
          </select>
        </>,
        'text',
      )
    ) : (
      opsWrap(
        <>
          {iconBtn('移到其他类型', <TagIcon size={ICON_SIZE} strokeWidth={2} />, () => {
            setMovingId(g.id)
            setConfirmGoldenDelete(null)
          })}
          {iconBtn('复制', <CopyIcon size={ICON_SIZE} strokeWidth={2} />, () => void copyGolden(g))}
          {iconBtn('编辑', <PencilIcon size={ICON_SIZE} strokeWidth={2} />, () => startEdit(g))}
          {iconBtn(
            '删除(历史记录不受影响)',
            <TrashIcon size={ICON_SIZE} strokeWidth={2} />,
            () => {
              setConfirmGoldenDelete(g.id)
              setMovingId(null)
            },
            true,
          )}
        </>,
        'right',
      )
    )

  /**
   * 标准回答行的**元信息**(v3.0 第三版:由"标题行上四枚右对齐小块"合并成一条)。
   *
   * 合并口径:统一字号 `fontSize.caption`、统一颜色 `textTertiary`、` · ` 分隔。
   * **信息量与合并前逐项相等** —— 是把它们排成一行,不是删减。
   * 合并前每一项都自带 `flexShrink: 0` 顶在标题行右侧,标题被挤掉三成宽度;
   * 现在它们整条落在标题下面的专属行里,标题拿回整行,元信息也不再参差。
   */
  const metaBits = (g: PanelGolden): { text: string; title?: string; danger?: boolean }[] => {
    const bits: { text: string; title?: string; danger?: boolean }[] = []
    // 手工摆放标记(第五十七轮):'manual' = 用户自己摆的,机器补分类会跳过。
    // 机器打的标(jev / 缺省)不列 —— 两者必须一眼可分
    if (g.categorySource === 'manual') {
      bits.push({ text: '已指定', title: '这个类型是你手动指定的,机器补分类会跳过它' })
    }
    const n = questionCounts.get(hashText(g.question)) ?? 1
    if (n >= 2) {
      bits.push({
        text: `同问题 ${n} 条`,
        title: `同一问题的标准回答共 ${n} 条(上限 ${MAX_GOLDENS_PER_QUESTION} 条),按设置时间倒序展示`,
      })
      if (n >= MAX_GOLDENS_PER_QUESTION) {
        bits.push({ text: '已满', title: `已达上限 ${MAX_GOLDENS_PER_QUESTION} 条,再设需要先取消一条` })
      }
    }
    // 被用次数(v0.16):只在真被填过时出现 —— 0 次的行平白多一枚灰标,
    // 新库满屏"被用 0 次",噪声盖过信息
    if (itemUsage[g.id] > 0) {
      bits.push({
        text: `被用 ${itemUsage[g.id]} 次`,
        title: `这条标准回答已被填入输入框 ${itemUsage[g.id]} 次(仅本机计数)`,
      })
    }
    if (g.hasEmbedding === 0) bits.push({ text: '向量生成中' })
    if (g.hasEmbedding === -1) {
      bits.push({ text: '嵌入失败', title: '嵌入失败,后台将自动重试', danger: true })
    }
    return bits
  }

  const goldenRow = (g: PanelGolden): React.ReactNode => {
    const editing = editingId === g.id
    const moving = movingId === g.id
    if (editing) {
      return (
        <div
          key={g.id}
          style={{
            // 左右都归零:内容列本身已有 16px 页边距,再各加一段内边距就成了左右不对称
            padding: `${spacing.md}px 0 ${spacing.sm}px ${ROW_INDENT}px`,
            borderBottom: `1px solid ${tk.borderLight}`,
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.sm,
          }}
        >
          <textarea
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            rows={2}
            placeholder="标准问题"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          <textarea
            value={draftA}
            onChange={(e) => setDraftA(e.target.value)}
            rows={4}
            placeholder="标准回复"
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <BtnMini tk={tk} primary title="保存后自动重新生成问题向量" onClick={() => void submitEdit()}>
              保存
            </BtnMini>
            <BtnMini tk={tk} onClick={() => setEditingId(null)}>取消</BtnMini>
          </div>
        </div>
      )
    }
    return (
      <div
        key={g.id}
        style={{
          // 同上:左右都归零 —— 行的左缘 = 分区标题 = 分隔线 = 操作栏右缘的镜像,四条边一条线
          padding: `${spacing.md}px 0 ${spacing.sm + 2}px ${ROW_INDENT}px`,
          borderBottom: `1px solid ${tk.borderLight}`,
          // 悬浮(选中)态(第六十四轮):浅底 + 左缘 2px 墨条(boxShadow inset,零位移)。
          // 旧版只有一块浅底,在一屏灰白行里"指针在哪"要找一下;左墨条把行钉住,
          // 与记忆页同一套表达 —— 两页共用同一行骨架(design.ts#listRow)与同一行状态语言
          transition: `background-color ${motion.fast}, box-shadow ${motion.fast}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = tk.bgSecondary
          e.currentTarget.style.boxShadow = `inset 2px 0 0 0 ${tk.text}`
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* ── 主行:标题 + 行尾操作列 ─────────────────────────────────────
            两段式骨架(见 design.ts#listRow 与 DESIGN §七-G)。此前这一行是**三段**:
            标题行上挤着至多四枚右对齐徽标(已指定 / 同问题 N 条 / 被用 N 次 / 向量状态),
            答复预览一行,底下再吊一整行四个图标钮 —— 元素各自漂浮,是"看起来乱"的根。
            现在:标题行只放标题 + 行尾动作;所有标记与计数**合并成一条元信息行**;
            操作钮从第三行**上移**到主行右端,跨行成一条右缘 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold,
              lineHeight: listRow.titleLineHeight,
              ...clamp1,
            }}
          >
            {g.question}
          </div>

          {/* 行尾操作列:常驻可见(本页从 v2.6.31 起就是常驻,悬浮才显被明确否决过)。
              四个图标钮在这里、确认/取消与迁移下拉也在**同一个位置**出现 ——
              状态切换时动作区不动窝,行高也不跳 */}
          <div style={{ flexShrink: 0, marginTop: listRow.opsOffsetY }}>
            {renderGoldenOps(g)}
          </div>
        </div>

        {/* ── 元信息行:所有标记与计数合并成一条 ──────────────────────────
            统一字号(fontSize.caption)、统一颜色(textTertiary)、`·` 分隔。
            此前它们各自是行内的一个右对齐小块,字号颜色还不都一样,
            一屏十几条下来就是一片参差的小字。合并不减信息,只是把它们排成一行 */}
        {metaBits(g).length > 0 && (
          <div
            style={{
              fontSize: fontSize.caption,
              color: tk.textTertiary,
              marginTop: 2,
              lineHeight: listRow.metaLineHeight,
            }}
          >
            {metaBits(g).map((b, i) => (
              <React.Fragment key={b.text}>
                {i > 0 && ' · '}
                <span title={b.title} style={{ color: b.danger ? tk.errorText : undefined }}>
                  {b.text}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* 答复 = **一只方框**(v3.0 第四版,与记忆页的回复框同一形态,照用户给的参考图)。
            描边取 `tk.border`(容器那一档):它是一只盒子,不是又一根行分隔线 */}
        <div
          style={{
            marginTop: spacing.sm,
            border: `1px solid ${tk.border}`,
            padding: `${spacing.sm}px ${spacing.sm}px`,
          }}
        >
          <div
            style={{
              fontSize: fontSize.secondary,
              color: tk.textMuted,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              ...clamp2,
            }}
          >
            {g.answer}
          </div>
        </div>
      </div>
    )
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      {/* 内联新建表单:box 形态(整圈 1px 描边)——
          它是一块**临时面板**,不画框就会和下方已有的类型分区糊在一起 */}
      {creating ? (
        <Card tk={tk} variant="box" style={{ gap: spacing.md }}>
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
          {/* spec §五.3:与预置含义重叠不做计算式拦截,只在描述字符高度重合时把这行标红 */}
          <div
            style={{
              fontSize: fontSize.secondary,
              lineHeight: 1.6,
              color: overlapWarn ? tk.errorText : tk.textTertiary,
            }}
          >
            与预置类型含义相近时,分类模型会在两者之间摇摆,<b>全部类型</b>的判断质量一起下降。
          </div>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn tk={tk} variant="primary" onClick={() => void submitCreate()}>
              创建
            </Btn>
            <Btn tk={tk} variant="ghost" onClick={closeCreate}>
              取消
            </Btn>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <CreateBtn tk={tk} label="新建类型" onClick={() => setCreating(true)} />
        </div>
      )}

      {/* 分类导航 + 当前类型的操作。导航取代了原来的类型分区标题 ——
          类型从此只有这一个表达处,不再在列表里重复一遍 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CategoryNav tk={tk} items={navItems} active={activeCat} onSelect={selectCat} />
        </div>
        {/* 改名 / 删除只对**自定义**类型开放(预置与未分类不可改不可删)——
            不给它们挂按钮,而不是挂上再禁用:挂上再禁用还得解释为什么 */}
        {activeIsCustom && activeCategory && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            {iconBtn('重命名类型', <PencilIcon size={ICON_SIZE} strokeWidth={2} />, () => {
              setRenamingCat(activeCategory.id)
              setRenameName(activeCategory.name)
              setConfirmCatDelete(null)
            })}
            {iconBtn(
              '删除类型',
              <TrashIcon size={ICON_SIZE} strokeWidth={2} />,
              () => {
                setConfirmCatDelete(activeCategory.id)
                setRenamingCat(null)
              },
              true,
            )}
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
            style={controlStyle(tk, controlH.form, { flex: 1, minWidth: 0 })}
          />
          <BtnMini tk={tk} primary onClick={() => void submitRename(renamingCat)}>
            保存
          </BtnMini>
          <BtnMini tk={tk} onClick={() => setRenamingCat(null)}>
            取消
          </BtnMini>
        </div>
      )}
      {confirmCatDelete &&
        activeCategory &&
        confirmRow(
          `删除「${activeCategory.name}」?其中的标准回答会移到未分类,不会消失`,
          () => void deleteCategory(confirmCatDelete),
          () => setConfirmCatDelete(null),
        )}

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
              用条目上的「移到其他类型」把标答摆进来
            </>
          ) : (
            '这个分类下还没有标准回答'
          )}
        </EmptyState>
      )}

      {/* 列表:**平铺**一行一条,类型已由顶部导航表达 */}
      {shownGoldens.map((g) => goldenRow(g))}

      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        优质回复可在聊天页面板或记忆页设为标准回答;同一问题最多 3 条,检索命中时置顶。
      </div>
    </div>
  )
}

// ─── 小工具 ────────────────────────────────────────────────────────────────────

/** 行内小按钮(保存/取消/确认),高度取 controlH.inline 与同排图标钮等高 */
function BtnMini({
  tk,
  children,
  onClick,
  primary,
  danger,
  title,
}: {
  tk: ThemeTokens
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  danger?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        height: controlH.inline,
        padding: '0 10px',
        border: primary || danger ? 'none' : `1px solid ${tk.btnBorder}`,
        borderRadius: radius.sm,
        backgroundColor: primary ? tk.btnPrimaryBg : danger ? tk.errorBg : 'transparent',
        color: primary ? tk.btnPrimaryText : danger ? tk.errorText : tk.textMuted,
        fontSize: fontSize.caption,
        fontWeight: primary || danger ? fontWeight.semibold : fontWeight.regular,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

// ─── 判定说明与预置的"含义相近"提示(spec §五.3,纯提示不做拦截)──────────────────
// 计算本体在 popup/logic.ts(与其它纯逻辑同层,便于单测);此处只负责调用与展示。
