/**
 * 模型内置底座(2026-09-17 第四十七轮):
 *   fetch    —— 从 hf-mirror 锁 revision 下载白名单文件到 model/(幂等:存在且大小一致则跳过)
 *   copy     —— model/ → build/chrome-mv3-prod/model/(plasmo build 之后跑;
 *               实证:Plasmo 0.90 不复制 public/ 与未导入的 assets/,故走构建后复制)
 *   copy-dev —— model/ → build/chrome-mv3-dev/model/(dev 会话开始时跑一次,模型文件不变)
 * 网络仅发生在构建期;扩展运行时零远程请求(spec §二 / ADR 0005)。
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'

const MIRROR = 'https://hf-mirror.com'
export const MODEL_REPO = 'Xenova/bge-small-zh-v1.5'
export const MODEL_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
export const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'quantize_config.json',
  'onnx/model_quantized.onnx',
]

export const ROOT = path.resolve(import.meta.dirname, '..')

/** 仓库内模型事实源目录(model/Xenova/bge-small-zh-v1.5) */
export const localModelDir = () => path.join(ROOT, 'model', ...MODEL_REPO.split('/'))
/** 产物内模型目录(<dist>/model/Xenova/bge-small-zh-v1.5) */
export const distModelDir = (dist) => path.join(dist, 'model', ...MODEL_REPO.split('/'))
/** 锁 revision 的下载 URL */
export const modelFileUrl = (file) => `${MIRROR}/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`

async function fetchOne(file) {
  const dest = path.join(localModelDir(), file)
  if (existsSync(dest)) {
    const head = await fetch(modelFileUrl(file), { method: 'HEAD' })
    const len = Number(head.headers.get('content-length') ?? -1)
    if (len >= 0 && statSync(dest).size === len) {
      console.log(`skip  ${file}(${len} bytes 已一致)`)
      return
    }
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  console.log(`fetch ${file}`)
  const res = await fetch(modelFileUrl(file))
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${modelFileUrl(file)}`)
  const out = createWriteStream(dest)
  await new Promise((ok, err) => {
    Readable.fromWeb(res.body).pipe(out).on('finish', ok).on('error', err)
  })
}

function copyTo(dist) {
  const from = localModelDir()
  const to = distModelDir(dist)
  rmSync(path.join(dist, 'model'), { recursive: true, force: true })
  for (const f of MODEL_FILES) {
    const src = path.join(from, f)
    if (!existsSync(src)) throw new Error(`模型文件缺失:${src}(先跑 pnpm fetch-model)`)
    const dst = path.join(to, f)
    mkdirSync(path.dirname(dst), { recursive: true })
    createReadStream(src).pipe(createWriteStream(dst))
  }
  console.log(`copy  model/ → ${to}`)
}

const cmd = process.argv[2]
if (cmd === 'fetch') {
  for (const f of MODEL_FILES) await fetchOne(f)
} else if (cmd === 'copy') {
  copyTo(path.join(ROOT, 'build', 'chrome-mv3-prod'))
} else if (cmd === 'copy-dev') {
  copyTo(path.join(ROOT, 'build', 'chrome-mv3-dev'))
} else {
  console.error('用法:node scripts/model.mjs fetch|copy|copy-dev')
  process.exit(1)
}
