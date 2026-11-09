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
  /** 今日聚焦：计划处理日期 YYYY-MM-DD；null = 未列入任何一天的计划（与截止日无关的主动规划） */
  plannedDay: string | null
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

/** 日记/随笔：自由记录想法、日常与规划 */
export interface JournalEntry {
  id: string
  /** 标题（可留空） */
  title: string
  /** 正文（多行纯文本） */
  content: string
  /** 心情 emoji（空 = 未标记） */
  mood: string
  tags: string[]
  /** 置顶（规划/重要记录常驻顶部） */
  pinned: boolean
  /** 日记归属日期 YYYY-MM-DD */
  date: string
  createdAt: string
  updatedAt: string
}

/** 笔记文件夹（支持嵌套：parentId = null 为根级） */
export interface NoteFolder {
  id: string
  name: string
  color: string
  /** 父文件夹 id；null = 根级 */
  parentId: string | null
  createdAt: string
}

/** 笔记：归属某个文件夹（folderId 必有） */
export interface Note {
  id: string
  title: string
  content: string
  folderId: string
  tags: string[]
  /** 置顶（列表顶部常驻） */
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export type ThemeMode = 'system' | 'light' | 'dark'

/** 提醒方式：card=置顶弹窗卡片（默认） toast=Windows 系统通知 both=两者同时 */
export type NotifyMode = 'card' | 'toast' | 'both'

export interface Settings {
  theme: ThemeMode
  notifyMode: NotifyMode
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
  /** 本地 AI 增强（Qwen2.5-1.5B 等 GGUF 小模型） */
  aiEnabled: boolean
  /** 快速添加：正则未识别出时间时用 AI 兜底解析 */
  aiQuickAddFallback: boolean
  /** 模型空闲自动卸载（分钟，0 = 常驻） */
  aiIdleUnloadMin: number
  /** 手动指定的 GGUF 模型路径（空 = 默认下载位置） */
  aiModelPath: string
  /** GPU 加速（Vulkan 核显推理，失败自动回退 CPU） */
  aiGpu: boolean
}

export interface Database {
  version: number
  tasks: Task[]
  projects: Project[]
  snoozes: Snooze[]
  /** 日记/随笔（随心记） */
  entries: JournalEntry[]
  /** 笔记 */
  notes: Note[]
  /** 笔记文件夹 */
  noteFolders: NoteFolder[]
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

/** 自动更新状态（主进程 → 渲染端推送） */
export interface UpdaterState {
  /** idle | checking | available | not-available | downloading | downloaded | error */
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  /** 发现的新版本号 */
  version: string
  /** 0..1；-1 = 未知 */
  progress: number
  error: string
  /** 更新说明（Release 正文，可能为空） */
  notes: string
  /** true = 当前形态无法静默更新（portable / macOS 未签名），只提示去下载页 */
  fallback: boolean
}
