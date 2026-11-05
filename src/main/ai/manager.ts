// AiManager：主进程侧的模型生命周期编排
// fork utilityProcess worker → 懒加载 → 推理串行队列 → 空闲自动 kill 卸载
// 提示词构建（shared/ai-prompts）与结果校验（shared/ai-schema）都在本进程完成
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { UtilityProcess } from 'electron'
import { utilityProcess } from '../electron-shims'
import type { Settings } from '../../shared/types'
import { AI_MODEL_FILE } from '../../shared/defaults'
import type { AiStatus, TaskDraft } from '../../shared/ai-schema'
import { validateDrafts } from '../../shared/ai-schema'
import { buildExtractionPrompt, buildWeeklyReviewPrompt, type AiTaskKind, type ReviewInput } from '../../shared/ai-prompts'
import { ModelDownloader } from './download'
import type { ProbeResult, WorkerRequest, WorkerResponse } from './types'

const LOAD_TIMEOUT_MS = 180_000
const INFER_TIMEOUT_MS = 120_000

/** 联合类型的分发 Omit（TS 内建 Omit 会塌缩成公共键） */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type WorkerReqInput = DistributiveOmit<WorkerRequest, 'id'>

interface PendingCall {
  resolve: (v: WorkerResponse) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export interface AiManagerDeps {
  modelsDir: string
  getSettings: () => Settings
  /** 状态变化推送到渲染端 */
  notify: (status: AiStatus) => void
  /** 推理生成进度（字符增量）推送到渲染端 */
  notifyProgress?: (id: number, chars: number) => void
}

export class AiManager {
  private worker: UtilityProcess | null = null
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private loadPromise: Promise<void> | null = null
  /** 推理串行队列（单 sequence，不能并发） */
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | null = null
  private busy = false

  private downloader = new ModelDownloader()
  private downloadProgress = -1
  private downloadError = ''
  private lastError = ''

  constructor(private readonly deps: AiManagerDeps) {}

  // ---------- 状态 ----------

  private settings(): Settings {
    return this.deps.getSettings()
  }

  resolveModelPath(): string {
    const custom = this.settings().aiModelPath.trim()
    return custom || join(this.deps.modelsDir, AI_MODEL_FILE)
  }

  getStatus(): AiStatus {
    const s = this.settings()
    const custom = s.aiModelPath.trim() !== ''
    const modelPath = this.resolveModelPath()
    return {
      enabled: s.aiEnabled,
      quickAddFallback: s.aiQuickAddFallback,
      modelAvailable: existsSync(modelPath),
      modelPath,
      modelCustom: custom,
      loading: this.loadPromise !== null,
      loaded: !!this.worker,
      busy: this.busy,
      downloading: this.downloader.running,
      downloadProgress: this.downloadProgress,
      downloadError: this.downloadError,
      lastError: this.lastError,
      idleUnloadMin: s.aiIdleUnloadMin
    }
  }

  private push(): void {
    this.deps.notify(this.getStatus())
  }

  private setLastError(msg: string): void {
    this.lastError = msg
    this.push()
  }

  // ---------- worker 生命周期 ----------

  /** 设置变更入口（index.ts 在 settings:update 后调用） */
  onSettingsChanged(): void {
    if (!this.settings().aiEnabled) this.kill()
    this.push()
  }

  kill(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.worker) {
      const w = this.worker
      this.worker = null
      try {
        w.kill()
      } catch {
        /* ignore */
      }
    }
    this.loadPromise = null
    this.rejectAllPending(new Error('本地 AI 已卸载'))
    this.push()
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private forkWorker(): UtilityProcess {
    // node-llama-cpp 是含顶层 await 的 ESM 包，bundle 里的动态 import 保留后
    // 由 Node 的 require(esm) 支持加载——旧 Node 需要 --experimental-require-module
    const child = utilityProcess.fork(join(__dirname, 'ai-worker.js'), [], {
      serviceName: 'noticeme-ai',
      execArgv: ['--experimental-require-module'],
      stdio: 'inherit'
    })
    child.on('message', raw => {
      const msg = raw as WorkerResponse
      // 进度事件不是响应：转发给渲染端后返回
      if ((raw as { type?: string }).type === 'progress') {
        const prog = raw as { id: number; chars: number }
        this.deps.notifyProgress?.(prog.id, prog.chars)
        return
      }
      const p = this.pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(msg.id)
      p.resolve(msg)
    })
    child.on('exit', () => {
      if (this.worker === child) {
        this.worker = null
        this.loadPromise = null
        this.rejectAllPending(new Error('AI 进程异常退出'))
        this.push()
      }
    })
    return child
  }

