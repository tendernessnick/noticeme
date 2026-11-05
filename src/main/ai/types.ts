// AI worker 进程协议（主进程 ↔ utilityProcess，JSON 消息）
// worker 只做两件事：加载模型、按给定的 system/user 提示推理——提示词构建与结果校验都在主进程/shared 层

/** 主进程 → worker */
export type WorkerRequest =
  | { id: number; type: 'probe' }
  | { id: number; type: 'load'; modelPath: string }
  | {
      id: number
      type: 'infer'
      /** 'drafts' = grammar 约束输出任务 JSON；'review' = 自由文本 */
      kind: 'drafts' | 'review'
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

/** worker → 主进程 */
export type WorkerResponse =
  | { id: number; ok: true; type: 'probe'; result: ProbeResult }
  | { id: number; ok: true; type: 'load'; ms: number }
  | { id: number; ok: true; type: 'infer'; result: string; ms: number }
  | { id: number; ok: false; type: WorkerRequest['type']; error: string }
