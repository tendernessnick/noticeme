// 预加载脚本：contextBridge 暴露类型安全 API
import { contextBridge, ipcRenderer } from 'electron'
import type { Database, JournalEntry, Note, NoteFolder, Project, Settings, Task, UpdaterState } from '../shared/types'
import type { AiStatus, FocusSuggestion, TaskDraft } from '../shared/ai-schema'
import type { FocusCandidate, ReviewInput } from '../shared/ai-prompts'

export interface AlertActionPayload {
  type: 'complete' | 'snooze' | 'open' | 'dismiss'
  taskId: string
  minutes?: number
}

export interface AiParseResult {
  draft: TaskDraft | null
  ms: number
}

export interface AiDraftsResult {
  drafts: TaskDraft[]
  raw: string
  ms: number
}

export interface AiReviewResult {
  text: string
  ms: number
}

export interface AiTestResult {
  raw: string
  ms: number
}

export interface AiFocusSuggestResult {
  suggestions: FocusSuggestion[]
  ms: number
}

const api = {
  getDb: (): Promise<Database> => ipcRenderer.invoke('db:get'),
  patchTask: (id: string, patch: Partial<Task>): Promise<void> => ipcRenderer.invoke('task:patch', id, patch),
  patchJournal: (id: string, patch: Partial<JournalEntry>): Promise<void> => ipcRenderer.invoke('journal:patch', id, patch),
  patchNote: (id: string, patch: Partial<Note>): Promise<void> => ipcRenderer.invoke('note:patch', id, patch),
  upsertTask: (task: Task): Promise<void> => ipcRenderer.invoke('task:upsert', task),
  deleteTask: (id: string): Promise<void> => ipcRenderer.invoke('task:delete', id),
  setTaskDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('task:setDone', { id, done }),
  planTasksDay: (ids: string[], day: string | null): Promise<void> =>
    ipcRenderer.invoke('task:planDay', { ids, day }),
  upsertJournal: (entry: JournalEntry): Promise<void> => ipcRenderer.invoke('journal:upsert', entry),
  deleteJournal: (id: string): Promise<void> => ipcRenderer.invoke('journal:delete', id),
  upsertNote: (note: Note): Promise<void> => ipcRenderer.invoke('note:upsert', note),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('note:delete', id),
  addNoteFolder: (name: string, color: string, parentId: string | null): Promise<string> =>
    ipcRenderer.invoke('noteFolder:add', { name, color, parentId }),
  updateNoteFolder: (folder: NoteFolder): Promise<void> => ipcRenderer.invoke('noteFolder:update', folder),
  deleteNoteFolder: (id: string): Promise<void> => ipcRenderer.invoke('noteFolder:delete', id),
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
  // ---------- 本地 AI ----------
  aiStatus: (): Promise<AiStatus> => ipcRenderer.invoke('ai:status'),
  aiDownloadStart: (): Promise<void> => ipcRenderer.invoke('ai:download:start'),
  aiDownloadCancel: (): Promise<void> => ipcRenderer.invoke('ai:download:cancel'),
  aiPickModel: (): Promise<string> => ipcRenderer.invoke('ai:model:pick'),
  aiParse: (text: string): Promise<AiParseResult> => ipcRenderer.invoke('ai:parse', text),
  aiExtractMany: (text: string): Promise<AiDraftsResult> => ipcRenderer.invoke('ai:extractMany', text),
  aiJournalTodos: (content: string): Promise<AiDraftsResult> => ipcRenderer.invoke('ai:journalTodos', content),
  aiFocusSuggest: (candidates: FocusCandidate[]): Promise<AiFocusSuggestResult> =>
    ipcRenderer.invoke('ai:focusSuggest', candidates),
  aiWeeklyReview: (payload: ReviewInput): Promise<AiReviewResult> => ipcRenderer.invoke('ai:weeklyReview', payload),
  aiTest: (text?: string): Promise<AiTestResult> => ipcRenderer.invoke('ai:test', text),
  // ---------- 自动更新 ----------
  updaterState: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:state'),
  updaterCheck: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:check'),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  updaterOpenPage: (): Promise<void> => ipcRenderer.invoke('updater:openPage'),
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
  },
  onAiState: (cb: (s: AiStatus) => void): (() => void) => {
    const l = (_e: unknown, s: AiStatus): void => cb(s)
    ipcRenderer.on('ai:state', l as never)
    return () => ipcRenderer.removeListener('ai:state', l as never)
  },
  onUpdaterState: (cb: (s: UpdaterState) => void): (() => void) => {
    const l = (_e: unknown, s: UpdaterState): void => cb(s)
    ipcRenderer.on('updater:state', l as never)
    return () => ipcRenderer.removeListener('updater:state', l as never)
  },
  onAiProgress: (cb: (p: { chars: number }) => void): (() => void) => {
    const l = (_e: unknown, p: { chars: number }): void => cb(p)
    ipcRenderer.on('ai:infer-progress', l as never)
    return () => ipcRenderer.removeListener('ai:infer-progress', l as never)
  }
}

contextBridge.exposeInMainWorld('noticeme', api)

export type NoticeMeApi = typeof api
