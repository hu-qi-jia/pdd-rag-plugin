/**
 * 标准回答页 — v4.0「Codex × iOS · 黑灰白」
 * (文件与导出名保留 `FoldersTab`,文件夹模块早已下线,改名会牵动大量引用)
 *
 * 结构:「＋ 新建类型」→ 分类导航(pill)→ Q/A 卡流。
 *
 * v4.0 相对上一版的三处:
 *  ① **不再是卡片**。上一版每张标答是一个带 hover 底的独立块,一屏看下来是
 *     "一堆盒子";现在它退成列表里的一段 —— 边界由**缩进的发丝线**给。
 *  ② **操作行左对齐**,与 Q/A 正文同一条竖线。上一版靠右,读起来像"另起一个区块",
 *     跟这张卡拉不上关系。(对齐的 6px 补偿见 popup-css `.pddcs-gops`)
 *  ③ **[被用 N 次] 删掉**。用量数据本身还在(设置 · 使用统计),只是不再挂在每张卡上。
 *
 * 保留:同问题条数上限(3 条)、手工分类标记(「已指定」)、类型的新建/改名/删除
 * 与后台的硬校验(重名、空判定说明、删除时标答落回未分类)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  IMAGE_PLACEHOLDER,
  LOW_CONFIDENCE_LINE,
  MAX_GOLDENS_PER_QUESTION,
  isLowConfidenceCategory,
} from '../shared/constants'
import { thumbUrl } from '../shared/images'
import type { ImageAttachment } from '../types/memory'
import {
  ALL_CATEGORY_ID,
  catNavItems,
  categoryOrder,
  countGoldensByQuestion,
  criteriaOverlapsPresets,
  filterByCategory,
  orderGoldensByRecency,
  recordLevelCategories,
} from './logic'
import { hashText } from '../shared/text'
import {
  Btn,
  CatNav,
  ConfirmRow,
  CreateBtn,
  EmptyState,
  IconBtn,
  List,
  Notice,
  Tag,
  Toolbar,
  controlStyle,
  hairStyle,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { controlH, fontSize, formGap, pageGap, size, spacing } from '../ui/design'
import { CopyIcon, PencilIcon, TagIcon, TrashIcon } from '../ui/icons'

/** 图标渲染尺寸(与聊天页覆盖层的 overlay-icons.ICON_SIZE 同源) */
export const ICON_SIZE = size.iconBtn

