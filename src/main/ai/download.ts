// GGUF 模型下载器：多源依次尝试 + 断点续传 + 进度回调（不引入额外依赖）
// 用 Electron net.fetch 走 Chromium 网络栈：自动跟随系统代理（Node 的 fetch 不走系统代理，
// 在代理客户端 fake-ip/DNS 劫持环境下会 fetch failed——这正是当初两个下载源全挂的原因）
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net } from '../electron-shims'
import { AI_MODEL_URLS } from '../../shared/defaults'

/** 提取含底层原因的完整错误信息（undici/fetch 类错误把真实原因包在 cause 里） */
export function networkErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause
    if (cause) {
      const causeMsg =
        cause instanceof Error
          ? `${cause.name}: ${cause.message}`
          : String(cause)
      return `${e.message}（${causeMsg}）`
    }
    return e.message
  }
  return String(e)
}

export class ModelDownloader {
  private controller: AbortController | null = null

  get running(): boolean {
    return this.controller !== null
  }

  /**
   * 下载模型到 dest。已存在的 .part 文件自动断点续传。
   * @param onProgress (receivedBytes, totalBytes) —— totalBytes 未知时为 -1
   */
  async download(dest: string, onProgress: (received: number, total: number) => void): Promise<void> {
    if (this.controller) throw new Error('已有下载任务进行中')
    this.controller = new AbortController()
    const part = `${dest}.part`
    // createWriteStream 不会创建父目录，models 目录首次下载时补建
    mkdirSync(dirname(dest), { recursive: true })
    let lastError = '未知错误'

    try {
      for (const url of AI_MODEL_URLS) {
        if (this.controller.signal.aborted) throw new Error('下载已取消')
        try {
          await this.tryUrl(url, part, onProgress, this.controller.signal)
          renameSync(part, dest)
          return
        } catch (e) {
          if (this.controller.signal.aborted) throw new Error('下载已取消')
          lastError = networkErrorMessage(e)
          // 换源重试：清掉可能损坏的续传点，从头再来
          try {
            if (existsSync(part)) unlinkSync(part)
          } catch {
            /* ignore */
          }
        }
      }
      throw new Error(`所有下载源均失败：${lastError}`)
    } finally {
      this.controller = null
    }
  }

  cancel(): void {
    this.controller?.abort()
  }

  private async tryUrl(
    url: string,
    part: string,
    onProgress: (received: number, total: number) => void,
    signal: AbortSignal
  ): Promise<void> {
    const resumeFrom = existsSync(part) ? statSync(part).size : 0
    const res = await net.fetch(url, {
      signal,
      redirect: 'follow',
      headers: resumeFrom > 0 ? { range: `bytes=${resumeFrom}-` } : undefined
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    const contentLength =
      res.status === 206
        ? Number(res.headers.get('content-range')?.split('/')[1] ?? -1)
        : Number(res.headers.get('content-length') ?? -1)
    const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : -1

    let received = resumeFrom
    onProgress(received, total)

    const file = createWriteStream(part, resumeFrom > 0 ? { flags: 'append' } : undefined)
    let lastNotify = 0
    try {
      await pipeline(
        Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
        async function* (source) {
          for await (const chunk of source) {
            received += chunk.length
            const now = Date.now()
            if (now - lastNotify > 250) {
              lastNotify = now
              onProgress(received, total)
            }
            yield chunk
          }
        },
        file
      )
    } finally {
      file.end()
    }
    if (total > 0 && received !== total) throw new Error(`下载不完整（${received}/${total}）`)
    onProgress(received, total)
  }
}
