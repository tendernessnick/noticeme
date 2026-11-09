// AI 推理 worker：运行在 Electron utilityProcess 中（不阻塞主进程调度）
// node-llama-cpp 是含顶层 await 的纯 ESM 包——必须用真正的动态 import() 加载
// （rollup 输出经 renderDynamicImport 保留 import() 形态，见 electron.vite.config.ts）
import type { Llama, LlamaContext, LlamaJsonSchemaGrammar, LlamaModel } from 'node-llama-cpp'
import { TASK_DRAFTS_SCHEMA, TASK_SUGGESTIONS_SCHEMA } from '../../shared/ai-schema'
import type { WorkerRequest, WorkerResponse, WorkerProgress, ProbeResult } from './types'

// utilityProcess 子进程通信端口（Electron 注入到 process 上，此处本地最小类型声明）
interface ParentPort {
  on(ev: 'message', cb: (e: { data: unknown }) => void): void
  postMessage(v: WorkerResponse | WorkerProgress): void
}
const port = (process as unknown as { parentPort: ParentPort }).parentPort

type LlamaCpp = typeof import('node-llama-cpp')

let nlc: LlamaCpp | null = null
let llama: Llama | null = null
let model: LlamaModel | null = null
let context: LlamaContext | null = null
let grammar: LlamaJsonSchemaGrammar<typeof TASK_DRAFTS_SCHEMA> | null = null
let suggestGrammar: LlamaJsonSchemaGrammar<typeof TASK_SUGGESTIONS_SCHEMA> | null = null
/** 当前 llama 实例的实际后端（请求 GPU 但失败时为 false） */
let gpuUsed = false
const aborts = new Map<number, AbortController>()

const reply = (msg: WorkerResponse): void => port.postMessage(msg)

async function loadRuntime(): Promise<LlamaCpp> {
  if (nlc) return nlc
  // 拼接模块名 + @vite-ignore：绕过静态分析，让 rollup 在 CJS 输出中原样保留 import()
  // （node-llama-cpp 含顶层 await，require() 无法加载，不能用静态 import）
  const spec = 'node-' + 'llama-cpp'
  nlc = (await import(/* @vite-ignore */ spec)) as LlamaCpp
  return nlc
}

/** 初始化后端并加载模型；gpu=true 请求 Vulkan，失败抛错由主进程决定回退 */
async function doLoad(modelPath: string, gpu: boolean): Promise<void> {
  if (context) return
  const m = await loadRuntime()
  // 诊断/调优通道：强制指定 Vulkan 设备索引（逗号分隔），须在原生后端初始化前设置
  const vkDevice = process.env.NOTICE_ME_AI_VK_DEVICE
  if (vkDevice && gpu) process.env.GGML_VK_VISIBLE_DEVICES = vkDevice
  llama ??= await m.getLlama({ gpu: gpu ? 'vulkan' : false, logLevel: m.LlamaLogLevel.error })
  gpuUsed = gpu
  model ??= await llama.loadModel({ modelPath })
  context ??= await model.createContext({ contextSize: 4096, sequences: 1 })
  grammar ??= await llama.createGrammarForJsonSchema(TASK_DRAFTS_SCHEMA)
  suggestGrammar ??= await llama.createGrammarForJsonSchema(TASK_SUGGESTIONS_SCHEMA)
}

function disposeAll(): void {
  for (const c of aborts.values()) c.abort()
  aborts.clear()
  try {
    context?.dispose()
  } catch { /* ignore */ }
  try {
    model?.dispose()
  } catch { /* ignore */ }
  context = null
  model = null
  grammar = null
  suggestGrammar = null
  // llama 实例持有原生资源，随进程退出整体释放即可
}

async function handle(req: WorkerRequest): Promise<void> {
  const t0 = Date.now()
  try {
    if (req.type === 'probe') {
      const m = await loadRuntime()
      const initStart = Date.now()
      // 必须用 'auto' 而非固定 false：probe 先于 load 执行，false 会把 llama 实例
      // 初始化成 CPU 后端，后续 load 请求的 gpu:'vulkan' 被 `llama ??=` 短路，
      // GPU 预检永远报「未检测到设备」（2026-11-08 修 Vulkan 驱动时实测踩坑）
      const inst = llama ?? (await m.getLlama({ gpu: 'auto', logLevel: m.LlamaLogLevel.error }))
      llama ??= inst
      gpuUsed = false
      const result: ProbeResult = { initMs: Date.now() - initStart, loadMs: null, ctxMs: null }
      reply({ id: req.id, ok: true, type: 'probe', result })
      return
    }

    if (req.type === 'load') {
      await doLoad(req.modelPath, req.gpu)
      let gpuDevices: string[] | undefined
      if (req.gpu && llama) {
        try {
          gpuDevices = await llama.getGpuDeviceNames()
        } catch { /* ignore */ }
      }
      reply({ id: req.id, ok: true, type: 'load', ms: Date.now() - t0, gpuUsed, gpuDevices })
      return
    }

    if (req.type === 'abort') {
      aborts.get(req.targetId)?.abort()
      return
    }

    if (req.type === 'infer') {
      if (!context) throw new Error('模型尚未加载')
      const ctrl = new AbortController()
      aborts.set(req.id, ctrl)
      try {
        const seq = context.getSequence()
        const session = new nlc!.LlamaChatSession({ contextSequence: seq, systemPrompt: req.system })
        try {
          const text = await session.prompt(req.user, {
            grammar: req.kind === 'drafts' ? (grammar as never) : req.kind === 'suggest' ? (suggestGrammar as never) : undefined,
            maxTokens: req.maxTokens,
            temperature: 0.15,
            signal: ctrl.signal,
            stopOnAbortSignal: true,
            // 生成进度：转发字符增量给主进程，渲染端展示「已生成 N 字」避免像卡死
            onTextChunk: chunk => {
              port.postMessage({ type: 'progress', id: req.id, chars: chunk.length })
            }
          })
          reply({ id: req.id, ok: true, type: 'infer', result: text, ms: Date.now() - t0 })
        } finally {
          // 会话历史随用随弃，序列保留（模型/上下文常驻 worker 生命周期）
          session.dispose({ disposeSequence: false })
        }
      } finally {
        aborts.delete(req.id)
      }
      return
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    const msg = aborted ? '推理已中止' : e instanceof Error ? e.message : String(e)
    reply({ id: req.id, ok: false, type: req.type, error: msg })
  }
}

port.on('message', e => {
  void handle(e.data as WorkerRequest)
})

// 主进程 kill() 时给原生资源一个体面的收尾
process.on('exit', disposeAll)
