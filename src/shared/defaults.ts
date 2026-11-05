// 默认数据与工厂函数（纯函数，供主进程 / 渲染端 / 测试共用，禁止 Node 专属依赖）
import type { Database, JournalEntry, Project, Settings, Task } from './types'
import { INBOX_PROJECT_ID } from './types'
import { addDays, startOfDay } from './datetime'

export const DATA_VERSION = 1

/** 内置本地模型：Qwen2.5-1.5B-Instruct（Q4_K_M GGUF，约 1 GB），设置页按需下载 */
export const AI_MODEL_FILE = 'qwen2.5-1.5b-instruct-q4_k_m.gguf'
/** 模型下载源（依次尝试：国内镜像 → 官方） */
export const AI_MODEL_URLS = [
  'https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf'
]

/** 浏览器 / Node 通用的 id 生成 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const PROJECT_PALETTE = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'
]

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    notifyMode: 'card',
    soundOn: true,
    autostart: false,
    closeToTray: true,
    hotkeyQuickAdd: 'Control+Alt+N',
    hotkeyShow: 'Control+Alt+S',
    snoozePresets: [5, 10, 30, 60, 1440],
    nagEnabled: false,
    nagIntervalMin: 10,
    missedFireWindowMin: 30,
    aiEnabled: false,
    aiQuickAddFallback: true,
    aiIdleUnloadMin: 3,
    aiModelPath: ''
  }
}

export function newTask(partial: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: uid(),
    title: '',
    notes: '',
    projectId: null,
    tags: [],
    priority: 3,
    dueAt: null,
    reminders: [],
    repeat: null,
    done: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    order: Date.now(),
    ...partial
  }
}

/** 本地日期字符串 YYYY-MM-DD */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function newJournalEntry(partial: Partial<JournalEntry> = {}): JournalEntry {
  const now = new Date().toISOString()
  return {
    id: uid(),
    title: '',
    content: '',
    mood: '',
    tags: [],
    pinned: false,
    date: localToday(),
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

export function createDefaultDb(): Database {
  const inbox: Project = {
    id: INBOX_PROJECT_ID,
    name: '收集箱',
    color: '#6366f1',
    createdAt: new Date().toISOString()
  }
  const tomorrowNine = (() => {
    const d = addDays(startOfDay(new Date()), 1)
    d.setHours(9, 0, 0, 0)
    return d.toISOString()
  })()
  const welcomeEntry = newJournalEntry({
    title: '欢迎使用日记板块 ✨',
    content: '这里可以随便记——\n\n· 今天的想法和心情\n· 灵感与碎片信息\n· 接下来的规划\n\n右上角可标记心情与置顶，左侧按月份归档。',
    mood: '😊',
    tags: ['指南'],
    date: localToday()
  })
  const welcome = newTask({
    title: '欢迎使用 NoticeMe ✨',
    notes: '在顶部输入框试试自然语言快速添加：\n「明天 9 点 写周报 p1 #工作 @电脑」\n\n· 到点会弹出置顶提醒卡片\n· 可在设置中开启开机自启与全局快捷键',
    projectId: INBOX_PROJECT_ID,
    tags: ['指南'],
    priority: 4,
    dueAt: tomorrowNine,
    reminders: [{ id: uid(), offsetMin: null }]
  })
  return {
    version: DATA_VERSION,
    tasks: [welcome],
    projects: [inbox],
    snoozes: [],
    entries: [welcomeEntry],
    settings: defaultSettings(),
    firedKeys: [],
    updatedAt: new Date().toISOString()
  }
}

/** 校验导入/读取的数据形状（宽松校验，缺省字段用默认值补齐，含旧版本字段迁移） */
export function sanitizeDb(raw: unknown): Database | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Database>
  if (!Array.isArray(r.tasks) || !Array.isArray(r.projects)) return null
  const legacy = (r.settings ?? {}) as Partial<Settings> & {
    notifyAlert?: boolean
    notifyToast?: boolean
  }
  const settings = { ...defaultSettings(), ...legacy } as Settings
  if (!legacy.notifyMode) {
    // 旧版本迁移：只有 notifyAlert/notifyToast 两个独立开关。
    // 旧的「双开」会造成同一提醒出现两次（卡片 + 系统通知），统一收敛为仅卡片；
    // 仅开过系统通知的用户迁移为 toast。
    if (legacy.notifyAlert === false && legacy.notifyToast === true) settings.notifyMode = 'toast'
    else settings.notifyMode = 'card'
  }
  const rawEntries = (r as { entries?: unknown }).entries
  return {
    version: DATA_VERSION,
    tasks: r.tasks.filter(t => t && typeof t.id === 'string' && typeof t.title === 'string'),
    projects: r.projects.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string'),
    snoozes: Array.isArray(r.snoozes) ? r.snoozes : [],
    // 0.1.x 旧数据没有 entries 字段 → 迁移为空数组
    entries: Array.isArray(rawEntries)
      ? (rawEntries as JournalEntry[]).filter(e => e && typeof e.id === 'string' && typeof e.content === 'string')
      : [],
    settings,
    firedKeys: Array.isArray(r.firedKeys) ? r.firedKeys : [],
    updatedAt: new Date().toISOString()
  } as Database
}
