// NoticeMe 共享数据模型（渲染端 / 主进程 / 测试共用，不依赖 Electron）
export type Priority = 1 | 2 | 3 | 4 // 1 = 最高

/** 提醒：offsetMin = 相对截止时间提前的分钟数；null 表示准时 */
export interface Reminder {
  id: string
  offsetMin: number | null
}

export type RepeatFreq = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'

export interface RepeatRule {
  freq: Exclude<RepeatFreq, 'none'>
  interval?: number
}

export interface Task {
  id: string
  title: string
  notes?: string
  /** null = 收集箱（inbox 项目） */
  projectId: string | null
  tags: string[]
  priority: Priority
  /** ISO 时间字符串；null = 无截止时间 */
  dueAt: string | null
  reminders: Reminder[]
  repeat: RepeatRule | null
  done: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
  order: number
}

export interface Project {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface Snooze {
  id: string
  taskId: string
  /** ISO：下次提醒时间 */
  fireAt: string
}

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemeMode
  /** 置顶弹窗提醒卡片 */
  notifyAlert: boolean
  /** Windows 系统通知 */
  notifyToast: boolean
  /** 提示音 */
  soundOn: boolean
  autostart: boolean
  /** 点击关闭 = 隐藏到托盘 */
  closeToTray: boolean
  hotkeyQuickAdd: string
  hotkeyShow: string
  /** 贪睡预设（分钟） */
  snoozePresets: number[]
  /** 未处理循环提醒 */
  nagEnabled: boolean
  nagIntervalMin: number
  /** 启动后错过补发窗口（分钟） */
  missedFireWindowMin: number
}

export interface Database {
  version: number
  tasks: Task[]
  projects: Project[]
  snoozes: Snooze[]
  settings: Settings
  /** 已触发提醒防重键：taskId:reminderId:dueAtISO */
  firedKeys: string[]
  updatedAt: string
}

export const INBOX_PROJECT_ID = 'inbox'

/** 提醒弹窗卡片条目（主进程 → alert 页） */
export interface AlertEntry {
  taskId: string
  title: string
  priority: Priority
  dueAt: string | null
  fireAt: string
}

export type UiEvent = { type: 'quickadd' } | { type: 'open-task'; taskId: string }