export function FoldersTab({ onDataChanged }: { onDataChanged: () => Promise<void> | void }) {
  const [categories, setCategories] = useState<PanelCategory[]>([])
  const [goldens, setGoldens] = useState<PanelGolden[]>([])
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)

  /** 选中的分类;默认「全部」 */
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORY_ID)

  // 内联交互状态(同一时刻至多一个激活)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftQ, setDraftQ] = useState('')
  const [draftA, setDraftA] = useState('')
  /** 编辑中的图片附件(与 draftQ/draftA 同生共死:保存才落库) */
  const [draftImgs, setDraftImgs] = useState<ImageAttachment[]>([])
  const [imgUrl, setImgUrl] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)
  const [confirmGoldenDelete, setConfirmGoldenDelete] = useState<string | null>(null)

  // 类型 CRUD:新建表单 / 选中类型的改名 / 删除二次确认
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCriteria, setNewCriteria] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [confirmCatDelete, setConfirmCatDelete] = useState(false)

  /** 同问题标准回答条数(questionHash → n):多答案问题的行上标注 n / 已满 */
  const questionCounts = useMemo(() => countGoldensByQuestion(goldens), [goldens])

  /**
   * 排序必须**先于**筛选与计数:`orderGoldensByRecency` 让同问题的多条答案按
   * updatedAt 倒序(最近设置的靠前,与聊天页候选同一口径)。GET_PANEL_DATA 回来的是
   * id 序 = 最旧在前,直接用会把最旧的顶到最前。
   */
  const orderedGoldens = useMemo(() => orderGoldensByRecency(goldens), [goldens])

  const navItems = useMemo(
    () => catNavItems(orderedGoldens, categories),
    [orderedGoldens, categories],
  )
  const visible = useMemo(
    () => filterByCategory(orderedGoldens, activeCat, categories),
    [orderedGoldens, activeCat, categories],
  )

  /** 只有自定义类型可改名/删除(预置与未分类由后台硬拦) */
  const activeCategory = categories.find((c) => c.id === activeCat)
  const canManageCat = activeCategory?.kind === 'custom'

  // 「移到其他类型」的选择器同样只给记录级类型:尺码推荐没有存档记录可归属,
  // 摆进去只会造出一条永远无法检索的孤儿标答(它与导航同口径,见 recordLevelCategories)
  const categoryOptions = useMemo(
    () =>
      categoryOrder(recordLevelCategories(categories)).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      )),
    [categories],
  )

  /** 判定说明与预置描述的字符重合度警示:不做计算式拦截,只把说明行标红 */
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
    // 纯图片标准回答存的是占位符;编辑器里不显示它,留着只会在保存时被当成正文
    setDraftA(
      (g.attachments?.length ?? 0) > 0 && g.answer.trim() === IMAGE_PLACEHOLDER ? '' : g.answer,
    )
    setDraftImgs(g.attachments ?? [])
    setImgUrl('')
    setMovingId(null)
    setConfirmGoldenDelete(null)
  }

  const submitEdit = async () => {
    if (!editingId) return
    // 只有图片、没有文字时,标准回答仍需要一个非空 answer 才过校验 —— 用占位符兜底
    const answer = draftA.trim() ? draftA : draftImgs.length > 0 ? IMAGE_PLACEHOLDER : draftA
    const originalImgs = goldens.find((g) => g.id === editingId)?.attachments ?? []
    const imgsChanged = JSON.stringify(originalImgs) !== JSON.stringify(draftImgs)
    try {
      const resp = await sendMessage<UpdateGoldenResponse>({
        type: 'UPDATE_GOLDEN',
        payload: {
          id: editingId,
          question: draftQ,
          answer,
          // 图片没动就不发 —— 请求体保持"只带改动",也避免无谓的写库
          ...(imgsChanged ? { attachments: draftImgs } : {}),
        },
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
      setRenaming(false)
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `改名失败:${String(err)}` })
    }
  }

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
        // 被删的类型已不在导航上 —— 落回「全部」,否则会停在一个不存在的选中项上
        setActiveCat(ALL_CATEGORY_ID)
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmCatDelete(false)
  }

  // ─── 卡片 ──────────────────────────────────────────────────────────────────────

  const goldenCard = (g: PanelGolden): React.ReactNode => {
    if (editingId === g.id) {
      return (
        <div className="pddcs-gcard" key={g.id} data-category-id={g.categoryId}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: formGap.field }}>
            <textarea
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              rows={2}
              placeholder="标准问题"
              autoFocus
              className="pddcs-input"
              style={inputStyle({ resize: 'vertical' })}
            />
            <textarea
              value={draftA}
              onChange={(e) => setDraftA(e.target.value)}
              rows={4}
              placeholder="标准回复"
              className="pddcs-input"
              style={inputStyle({ resize: 'vertical' })}
            />
            {/* 没有图片时**不渲染这一层**:空 flex 子元素会在上下各吃一道 12,
                答案与图片地址之间就会变成 24 */}
            {draftImgs.length > 0 && (
              <div className="pddcs-gimgs">
                {draftImgs.map((a) => (
                  <span className="pddcs-gimg" key={a.url}>
                    <a
                      className="pddcs-gimg-a"
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      title="打开原图"
                    >
                      <img src={thumbUrl(a.url, 96)} alt="图片附件" loading="lazy" />
                    </a>
                    <button
                      type="button"
                      className="pddcs-gimg-x"
                      title="移除这张图"
                      aria-label="移除这张图"
                      onClick={() => setDraftImgs((prev) => prev.filter((x) => x.url !== a.url))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center' }}>
              <input
                className="pddcs-input"
                placeholder="粘贴图片地址(https://…)"
                value={imgUrl}
                onChange={(e) => setImgUrl(e.target.value)}
                style={{ ...inputStyle({}), flex: 1, minWidth: 0 }}
              />
              <Btn
                variant="ghost"
                onClick={() => {
                  const url = imgUrl.trim()
                  if (!/^https?:\/\//i.test(url)) {
                    setMsg({ ok: false, text: '图片地址需以 http(s):// 开头' })
                    return
                  }
                  setDraftImgs((prev) =>
                    prev.some((x) => x.url === url) ? prev : [...prev, { type: 'image', url }],
                  )
                  setImgUrl('')
                }}
              >
                添加图片
              </Btn>
            </div>
            <div style={{ display: 'flex', gap: spacing.md }}>
              <Btn variant="primary" onClick={() => void submitEdit()} title="保存后自动重新生成问题向量">
                保存
              </Btn>
              <Btn variant="ghost" onClick={() => setEditingId(null)}>
                取消
              </Btn>
            </div>
          </div>
        </div>
      )
    }

    const n = questionCounts.get(hashText(g.question)) ?? 1
    // 提到分支外算一次:谓词已经保证了类型,但 tsc 不会因此收窄,g.categoryConfidence
    // 在 JSX 里仍要写 `!`。取出来既避免断言,也让"标与数是同一份判断"这件事看得见
    const lowConf = isLowConfidenceCategory(g) ? (g.categoryConfidence ?? null) : null
    return (
      // data-category-id 是**稳定的分类锚点**:验收脚本按类型 id 找条目,
      // 而不是靠文字/DOM 形状 —— 后者随渲染改一次就静默失配
      <div className="pddcs-gcard pddcs-hair" key={g.id} data-category-id={g.categoryId}>
        <div className="pddcs-qa-line">
          <span className="pddcs-qa" aria-hidden>
            Q
          </span>
          <span className="txt q">{g.question}</span>
        </div>

        {/* 灰标行:只上有信息量的标。零信息的标(向量正常、被用 0 次)一概不渲染 ——
            满屏灰标是"看着很丰富、其实什么都没说" */}
        <div className="pddcs-gmeta">
          {g.categorySource === 'manual' && (
            <Tag tone="strong" title="这个分类是你手工指定的,机器补分类会跳过它">
              已指定
            </Tag>
          )}
          {/* 低置信:机器打的标本身就没过半。这一档以前只写不读 ——
              0.23 与 0.95 的判定在界面上长得一模一样,用户无从知道哪条该复核。
              这里标出来才配得上"可用「移到其他类型」改正」这个动作 */}
          {lowConf !== null && (
            <Tag
              tone="accent"
              title={`分类由机器判定,概率 ${lowConf.toFixed(2)} —— 低于 ${LOW_CONFIDENCE_LINE} 的复核线,可能归错了组。可用操作行的「移到其他类型」改正`}
            >
              低置信 {lowConf.toFixed(2)}
            </Tag>
          )}
          {n >= 2 && (
            <Tag
              title={`同一问题的标准回答共 ${n} 条(上限 ${MAX_GOLDENS_PER_QUESTION} 条),按设置时间倒序展示`}
            >
              同问题 {n} 条{n >= MAX_GOLDENS_PER_QUESTION ? ' · 已满' : ''}
            </Tag>
          )}
          {g.hasEmbedding === 0 && <Tag>向量生成中</Tag>}
          {g.hasEmbedding === -1 && (
            <Tag tone="danger" title="嵌入失败,后台将自动重试">
              嵌入失败
            </Tag>
          )}
        </div>

        {/* 答案是成品,完整直出 —— 不折叠、不截断。
            纯图片回答存的是占位符,只显示图,不显示那四个字 */}
        {!(g.answer.trim() === IMAGE_PLACEHOLDER && (g.attachments?.length ?? 0) > 0) && (
          <div className="pddcs-qa-line">
            <span className="pddcs-qa" aria-hidden>
              A
            </span>
            <span className="txt a">{g.answer}</span>
          </div>
        )}

        {/* 图片附件:提升自历史回复时自动带过来;卡片上只读,编辑态才能增删 */}
        {(g.attachments?.length ?? 0) > 0 && (
          <div className="pddcs-gimgs">
            {g.attachments!.map((a) => (
              <span className="pddcs-gimg" key={a.url}>
                <a
                  className="pddcs-gimg-a"
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  title="打开原图"
                >
                  <img src={thumbUrl(a.url, 96)} alt="图片附件" loading="lazy" />
                </a>
              </span>
            ))}
          </div>
        )}

        <div className="pddcs-gops">
          {confirmGoldenDelete === g.id ? (
            <ConfirmRow
              text="删除这条标准回答?历史记录不受影响。"
              onOk={() => void deleteGolden(g.id)}
              onCancel={() => setConfirmGoldenDelete(null)}
            />
          ) : movingId === g.id ? (
            <>
              <select
                autoFocus
                value={g.categoryId}
                onChange={(e) => void moveGolden(g.id, e.target.value)}
                onBlur={() => setMovingId(null)}
                className="pddcs-input"
                style={controlStyle(controlH.form, {
                  width: 'auto',
                  maxWidth: 180,
                  fontSize: fontSize.sub,
                  padding: `0 ${spacing.md}px`,
                })}
              >
                {categoryOptions}
              </select>
              <Btn variant="ghost" small onClick={() => setMovingId(null)}>
                取消
              </Btn>
            </>
          ) : (
            <>
              <IconBtn title="编辑问题与回复" onClick={() => startEdit(g)}>
                <PencilIcon size={ICON_SIZE} strokeWidth={2} />
              </IconBtn>
              <IconBtn
                title="移到其他类型"
                onClick={() => {
                  setMovingId(g.id)
                  setConfirmGoldenDelete(null)
                }}
              >
                <TagIcon size={ICON_SIZE} strokeWidth={2} />
              </IconBtn>
              <IconBtn title="复制这条回复" onClick={() => void copyGolden(g)}>
                <CopyIcon size={ICON_SIZE} strokeWidth={2} />
              </IconBtn>
              <IconBtn
                title="删除(历史记录不受影响)"
                className="pddcs-iconbtn-danger"
                onClick={() => {
                  setConfirmGoldenDelete(g.id)
                  setMovingId(null)
                }}
              >
                <TrashIcon size={ICON_SIZE} strokeWidth={2} />
              </IconBtn>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ fontSize: fontSize.sub, color: 'var(--pddcs-text-tertiary)', padding: spacing.xxl }}>
        读取中…
      </div>
    )
  }

  return (
    <div>
      <Notice msg={msg} onDismiss={() => setMsg(null)} />

      {creating ? (
        // 不加容器:与编辑态(就在列表里的 .pddcs-gcard)同一副长相 ——
        // 创建和编辑本来就是同一个操作。这里曾经是一块**填充底 + 直角**的方盒,
        // 那是 v3.0 的盒子语言,而 v4.0 的整页只有一个面("不为装饰加一层容器");
        // 何况它出现在工具栏的位置上,位置本身已经说明了"正在新建"
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.xl,
            padding: `${spacing.xxl}px ${spacing.xxl}px 0`,
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="类型名(如:发票咨询)"
            autoFocus
            className="pddcs-input"
          />
          <textarea
            value={newCriteria}
            onChange={(e) => setNewCriteria(e.target.value)}
            rows={3}
            placeholder="判定说明(必填):这个类型涵盖哪些问题 —— 原样发给分类模型当作选项描述"
            className="pddcs-input"
            style={inputStyle({ resize: 'vertical' })}
          />
          <div
            style={{
              fontSize: fontSize.cap,
              lineHeight: 1.6,
              color: overlapWarn ? 'var(--pddcs-danger)' : 'var(--pddcs-text-tertiary)',
            }}
          >
            判定说明若与某个预置类型含义相近(例如又建一个「尺码咨询」),分类模型会在两者之间摇摆,
            <b>全部类型</b>的判断质量一起下降。
          </div>
          <div style={{ display: 'flex', gap: spacing.md }}>
            <Btn variant="primary" onClick={() => void submitCreate()}>
              创建
            </Btn>
            <Btn variant="ghost" onClick={closeCreate}>
              取消
            </Btn>
          </div>
        </div>
      ) : (
        <div style={{ padding: `${spacing.xxl}px 0 ${pageGap.section}px` }}>
          <Toolbar>
            <CreateBtn label="新建类型" onClick={() => setCreating(true)} />
          </Toolbar>
        </div>
      )}

      {/* 分类导航:选中自定义类型时,右端才出现改名/删除 */}
      <div style={{ padding: `0 ${pageGap.x}px` }}>
        <CatNav
          items={navItems}
          value={activeCat}
          onChange={(id) => {
            setActiveCat(id)
            setRenaming(false)
            setConfirmCatDelete(false)
          }}
          trailing={
            canManageCat ? (
              <>
                <IconBtn
                  title="重命名这个类型"
                  onClick={() => {
                    setRenaming(true)
                    setRenameName(activeCategory?.name ?? '')
                    setConfirmCatDelete(false)
                  }}
                >
                  <PencilIcon size={ICON_SIZE} strokeWidth={2} />
                </IconBtn>
                <IconBtn
                  title="删除这个类型"
                  className="pddcs-iconbtn-danger"
                  onClick={() => {
                    setConfirmCatDelete(true)
                    setRenaming(false)
                  }}
                >
                  <TrashIcon size={ICON_SIZE} strokeWidth={2} />
                </IconBtn>
              </>
            ) : undefined
          }
        />
      </div>

      {renaming && activeCategory && (
        <div
          style={{
            display: 'flex',
            gap: spacing.md,
            alignItems: 'center',
            padding: `0 ${spacing.xxl}px ${spacing.xl}px`,
          }}
        >
          <input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            autoFocus
            className="pddcs-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename(activeCategory.id)
              if (e.key === 'Escape') setRenaming(false)
            }}
            style={controlStyle(controlH.form, { flex: 1, minWidth: 0 })}
          />
          <Btn variant="primary" onClick={() => void submitRename(activeCategory.id)}>
            保存
          </Btn>
          <Btn variant="ghost" onClick={() => setRenaming(false)}>
            取消
          </Btn>
        </div>
      )}

      {confirmCatDelete && activeCategory && (
        <div style={{ padding: `0 ${spacing.xxl}px ${spacing.xl}px` }}>
          <ConfirmRow
            text={`删除「${activeCategory.name}」?其中的标准回答会移到未分类,不会消失`}
            onOk={() => void deleteCategory(activeCategory.id)}
            onCancel={() => setConfirmCatDelete(false)}
          />
        </div>
      )}

      {visible.length === 0 &&
        (goldens.length === 0 ? (
          <EmptyState>
            暂无标准回答
            <br />
            在聊天页候选弹窗或记忆列表中可将优质回复沉淀为标准回答
          </EmptyState>
        ) : (
          <div className="pddcs-gempty">
            这个类型下还没有标准回答 —— 可在记忆页点 ★,或在本页用 ⇢ 把标答摆进来。
          </div>
        ))}

      {visible.length > 0 && <List>{visible.map((g) => goldenCard(g))}</List>}
    </div>
  )
}
