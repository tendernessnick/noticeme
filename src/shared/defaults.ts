// 默认数据与工厂函数（纯函数，供主进程 / 渲染端 / 测试共用，禁止 Node 专属依赖）
import type { Database, Project, Settings, Task } from './types'
import { INBOX_PROJECT_ID } from './types'
import { addDays, startOfDay } from './datetime'

export const DATA_VERSION = 1

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
    notifyAlert: true,
    notifyToast: true,
    soundOn: true,
    autostart: false,
    closeToTray: true,
    hotkeyQuickAdd: 'Control+Alt+N',
    hotkeyShow: 'Control+Alt+S',
    snoozePresets: [5, 10, 30, 60, 1440],
    nagEnabled: false,
    nagIntervalMin: 10,
    missedFireWindowMin: 30
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
    settings: defaultSettings(),
    firedKeys: [],
    updatedAt: new Date().toISOString()
  }
}

/** 校验导入/读取的数据形状（宽松校验，缺省字段用默认值补齐） */
export function sanitizeDb(raw: unknown): Database | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Database>
  if (!Array.isArray(r.tasks) || !Array.isArray(r.projects)) return null
  const base = createDefaultDb()
  return {
    version: DATA_VERSION,
    tasks: r.tasks.filter(t => t && typeof t.id === 'string' && typeof t.title === 'string'),
    projects: r.projects.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string'),
    snoozes: Array.isArray(r.snoozes) ? r.snoozes : [],
    settings: { ...defaultSettings(), ...(r.settings ?? {}) },
    firedKeys: Array.isArray(r.firedKeys) ? r.firedKeys : [],
    updatedAt: new Date().toISOString()
  } as Database
}
