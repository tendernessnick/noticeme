// 渲染端 window.noticeme 类型声明
import type { Database, Project, Settings, Task, UiEvent, AlertEntry } from '../shared/types'

export interface AlertActionPayload {
  type: 'complete' | 'snooze' | 'open' | 'dismiss'
  taskId: string
  minutes?: number
}

export interface NoticeMeApi {
  getDb(): Promise<Database>
  upsertTask(task: Task): Promise<void>
  deleteTask(id: string): Promise<void>
  setTaskDone(id: string, done: boolean): Promise<void>
  addProject(name: string, color: string): Promise<string>
  updateProject(p: Project): Promise<void>
  deleteProject(id: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  exportData(): Promise<boolean>
  importData(): Promise<boolean>
  dataInfo(): Promise<{ dir: string }>
  getChime(): Promise<string>
  alertAction(p: AlertActionPayload): Promise<void>
  alertSync(): Promise<{ items: AlertEntry[]; presets: number[] }>
  onDbUpdated(cb: (db: Database) => void): () => void
  onUi(cb: (p: UiEvent) => void): () => void
  onAlertQueue(cb: (p: { items: AlertEntry[]; presets: number[] }) => void): () => void
}

declare global {
  interface Window {
    noticeme: NoticeMeApi
  }
}

export {}
