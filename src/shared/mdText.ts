/**
 * md 净化与结构感知分块(P4-KB)。
 * 背景:chunkText 是 500 字盲切窗口,把 md 标记(##/-/**)带进填充文本,且在块边界
 * 截断列表项导致语义不完整。方案:
 *  - mdToPlainText:剥 md 标记为纯文本(填充出去的是干净话术);
 *  - chunkMarkdown:按标题切小节,小节整块保留(≤ CHUNK_SIZE_CHARS);超长小节按行
 *    分组,截断点优先吸附空行(段落间隙整块分组),永不截断单行,单行超长回退
 *    chunkText 滑窗;全文无标题时整篇回退滑窗(原项目逻辑作为无结构文本的兜底保留);
 *  - 问答体(Q：/问：行 ≥2 条)额外按「一条 QA 一块」切:多主题挤一块会把向量平均
 *    稀释,单主题问句余弦跌破 kbThreshold 导致检索不到(实测「防水吗」0.391<0.4)。
 */
import { chunkText, CHUNK_SIZE_CHARS, CHUNK_MIN_CHARS } from './chunkText'

/**
 * 分块器版本:落块时写入 KbDocRecord.splitterVersion。
 * 切分规则变更(会改变产出块)必须 bump —— SW 启动时据此找出失配文档重新分块。
 * 1.0.0 = 纯标题切节;2.0.0 = 新增问答体按条切分。
 */
export const SPLITTER_VERSION = '2.0.0'

export interface MdChunk {
  /** 小节标题(纯文本);文档开头无标题部分 / 无结构回退块为 '';QA 块为问句 */
  title: string
  /** 纯文本正文(不含标题行、不含 md 标记);QA 块为答案 */
  text: string
  /** 块类型:qa=问答体切出的单条(答案自足);section=按标题切出的节 */
  kind: 'qa' | 'section'
  /** 源节在文档中的序号(0 起):同一节被拆成多块时共享同一值,供续块定位 */
  sectionSeq: number
}

/** 行首问句标记:Q / 问 + 全角或半角冒号(md 标记已由 mdToPlainText 剥净) */
const QA_QUESTION_RE = /^(?:Q|问)\s*[：:]\s*/
/** 行内答案标记:空白 + A / 答 + 冒号。前置空白必需,避免误切 "USB-C:" 这类文本 */
const QA_INLINE_ANSWER_RE = /\s(?:A|答)\s*[：:]\s*/
/** 行首答案标记(分行写法) */
const QA_ANSWER_RE = /^(?:A|答)\s*[：:]\s*/

/** 该行是否为问句行 */
function isQaQuestion(line: string): boolean {
  return QA_QUESTION_RE.test(line.trim())
}

/** md → 纯文本:去标题/列表/引用/水平线/围栏标记与行内强调、链接(保留文字) */
export function mdToPlainText(md: string): string {
  const out: string[] = []
  let inFence = false
  for (const raw of md.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(raw)
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue // 水平线
    let s = raw.replace(/^\s{0,3}#{1,6}\s+/, '') // 标题
    s = s.replace(/^\s{0,3}>\s?/, '') // 引用
    s = s.replace(/^(\s*)([-*+])\s+/, '$1') // 无序列表符(保留序号列表的数字)
    out.push(stripInline(s).trim())
  }
  // 连续空行折叠为一个;去首尾空行
  const res: string[] = []
  for (const l of out) {
    if (l === '' && res[res.length - 1] === '') continue
    res.push(l)
  }
  while (res.length && res[0] === '') res.shift()
  while (res.length && res[res.length - 1] === '') res.pop()
  return res.join('\n')
}

function stripInline(s: string): string {
  let prev = ''
  let cur = s
  while (prev !== cur) {
    // 迭代到不动点,处理嵌套(***x***、[**x**](url) 等)
    prev = cur
    cur = cur
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片删除
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/___([^_]+)___/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
  }
  return cur
}

/**
 * 节内 QA 切分:问句行 ≥2 条时,每条 Q(连同其后到下一个 Q 前的非空行)独立成块。
 * 返回 null 表示该节不是问答体,交回原有的切节 / 行分组逻辑。
 *
 * 首个 Q 之前的引言行单独成 section 块:并入 QA 块会稀释问句语义(问句是检索锚)。
 */
function splitQaSection(plain: string, sectionTitle: string): MdChunk[] | null {
  const lines = plain.split('\n')
  const qIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isQaQuestion(lines[i])) qIdx.push(i)
  }
  if (qIdx.length < 2) return null

  const stamp = (c: Omit<MdChunk, 'sectionSeq'>): MdChunk => ({ ...c, sectionSeq: 0 })
  const out: MdChunk[] = []

  const preamble = lines
    .slice(0, qIdx[0])
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
  if (preamble) out.push(stamp({ title: sectionTitle, text: preamble, kind: 'section' }))

  for (let k = 0; k < qIdx.length; k++) {
    const start = qIdx[k]
    const end = k + 1 < qIdx.length ? qIdx[k + 1] : lines.length
    const head = lines[start].trim().replace(QA_QUESTION_RE, '')

    // 同行写法「Q：xxx A：yyy」:按首个「空白+A：」切成问句与答案
    const m = head.match(QA_INLINE_ANSWER_RE)
    let question: string
    const answerParts: string[] = []
    if (m && m.index !== undefined) {
      question = head.slice(0, m.index).trim()
      answerParts.push(head.slice(m.index + m[0].length).trim())
    } else {
      question = head
    }
    for (const raw of lines.slice(start + 1, end)) {
      const l = raw.trim()
      if (l) answerParts.push(l.replace(QA_ANSWER_RE, ''))
    }

    const text = answerParts.filter(Boolean).join('\n').trim()
    if (!question || !text) continue // 问句或答案缺失 → 整条跳过,不产出空块

    if (text.length <= CHUNK_SIZE_CHARS) {
      out.push(stamp({ title: question, text, kind: 'qa' }))
    } else {
      // 单条答案超长:复用行分组兜底;续块由调用方戳同一 sectionSeq
      for (const part of groupLines(text)) out.push(stamp({ title: question, text: part, kind: 'qa' }))
    }
  }
  return out.length ? out : null
}

