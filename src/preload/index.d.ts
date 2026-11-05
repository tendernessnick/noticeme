// 渲染端 window.noticeme 类型声明
import type { Database, JournalEntry, Project, Settings, Task, UiEvent, AlertEntry } from '../shared/types'
import type { AiStatus, TaskDraft } from '../shared/ai-schema'
import type { ReviewInput } from '../shared/ai-prompts'
import type { AiParseResult, AiDraftsResult, AiReviewResult, AiTestResult } from './index'

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
  upsertJournal(entry: JournalEntry): Promise<void>
  deleteJournal(id: string): Promise<void>
  addProject(name: string, color: string): Promise<string>
  updateProject(p: Project): Promise<void>
  deleteProject(id: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  exportData(): Promise<boolean>
  importData(): Promise<boolean>
  dataInfo(): Promise<{ dir: string }>
  getChime(): Promise<string>
  aiStatus(): Promise<AiStatus>
  aiDownloadStart(): Promise<void>
  aiDownloadCancel(): Promise<void>
  aiPickModel(): Promise<string>
  aiParse(text: string): Promise<AiParseResult>
  aiExtractMany(text: string): Promise<AiDraftsResult>
  aiJournalTodos(content: string): Promise<AiDraftsResult>
  aiWeeklyReview(payload: ReviewInput): Promise<AiReviewResult>
  aiTest(text?: string): Promise<AiTestResult>
  alertAction(p: AlertActionPayload): Promise<void>
  alertSync(): Promise<{ items: AlertEntry[]; presets: number[] }>
  alertResize(h: number): Promise<void>
  onDbUpdated(cb: (db: Database) => void): () => void
  onUi(cb: (p: UiEvent) => void): () => void
  onAlertQueue(cb: (p: { items: AlertEntry[]; presets: number[] }) => void): () => void
  onAiState(cb: (s: AiStatus) => void): () => void
}

declare global {
  interface Window {
    noticeme: NoticeMeApi
  }
}

export {}
