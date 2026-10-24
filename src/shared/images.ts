/**
 * 图片地址工具(客户端共用)。
 *
 * 平台聊天图片由七牛式 CDN 提供,同一张图可以按需取任意尺寸:
 *   <base>.jpeg?imageMogr2/thumbnail/200x200
 * 这不是鉴权、只是处理指令,原图与缩略图是同一个 base —— 所以我们只存一个
 * **剥掉查询串的原图地址**,展示时再拼尺寸。存储与导出都只多一个字符串,
 * 而列表里的缩略图不必下载原图(实测原图 225KB / 200px 缩略图 19KB)。
 *
 * 只对已知的拼多多图片域加参数:别家服务可能把查询串当鉴权,乱加会 403。
 */

/** 允许拼处理参数的图片域(子域一并放行) */
const THUMB_HOSTS = ['chat-img.pddugc.com', 'img.pddpic.com', 'commimg.pddpic.com']

export function isPddImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return THUMB_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/**
 * 缩略图地址:已知图片域 → 拼 `?imageMogr2/thumbnail/<size>x<size>`;
 * 其它地址原样返回(宁可大图,也不要一个 403 的破图)。
 */
export function thumbUrl(url: string, size: number): string {
  if (!url || !isPddImageHost(url)) return url
  const base = url.split('?')[0]
  return `${base}?imageMogr2/thumbnail/${size}x${size}`
}
