// AI 结构化输出的线协议 schema、校验修复与合并策略（纯函数层，不依赖任何模型运行时）
// 设计要点：为 1.5B 级小模型简化线协议——所有可能为空的字段统一用空字符串 "" 表示「无」，
// 避免跨 null 的联合类型在约束解码下生成不稳定；本模块负责把线协议还原为强类型并兜住幻觉。
import type { Priority } from './types'
import type { ParsedQuickAdd } from './parse'

/** 校验后的任务草稿（AI 提取结果，供预览确认后才入库） */
export interface TaskDraft {
  title: string
  /** ISO 时间字符串；null = 无截止时间 */
  dueAt: string | null
  priority: Priority | null
  tags: string[]
  projectName: string | null
}

/** AI 运行时状态（主进程 → 渲染端推送 / 设置页展示） */
export interface AiStatus {
  enabled: boolean
  quickAddFallback: boolean
  /** 模型文件已就位（默认路径或手动指定） */
  modelAvailable: boolean
  /** 解析后的模型文件路径（无文件时也返回预期路径） */
  modelPath: string
  /** 是否使用手动指定的模型 */
  modelCustom: boolean
  /** worker 正在加载模型 */
  loading: boolean
  /** 模型已在内存中 */
  loaded: boolean
  /** 正在推理 */
  busy: boolean
  downloading: boolean
  /** 0..1；-1 = 总大小未知 */
  downloadProgress: number
  downloadError: string
  lastError: string
  idleUnloadMin: number
}

/**
 * 约束解码用的 JSON Schema（喂给 node-llama-cpp 的 GBNF 语法）。
 * 全字段 required + 空字符串表「无」，生成路径唯一，1.5B 模型也稳定输出。
 */
export const TASK_DRAFTS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          dueAt: { type: 'string' },
          priority: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          projectName: { type: 'string' }
        },
        required: ['title', 'dueAt', 'priority', 'tags', 'projectName']
      }
    }
  },
  required: ['tasks']
} as const

const ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/
const MAX_DRAFTS = 8
const MAX_TAG_LEN = 20
const MAX_TAGS = 5

/** 「刚才/刚刚」类表达允许落在 12 小时内；更早的视为模型幻觉丢弃 */
const PAST_TOLERANCE_MS = 12 * 3600_000
const FUTURE_LIMIT_MS = 1100 * 24 * 3600_000 // 约 3 年

function normalizeDueAt(v: unknown, now: Date): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || !ISO_LIKE_RE.test(s)) return null
  const ms = new Date(s.replace(' ', 'T')).getTime()
  if (!Number.isFinite(ms)) return null
  if (ms < now.getTime() - PAST_TOLERANCE_MS) return null
  if (ms > now.getTime() + FUTURE_LIMIT_MS) return null
  return new Date(ms).toISOString()
}

function normalizePriority(v: unknown): Priority | null {
  const s = typeof v === 'string' ? v.trim() : ''
  const n = Number(s)
  if (s === '' || !Number.isInteger(n) || n < 1 || n > 4) return null
  return n as Priority
}

function normalizeTitle(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  for (const t of v) {
    if (typeof t !== 'string') continue
    const s = t.trim().slice(0, MAX_TAG_LEN)
    if (s) seen.add(s)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

function normalizeProject(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, 30)
  return s || null
}

/**
 * 把约束解码产出的 JSON 文本校验/修复为任务草稿列表。
 * 单条无效丢弃该条（不整体失败），全部无效返回空数组——调用方回退到正则结果。
 */
export function validateDrafts(raw: string, now: Date = new Date()): TaskDraft[] {
  let data: unknown
  try {
    data = JSON.parse(raw.trim())
  } catch {
    const l = raw.indexOf('{')
    const r = raw.lastIndexOf('}')
    if (l < 0 || r <= l) return []
    try {
      data = JSON.parse(raw.slice(l, r + 1))
    } catch {
      return []
    }
  }
  const items = (data as { tasks?: unknown })?.tasks
  if (!Array.isArray(items)) return []

  const drafts: TaskDraft[] = []
  const seenKeys = new Set<string>()
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const title = normalizeTitle(o.title)
    if (!title) continue
    const draft: TaskDraft = {
      title,
      dueAt: normalizeDueAt(o.dueAt, now),
      priority: normalizePriority(o.priority),
      tags: normalizeTags(o.tags),
      projectName: normalizeProject(o.projectName)
    }
    const key = `${draft.title}|${draft.dueAt ?? ''}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    drafts.push(draft)
    if (drafts.length >= MAX_DRAFTS) break
  }
  return drafts
}

/**
 * 快速添加的合并策略：AI 只在正则失败（无截止时间）后被调用，此时
 * 标题/截止时间以 AI 为准（AI 会剥离自由表达中的时间词），其余字段正则结果优先、AI 补缺。
 */
export function mergeQuickAdd(regex: ParsedQuickAdd, ai: TaskDraft): ParsedQuickAdd {
  const tags = [...regex.tags]
  for (const t of ai.tags) if (!tags.includes(t) && tags.length < MAX_TAGS) tags.push(t)
  return {
    title: ai.title || regex.title,
    dueAt: ai.dueAt ?? regex.dueAt,
    priority: regex.priority ?? ai.priority,
    tags,
    projectName: regex.projectName ?? ai.projectName
  }
}
