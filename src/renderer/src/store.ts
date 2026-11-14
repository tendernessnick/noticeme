// 渲染端全局状态（zustand）：主进程 DB 为唯一数据源，本地只保存视图状态
import { create } from 'zustand'
import type { Database, JournalEntry, Note, NoteFolder, Project, Settings, Task, UiEvent, UpdaterState, View } from '../../shared/types'
import type { AiStatus } from '../../shared/ai-schema'
import { applyTheme } from './utils/theme'

export type { View, ViewKind } from '../../shared/types'

interface AppState {
  db: Database | null
  initError: string
  view: View
  search: string
  selectedTaskId: string | null
  settingsOpen: boolean
  quickAddToken: number
  showDone: boolean
  /** 本地 AI 运行时状态（主进程推送） */
  aiStatus: AiStatus | null
  /** 自动更新状态（主进程推送） */
  updater: UpdaterState | null
  init(): () => void
  setView(v: View): void
  setSearch(s: string): void
  selectTask(id: string | null): void
  setSettingsOpen(b: boolean): void
  bumpQuickAdd(): void
  toggleShowDone(): void
  upsertTask(t: Task): Promise<void>
  deleteTask(id: string): Promise<void>
  setDone(id: string, done: boolean): Promise<void>
  planTasksDay(ids: string[], day: string | null): Promise<void>
  upsertJournal(e: JournalEntry): Promise<void>
  deleteJournal(id: string): Promise<void>
  upsertNote(n: Note): Promise<void>
  deleteNote(id: string): Promise<void>
  addNoteFolder(name: string, color: string, parentId: string | null): Promise<string>
  updateNoteFolder(f: NoteFolder): Promise<void>
  deleteNoteFolder(id: string): Promise<void>
  addProject(name: string, color: string): Promise<string>
  updateProject(p: Project): Promise<void>
  deleteProject(id: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  db: null,
  initError: '',
  view: { kind: 'today' },
  search: '',
  selectedTaskId: null,
  settingsOpen: false,
  quickAddToken: 0,
  showDone: false,
  aiStatus: null,
  updater: null,

  init: () => {
    let disposed = false
    let dbReceived = false
    let aiReceived = false
    let updaterReceived = false
    const cleanups = [window.noticeme.onDbUpdated(ndb => {
      dbReceived = true
      set({ db: ndb })
      applyTheme(ndb.settings.theme)
    }), window.noticeme.onAiState(s => { aiReceived = true; set({ aiStatus: s }) }),
    window.noticeme.onUpdaterState(s => { updaterReceived = true; set({ updater: s }) }),
    window.noticeme.onUi((p: UiEvent) => {
      if (p.type === 'quickadd') set(s => ({ quickAddToken: s.quickAddToken + 1 }))
      else if (p.type === 'open-task') set({ selectedTaskId: p.taskId })
    })]
    void window.noticeme.getDb().then(db => {
      if (disposed || dbReceived) return
      set({ db, initError: '' })
      applyTheme(db.settings.theme)
    }).catch(error => { if (!disposed) set({ initError: String(error) }) })
    void window.noticeme.aiStatus().then(s => { if (!disposed && !aiReceived) set({ aiStatus: s }) }).catch(() => {})
    void window.noticeme.updaterState().then(s => { if (!disposed && !updaterReceived) set({ updater: s }) }).catch(() => {})
    return () => { disposed = true; cleanups.forEach(cleanup => cleanup()) }
  },

  setView: v => set({ view: v, search: '' }),
  setSearch: s => set({ search: s }),
  selectTask: id => set({ selectedTaskId: id }),
  setSettingsOpen: b => set({ settingsOpen: b }),
  bumpQuickAdd: () => set(s => ({ quickAddToken: s.quickAddToken + 1 })),
  toggleShowDone: () => set(s => ({ showDone: !s.showDone })),

  upsertTask: async t => {
    await window.noticeme.upsertTask(t)
  },
  deleteTask: async id => {
    if (get().selectedTaskId === id) set({ selectedTaskId: null })
    await window.noticeme.deleteTask(id)
  },
  setDone: async (id, done) => {
    await window.noticeme.setTaskDone(id, done)
  },
  planTasksDay: async (ids, day) => {
    await window.noticeme.planTasksDay(ids, day)
  },
  upsertJournal: async e => {
    await window.noticeme.upsertJournal(e)
  },
  deleteJournal: async id => {
    await window.noticeme.deleteJournal(id)
  },
  upsertNote: async n => {
    await window.noticeme.upsertNote(n)
  },
  deleteNote: async id => {
    await window.noticeme.deleteNote(id)
  },
  addNoteFolder: async (name, color, parentId) => window.noticeme.addNoteFolder(name, color, parentId),
  updateNoteFolder: async f => {
    await window.noticeme.updateNoteFolder(f)
  },
  deleteNoteFolder: async id => {
    await window.noticeme.deleteNoteFolder(id)
  },
  addProject: async (name, color) => window.noticeme.addProject(name, color),
  updateProject: async p => {
    await window.noticeme.updateProject(p)
  },
  deleteProject: async id => {
    await window.noticeme.deleteProject(id)
  },
  updateSettings: async patch => {
    await window.noticeme.updateSettings(patch)
  }
}))
