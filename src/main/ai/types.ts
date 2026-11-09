// AI worker 进程协议（主进程 ↔ utilityProcess，JSON 消息）
// worker 只做两件事：加载模型、按给定的 system/user 提示推理——提示词构建与结果校验都在主进程/shared 层

/** 主进程 → worker */
export type WorkerRequest =
  | { id: number; type: 'probe' }
  | { id: number; type: 'load'; modelPath: string; /** true = Vulkan GPU（失败由主进程回退 CPU） */ gpu: boolean }
  | {
      id: number
      type: 'infer'
      /** 'drafts' = grammar 约束输出任务 JSON；'suggest' = grammar 约束输出今日聚焦建议；'review' = 自由文本 */
      kind: 'drafts' | 'suggest' | 'review'
      system: string
      user: string
      maxTokens: number
    }
  | { id: number; type: 'abort'; targetId: number }

export interface ProbeResult {
  /** getLlama() 初始化耗时 ms（含原生二进制加载） */
  initMs: number
  /** 模型加载耗时 ms（probe 不带模型路径时为 null） */
  loadMs: number | null
  /** 上下文创建 + 会话就绪耗时 ms */
  ctxMs: number | null
}

/** worker → 主进程：推理进度事件（与响应共用请求 id） */
export interface WorkerProgress {
  type: 'progress'
  id: number
  /** 本 chunk 的字符数（累计由主进程负责） */
  chars: number
}

/** worker → 主进程 */
export type WorkerResponse =
  | { id: number; ok: true; type: 'probe'; result: ProbeResult }
  | { id: number; ok: true; type: 'load'; ms: number; /** 实际使用的后端（请求 GPU 但失败回退 CPU 时为 false） */ gpuUsed: boolean; /** 本机可见的 Vulkan 设备名（GPU 模式时返回） */ gpuDevices?: string[] }
  | { id: number; ok: true; type: 'infer'; result: string; ms: number }
  | { id: number; ok: false; type: WorkerRequest['type']; error: string }