  private request(req: WorkerReqInput, timeoutMs: number): Promise<WorkerResponse> {
    if (!this.worker) throw new Error('AI 进程未启动')
    const id = this.nextId++
    const payload = { ...req, id } as WorkerRequest
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)}s）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage(payload)
    })
  }

  /** 确保 worker 存活且模型已加载（并发调用共享同一次加载） */
  private ensureLoaded(): Promise<void> {
    if (!this.settings().aiEnabled) return Promise.reject(new Error('本地 AI 未启用，请在设置中开启'))
    const modelPath = this.resolveModelPath()
    if (!existsSync(modelPath)) {
      return Promise.reject(new Error('模型文件不存在，请在设置中下载或选择本地 GGUF 文件'))
    }
    if (this.worker && !this.loadPromise) return Promise.resolve()
    if (this.loadPromise) return this.loadPromise

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (!this.worker) this.worker = this.forkWorker()
    this.loadPromise = this.request({ type: 'load', modelPath }, LOAD_TIMEOUT_MS)
      .then(() => {
        this.loadPromise = null
        this.push()
      })
      .catch(e => {
        this.loadPromise = null
        this.kill()
        const msg = e instanceof Error ? e.message : String(e)
        this.setLastError(`模型加载失败：${msg}`)
        throw e
      })
    this.push()
    return this.loadPromise
  }

  private scheduleIdleUnload(): void {
    const min = this.settings().aiIdleUnloadMin
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (min <= 0) return // 0 = 常驻
    this.idleTimer = setTimeout(
      () => {
        if (!this.busy && !this.loadPromise) this.kill()
      },
      min * 60_000
    )
  }

  // ---------- 推理 ----------

  /** 串行执行一次推理 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async inferDraftsRaw(kind: AiTaskKind, text: string): Promise<{ raw: string; ms: number }> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      const { system, user } = buildExtractionPrompt(kind, text)
      this.busy = true
      this.push()
      try {
        const res = await this.request(
          { type: 'infer', kind: 'drafts', system, user, maxTokens: 600 },
          INFER_TIMEOUT_MS
        )
        if (!res.ok) throw new Error(res.error)
        if (res.type !== 'infer') throw new Error('意外的 worker 响应')
        return { raw: res.result, ms: res.ms }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // 推理超时说明 worker 大概率已挂起：杀掉它，下一次调用自动重启，不再连环陪葬
        if (msg.includes('超时')) this.kill()
        this.setLastError(msg)
        throw e
      } finally {
        this.busy = false
        this.scheduleIdleUnload()
        this.push()
      }
    })
  }

  /** 提取任务草稿（parse / parseMany / journalTodos） */
  async extractDrafts(kind: AiTaskKind, text: string): Promise<{ drafts: TaskDraft[]; raw: string; ms: number }> {
    const { raw, ms } = await this.inferDraftsRaw(kind, text)
    return { drafts: validateDrafts(raw), raw, ms }
  }

  /** 快速添加兜底：返回首条草稿（可能为 null） */
  async quickAddParse(text: string): Promise<{ draft: TaskDraft | null; ms: number }> {
    const { drafts, ms } = await this.extractDrafts('parse', text)
    return { draft: drafts[0] ?? null, ms }
  }

  /** 周回顾：自由文本生成 */
  async weeklyReview(input: ReviewInput): Promise<{ text: string; ms: number }> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      const { system, user } = buildWeeklyReviewPrompt(input)
      this.busy = true
      this.push()
      try {
        const res = await this.request({ type: 'infer', kind: 'review', system, user, maxTokens: 900 }, INFER_TIMEOUT_MS)
        if (!res.ok) throw new Error(res.error)
        if (res.type !== 'infer') throw new Error('意外的 worker 响应')
        return { text: res.result.trim(), ms: res.ms }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('超时')) this.kill()
        this.setLastError(msg)
        throw e
      } finally {
        this.busy = false
        this.scheduleIdleUnload()
        this.push()
      }
    })
  }

  /** 设置页「试一句」：走完整提取链路，返回原始模型输出便于调试 */
  async test(text?: string): Promise<{ raw: string; ms: number }> {
    const sample = text?.trim() || '周五之前 把季度总结初稿写完'
    const { raw, ms } = await this.inferDraftsRaw('parse', sample)
    return { raw, ms }
  }

  // ---------- 下载 ----------

  async startDownload(): Promise<void> {
    if (this.downloader.running) return
    this.downloadError = ''
    this.downloadProgress = 0
    this.push()
    const dest = join(this.deps.modelsDir, AI_MODEL_FILE)
    const controller = new AbortController()
    void this.downloader
      .download(dest, (received, total) => {
        this.downloadProgress = total > 0 ? Math.min(1, received / total) : -1
        this.push()
      })
      .then(() => {
        this.downloadProgress = 1
        this.push()
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg !== '下载已取消') this.downloadError = msg
        this.downloadProgress = -1
        this.push()
      })
    // AbortController 挂到 downloader 内部，这里保留引用以防泄漏告警
    void controller
  }

  cancelDownload(): void {
    this.downloader.cancel()
    this.downloadProgress = -1
    this.push()
  }

  // ---------- 探针（scripts/ai-smoke.mjs 用，不进产品路径） ----------

  async probe(withModelPath?: string): Promise<ProbeResult & { forkMs: number; loadMs: number | null }> {
    const t0 = Date.now()
    this.worker ??= this.forkWorker()
    const res = await this.request({ type: 'probe' }, 60_000)
    if (!res.ok) throw new Error(res.error)
    const result = res.type === 'probe' ? res.result : { initMs: -1, loadMs: null, ctxMs: null }
    let loadMs: number | null = null
    if (withModelPath && existsSync(withModelPath)) {
      const loadRes = await this.request({ type: 'load', modelPath: withModelPath }, LOAD_TIMEOUT_MS)
      if (!loadRes.ok) throw new Error(loadRes.error)
      loadMs = loadRes.type === 'load' ? loadRes.ms : null
    }
    return { ...result, forkMs: Date.now() - t0, loadMs }
  }

  /** 诊断用：绕过设置开关直接推理一次（probe 已加载模型的前提下） */
  async debugInfer(kind: AiTaskKind, text: string): Promise<{ raw: string; ms: number }> {
    const { system, user } = buildExtractionPrompt(kind, text)
    const res = await this.request({ type: 'infer', kind: 'drafts', system, user, maxTokens: 500 }, INFER_TIMEOUT_MS)
    if (!res.ok) throw new Error(res.error)
    if (res.type !== 'infer') throw new Error('意外的 worker 响应')
    return { raw: res.result, ms: res.ms }
  }
}
