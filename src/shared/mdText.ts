/**
 * md 净化与结构感知分块(P4-KB)。
 * 背景:chunkText 是 500 字盲切窗口,把 md 标记(##/-/**)带进填充文本,且在块边界
 * 截断列表项导致语义不完整。方案:
 *  - mdToPlainText:剥 md 标记为纯文本(填充出去的是干净话术);
 *  - chunkMarkdown:按标题切小节,小节整块保留(≤ CHUNK_SIZE_CHARS);超长小节按行
 *    分组,截断点优先吸附空行(段落间隙整块分组),永不截断单行,单行超长回退
 *    chunkText 滑窗;全文无标题时整篇回退滑窗(原项目逻辑作为无结构文本的兜底保留)。
 */
import { chunkText, CHUNK_SIZE_CHARS, CHUNK_MIN_CHARS } from './chunkText'

export interface MdChunk {
  /** 小节标题(纯文本);文档开头无标题部分 / 无结构回退块为 '' */
  title: string
  /** 纯文本正文(不含标题行、不含 md 标记) */
  text: string
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

  // 全文无任何标题 → 无结构文本,回退原滑窗(原项目逻辑兜底)
  if (!sections.some((s) => s.title !== null)) {
    const plain = mdToPlainText(md)
    return chunkText(plain).map((text) => ({ title: '', text }))
  }

  const out: MdChunk[] = []
  for (const sec of sections) {
    const plain = mdToPlainText(sec.bodyLines.join('\n'))
    if (!plain) continue
    if (plain.length <= CHUNK_SIZE_CHARS) {
      out.push({ title: sec.title ?? '', text: plain })
      continue
    }
    // 超长小节:按行分组,永不截断单行
    for (const part of groupLines(plain)) out.push({ title: sec.title ?? '', text: part })
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