/** 结构感知分块:见文件头注释 */
export function chunkMarkdown(md: string): MdChunk[] {
  const sections: Array<{ title: string | null; bodyLines: string[] }> = []
  let cur: { title: string | null; bodyLines: string[] } = { title: null, bodyLines: [] }
  let inFence = false
  for (const line of md.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) inFence = !inFence
    const m = inFence ? null : line.match(/^\s{0,3}#{1,6}\s+(.*)$/)
    if (m) {
      sections.push(cur)
      cur = { title: m[1].trim(), bodyLines: [] }
    } else {
      cur.bodyLines.push(line)
    }
  }
  sections.push(cur)

  // 全文无任何标题 → 无结构文本:仍先试 QA 切分(无标题的问答文档很常见),再回退滑窗
  if (!sections.some((s) => s.title !== null)) {
    const plain = mdToPlainText(md)
    const qa = splitQaSection(plain, '')
    if (qa) return qa
    return chunkText(plain).map((text) => ({ title: '', text, kind: 'section' as const, sectionSeq: 0 }))
  }

  const out: MdChunk[] = []
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si]
    const plain = mdToPlainText(sec.bodyLines.join('\n'))
    if (!plain) continue

    const qa = splitQaSection(plain, sec.title ?? '')
    if (qa) {
      for (const c of qa) out.push({ ...c, sectionSeq: si })
      continue
    }

    if (plain.length <= CHUNK_SIZE_CHARS) {
      out.push({ title: sec.title ?? '', text: plain, kind: 'section', sectionSeq: si })
      continue
    }
    // 超长小节:按行分组,永不截断单行
    for (const part of groupLines(plain)) out.push({ title: sec.title ?? '', text: part, kind: 'section', sectionSeq: si })
  }
  return out
}

/**
 * buf 内最后一个空行(段落间隙):其前内容 ≥ CHUNK_MIN_CHARS 时返回该下标
 * (切在间隙处,空行本身不落入任何块),否则 -1(照旧整段 flush)。
 */
function snapBlank(buf: string[]): number {
  for (let b = buf.length - 1; b >= 0; b--) {
    if (buf[b] === '') {
      return buf.slice(0, b).join('\n').length >= CHUNK_MIN_CHARS ? b : -1
    }
  }
  return -1
}

/** 按行聚合成 ≤ CHUNK_SIZE_CHARS 的组;截断点优先吸附空行;单行超长时该行回退滑窗 */
function groupLines(plain: string): string[] {
  const out: string[] = []
  let buf: string[] = []
  let len = 0
  const flush = () => {
    if (buf.length) {
      out.push(buf.join('\n'))
      buf = []
      len = 0
    }
  }
  for (const line of plain.split('\n')) {
    if (line.length > CHUNK_SIZE_CHARS) {
      flush()
      out.push(...chunkText(line))
      continue
    }
    const add = buf.length ? line.length + 1 : line.length
    if (len + add > CHUNK_SIZE_CHARS && buf.length) {
      const cut = snapBlank(buf)
      if (cut >= 0) {
        out.push(buf.slice(0, cut).join('\n'))
        buf = buf.slice(cut + 1)
        len = buf.join('\n').length
      } else {
        flush()
      }
    }
    buf.push(line)
    len += buf.length > 1 ? line.length + 1 : line.length
  }
  flush()
  return out
}
