/**
 * 记忆页(v4.0「Codex × iOS · 黑灰白」)
 *
 * 结构:搜索框 → 分类导航(pill,滚轮横移)→ 折叠问题行 → 点击展开回复列表。
 *
 * 四处与 v2.6 的根本差别:
 *
 *  ① **分类从页内分区标题改为顶部导航栏**。v2.6 每个问题类型占一个可折叠卡片分区,
 *     一屏里"类型标题 + 卡片边距"吃掉近一半高度;"现在在看哪一类"要靠翻到分区标题才
 *     知道。改为导航后,分类是**一行常驻、当前项反白**的状态,而列表回到纯粹的行流。
 *
 *  ② **问题行默认折叠**。v2.6 默认展开全部回复,一屏只能看两三个问题;而这一页的
 *     主用途是"找到能用的那条回复",先扫问题再展开,比先展开再扫快得多。
 *
 *  ③ **金标可设可取消**。v2.6 已设标准的回复会变成一枚**死的琥珀徽标**,
 *     `title` 写着「可在文件夹页取消」—— 用户必须记住"取消要去另一页"才用得了。
 *     现在 ★ 是双向开关(实心 = 已设,再点即取消)。
 *
 *  ④ **行是 div[role=button] 而不是 `<button>`**(v4.1):行尾常驻着删除图标与折叠指示
 *     两枚真的 `<button>`,而按钮套按钮是非法 HTML —— 浏览器会把内层挪出去、点击散架。
 *     键盘可达性由 `tabIndex` + Enter/Space 补齐(见下方行的 onKeyDown)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { sendMessage } from '../shared/message-passing'
import type {
  AddGoldenResponse,
  DeleteGoldenResponse,
  DeleteQaResponse,
  GetMemoryListResponse,
  MemoryListItem,
  MemoryReplyItem,
  PanelCategory,
} from '../types/messages'
import { ALL_CATEGORY_ID, catNavItems, filterByCategory, filterQaRecords } from './logic'
import {
  IMAGE_PLACEHOLDER,
  LOW_CONFIDENCE_LINE,
  MAX_GOLDENS_PER_QUESTION,
  UNCATEGORIZED_CATEGORY_ID,
  isLowConfidenceCategory,
} from '../shared/constants'
import { thumbUrl } from '../shared/images'
import {
  Btn,
  CatNav,
  ConfirmRow,
  EmptyState,
  IconBtn,
  List,
  Notice,
  SearchInput,
  Tag,
  formatTs,
  type NoticeMsg,
} from '../ui/components'
import { fontSize, size, spacing } from '../ui/design'
import { ChevronDownIcon, CopyIcon, LoaderIcon, StarIcon, TrashIcon } from '../ui/icons'

export function MemoryListTab({
  categories,
  onDataChanged,
}: {
  /** 问题类型表(来源:GET_STATS);分类导航据此产出。不应由本页签自行拉取 */
  categories: PanelCategory[]
  onDataChanged: () => Promise<void> | void
}) {
  const [items, setItems] = useState<MemoryListItem[]>([])
  // 分页状态(PM2):total 为排除自检后的全量数,hasMore 由后台按 offset+页大小<total 推得
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [keyword, setKeyword] = useState('')
  /** 选中的分类;默认「全部」 */
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORY_ID)
  /** 展开中的问题 id —— **单展开**(展开另一行自动收起上一行),避免一屏里到处是半开的块 */
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)
  /** 星标请求在途的回复 id(设与取消共用:同一时刻只有一条在动) */
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)

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
  // 口径链:关键词筛 → 导航计数(基于筛后结果)→ 按选中分类再切一刀。
  // 三步都是纯函数,组合关系写在明面上(search 改变分布、分类改变可见集)
  const shown = useMemo(() => filterQaRecords(items, keyword), [items, keyword])
  const navItems = useMemo(() => catNavItems(shown, categories), [shown, categories])
  const visible = useMemo(
    () => filterByCategory(shown, activeCat, categories),
    [shown, activeCat, categories],
  )

  /** 某个问题下是否已有回复被设为标准(决定行尾那枚常显的 ★) */
  const hasGolden = useCallback(
    (item: MemoryListItem): boolean => item.replies.some((r) => r.goldenId),
    [],
  )

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setConfirmDeleteId(null)
  }

  // ─── 金标:设 / 取消(v3.0 双向)────────────────────────────────────────────

  const addGolden = async (item: MemoryListItem, replyId: string, text: string) => {
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
    if (p.error) return setMsg({ ok: false, text: `设置标准回答失败:${p.error}` })
    if (p.limitReached) {
      return setMsg({
        ok: false,
        text: `该问题已有 ${p.count} 条标准回答(上限 ${MAX_GOLDENS_PER_QUESTION} 条),请先取消一条`,
      })
    }
    setMsg(
      p.exists
        ? { ok: true, text: '该回复已是该问题的标准回答,未重复创建' }
        : {
            ok: true,
            text: `已设为标准回答${p.count ? `(${p.count}/${MAX_GOLDENS_PER_QUESTION})` : ''},后台将自动向量化`,
          },
    )
  }

  /**
   * 取消标准回答。
   *
   * 这条路径 v2.6 在记忆页**不存在** —— 已设之后那枚徽标是死的,用户只能去标准回答页
   * 找到同一条再删。后端 `DELETE_GOLDEN` 早就有了(标准回答页在用),这里接上即可。
   */
  const removeGolden = async (goldenId: string) => {
    const resp = await sendMessage<DeleteGoldenResponse>({
      type: 'DELETE_GOLDEN',
      payload: { id: goldenId },
    })
    if (resp.payload.success) {
      setMsg({ ok: true, text: '已取消该条标准回答,历史记录不受影响' })
    } else {
      setMsg({ ok: false, text: `取消失败:${resp.payload.error ?? '未知错误'}` })
    }
  }

  /**
   * ★ 的双向切换。请求在途时图标原地转圈(与聊天页面板同一套反馈语言)——
   * 列表一长,顶部那条 Notice 会在视口外,而这一页的"点击后毫无动静"是踩过的坑。
   */
  const toggleGolden = async (item: MemoryListItem, r: MemoryReplyItem) => {
    setBusyReplyId(r.id)
    try {
      if (r.goldenId) await removeGolden(r.goldenId)
      else await addGolden(item, r.id, r.text)
      // 库内已变 → 重拉列表,★ 由数据派生(不是会话级 state)
      await load()
      await onDataChanged()
    } catch (err) {
      setMsg({ ok: false, text: `操作失败:${String(err)}` })
    } finally {
      setBusyReplyId(null)
    }
  }

  const copyReply = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMsg({ ok: true, text: '已复制到剪贴板' })
    } catch {
      setMsg({ ok: false, text: '复制失败' })
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

  const uncategorizedCount = navItems.find((n) => n.id === UNCATEGORIZED_CATEGORY_ID)?.count ?? 0

  return (
    <div>
      {/* 顶部控件区:只有控件内缩 16px,列表本身通铺到边缘 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.xl,
          padding: `${spacing.xxl}px ${spacing.xxl}px 0`,
        }}
      >
        <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索历史问题" />
        <CatNav items={navItems} value={activeCat} onChange={setActiveCat} />
      </div>

      <Notice msg={msg} onDismiss={() => setMsg(null)} />

      {loading && (
        <div style={{ fontSize: fontSize.sub, color: 'var(--pddcs-text-tertiary)', padding: spacing.xxl }}>
          读取中…
        </div>
      )}

      {/* 未分类说明行:只在**选中未分类且确有存量**时出现。计数已经在导航上,
          常驻版等于把同一个数字说两遍,还把列表往下压 */}
      {!loading && activeCat === UNCATEGORIZED_CATEGORY_ID && uncategorizedCount > 0 && (
        <div
          style={{
            fontSize: fontSize.cap,
            color: 'var(--pddcs-text-tertiary)',
            lineHeight: 1.5,
            padding: `${spacing.md}px ${spacing.xxl}px`,
          }}
        >
          未分类条目可在 设置 · 问题分类 · 开始分类全部历史 里批量补分类
        </div>
      )}

      {!loading && visible.length === 0 && (
        <EmptyState>
          {items.length === 0 ? (
            <>
              暂无记录
              <br />
              在聊天页与买家对话后将自动捕获
            </>
          ) : shown.length === 0 ? (
            '没有匹配的问题'
          ) : (
            '该分类下没有问题'
          )}
        </EmptyState>
      )}

      {!loading && visible.length > 0 && (
        <List>
          {visible.map((item) => {
            const expanded = expandedId === item.id
            return (
              // 发丝线挂在**外层**:展开时它自然落到展开区的下缘,
              // 收起时落到问题行的下缘 —— 一处声明,两种形态都对
              <div key={item.id} className="pddcs-hair">
                {/* 折叠行两行:问题在上;时间与回复条数在下,缩进到与问题文字同一条竖线 */}
                {/* 行是 div + role="button" 而**不是** <button>:行尾有两枚真正的
                    <button>(删除 / 折叠指示),而按钮里套按钮是非法 HTML ——
                    浏览器会把内层那个挪出去,点击行为随之散架 */}
                <div
                  role="button"
                  tabIndex={0}
                  className="pddcs-qrow"
                  aria-expanded={expanded}
                  title={item.question}
                  onClick={() => toggleExpand(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleExpand(item.id)
                    }
                  }}
                >
                  <span className="line1">
                    <span className="q">{item.question}</span>
                    {hasGolden(item) && (
                      <span className="star" title="已设标准回答">
                        <StarIcon size={size.icon} strokeWidth={2} style={{ fill: 'currentColor' }} />
                      </span>
                    )}
                    {/* 删除入口:图标常驻在问题后方(不放在展开区里 —— 那是"要先展开才能删",
                        多一步)。点它只出确认条,不直接删 */}
                    <IconBtn
                      title="删除该问答(需确认)"
                      className="pddcs-iconbtn-danger"
                      onClick={() => {
                        setExpandedId(item.id)
                        setConfirmDeleteId(item.id)
                      }}
                    >
                      <TrashIcon size={size.iconBtn} strokeWidth={2} />
                    </IconBtn>
                    {/* 折叠指示:展开时翻过来。它是"这一行能点开"的唯一提示。
                        它是**行内的一个指示**、不在按钮里,故取 icon 档(14)而不是 iconBtn */}
                    <span className="chev" aria-hidden>
                      <ChevronDownIcon size={size.icon} strokeWidth={2} />
                    </span>
                  </span>
                  <span className="line2">
                    <span className="meta">
                      {formatTs(item.questionTs)} · {item.replyCount} 条回复
                    </span>
                    {/* 低置信:这条被机器归到了当前这个类型,但判得没底。
                        标出来是**信息**不是操作 —— 问答记录目前没有改类型的入口
                        (标答页有),所以这里只提示"它可能在错的组里、按类型筛会漏"。 */}
                    {isLowConfidenceCategory(item) && (
                      <Tag
                        tone="accent"
                        title={`分类由机器判定,概率 ${(item.categoryConfidence ?? 0).toFixed(2)} —— 低于复核线 ${LOW_CONFIDENCE_LINE},可能归错了组。按类型筛选时可能漏掉它`}
                      >
                        低置信
                      </Tag>
                    )}
                  </span>
                </div>

                {expanded && (
                  <div className="pddcs-qopen">
                    {item.replies.length === 0 && (
                      <div style={{ fontSize: fontSize.sub, color: 'var(--pddcs-text-tertiary)' }}>
                        无回复(未结段)
                      </div>
                    )}

                    {item.replies.map((r) => {
                      // 图片附件(2026-10-23):纯图片回复的正文是占位符「[图片]」,
                      // 展示上把缩略图放在正文前;复制动作对纯图片改成复制图片地址
                      const imgs = r.attachments ?? []
                      const text = r.text.trim()
                      // 纯图片回复没有正文:新记录是空串,旧记录是占位符「[图片]」——
                      // 两种都不显示那四个字,只显示缩略图
                      const showText =
                        text.length > 0 && !(imgs.length > 0 && text === IMAGE_PLACEHOLDER)
                      const copyValue = showText ? r.text : (imgs[0]?.url ?? '')
                      return (
                        <div className="pddcs-reply" key={r.id}>
                          {imgs.length > 0 && (
                            <span className="pddcs-reply-imgs">
                              {imgs.map((a) => (
                                <a
                                  className="pddcs-reply-img"
                                  key={a.url}
                                  href={a.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="打开原图"
                                >
                                  <img src={thumbUrl(a.url, 96)} alt="图片回复" loading="lazy" />
                                </a>
                              ))}
                            </span>
                          )}
                          {showText && <span className="rt">{r.text}</span>}
                          <span className="ric">
                            <IconBtn
                              title={r.goldenId ? '取消标准回答' : '设为标准回答'}
                              on={!!r.goldenId}
                              busy={busyReplyId === r.id}
                              disabled={busyReplyId !== null && busyReplyId !== r.id}
                              onClick={() => void toggleGolden(item, r)}
                            >
                              {busyReplyId === r.id ? (
                                <LoaderIcon size={size.iconBtn} strokeWidth={2} />
                              ) : (
                                <StarIcon
                                  size={size.iconBtn}
                                  strokeWidth={2}
                                  style={r.goldenId ? { fill: 'currentColor' } : undefined}
                                />
                              )}
                            </IconBtn>
                            <IconBtn
                              title={showText ? '复制该条回复' : '复制图片地址'}
                              onClick={() => void copyReply(copyValue)}
                            >
                              <CopyIcon size={size.iconBtn} strokeWidth={2} />
                            </IconBtn>
                          </span>
                        </div>
                      )
                    })}

                    {/* 删除的二次确认:入口在问题行(常驻图标),确认条就地出现在展开区底部 ——
                        破坏性操作一定要二次确认,但不该把用户推到另一个页面去确认 */}
                    {confirmDeleteId === item.id && (
                      <div className="pddcs-qopen-foot">
                        <ConfirmRow
                          text="删除该问答及其全部回复?"
                          onOk={() => void deleteQa(item.id)}
                          onCancel={() => {
                            setConfirmDeleteId(null)
                            setExpandedId(null)
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </List>
      )}

      {/* 分页入口(PM2):显式"加载更早"取代静默截断;载完显示全量口径 */}
      {!loading && hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: `${spacing.xxl}px` }}>
          <Btn variant="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? '读取中…' : `加载更早(已显示 ${items.length}/${total} 条)`}
          </Btn>
        </div>
      )}
      {!loading && !hasMore && total > 0 && (
        <div
          // 数字走 .pddcs-num:全站唯一的等宽入口,不在各页各写一份字体栈
          className="pddcs-num"
          style={{
            textAlign: 'center',
            fontSize: fontSize.cap,
            color: 'var(--pddcs-text-tertiary)',
            padding: `${spacing.xxl}px`,
          }}
        >
          … 共 {total} 条
        </div>
      )}
    </div>
  )
}
