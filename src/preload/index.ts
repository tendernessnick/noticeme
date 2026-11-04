// 预加载脚本：contextBridge 暴露类型安全 API
import { contextBridge, ipcRenderer } from 'electron'
import type { Database, JournalEntry, Project, Settings, Task } from '../shared/types'

export interface AlertActionPayload {
  type: 'complete' | 'snooze' | 'open' | 'dismiss'
  taskId: string
  minutes?: number
}

const api = {
  getDb: (): Promise<Database> => ipcRenderer.invoke('db:get'),
  upsertTask: (task: Task): Promise<void> => ipcRenderer.invoke('task:upsert', task),
  deleteTask: (id: string): Promise<void> => ipcRenderer.invoke('task:delete', id),
  setTaskDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('task:setDone', { id, done }),
  upsertJournal: (entry: JournalEntry): Promise<void> => ipcRenderer.invoke('journal:upsert', entry),
  deleteJournal: (id: string): Promise<void> => ipcRenderer.invoke('journal:delete', id),
  addProject: (name: string, color: string): Promise<string> =>
    ipcRenderer.invoke('project:add', { name, color }),
  updateProject: (p: Project): Promise<void> => ipcRenderer.invoke('project:update', p),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('project:delete', id),
  updateSettings: (patch: Partial<Settings>): Promise<void> =>
    ipcRenderer.invoke('settings:update', patch),
  exportData: (): Promise<boolean> => ipcRenderer.invoke('data:export'),
  importData: (): Promise<boolean> => ipcRenderer.invoke('data:import'),
  dataInfo: (): Promise<{ dir: string }> => ipcRenderer.invoke('data:info'),
  getChime: (): Promise<string> => ipcRenderer.invoke('assets:chime'),
  alertAction: (p: AlertActionPayload): Promise<void> => ipcRenderer.invoke('alert:action', p),
  alertSync: (): Promise<{ items: unknown[]; presets: number[] }> =>
    ipcRenderer.invoke('alert:sync'),
  alertResize: (h: number): Promise<void> => ipcRenderer.invoke('alert:resize', h),
  onDbUpdated: (cb: (db: Database) => void): (() => void) => {
    const l = (_e: unknown, db: Database): void => cb(db)
    ipcRenderer.on('db:updated', l as never)
    return () => ipcRenderer.removeListener('db:updated', l as never)
  },
  onUi: (cb: (p: { type: string; taskId?: string }) => void): (() => void) => {
    const l = (_e: unknown, p: { type: string; taskId?: string }): void => cb(p)
    ipcRenderer.on('ui', l as never)
    return () => ipcRenderer.removeListener('ui', l as never)
  },
  onAlertQueue: (cb: (p: { items: unknown[]; presets: number[] }) => void): (() => void) => {
    const l = (_e: unknown, p: { items: unknown[]; presets: number[] }): void => cb(p)
    ipcRenderer.on('alert:queue', l as never)
    return () => ipcRenderer.removeListener('alert:queue', l as never)
  }
}

contextBridge.exposeInMainWorld('noticeme', api)

export type NoticeMeApi = typeof api
