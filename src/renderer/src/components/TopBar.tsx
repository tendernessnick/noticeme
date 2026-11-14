import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { DEFAULT_NOTE_FOLDER_ID, localToday } from '../../../shared/defaults'
import { useStore } from '../store'
import { taskMetrics } from '../../../shared/task-metrics'

const TITLES: Record<string, { title: string; sub?: string }> = {
  focus: { title: '今日聚焦' },
  today: { title: '今天' },
  upcoming: { title: '即将到来' },
  all: { title: '全部任务' },
  done: { title: '已完成' },
  journal: { title: '随心记' }
}

export default function TopBar(): JSX.Element {
  const db = useStore(s => s.db)!
  const view = useStore(s => s.view)
  const search = useStore(s => s.search)
  const setSearch = useStore(s => s.setSearch)
  const searchRef = useRef<HTMLInputElement>(null)
  const canSearch = !['journal', 'noteFolder', 'focus'].includes(view.kind)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (canSearch && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canSearch])

  const now = new Date()
  const weekday = '周' + '日一二三四五六'[now.getDay()]
  const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekday}`

  let title = TITLES[view.kind]?.title ?? '任务'
  if (view.kind === 'project') {
    title = db.projects.find(p => p.id === (view.projectId ?? 'inbox'))?.name ?? '清单'
  }
  if (view.kind === 'noteFolder') {
    title = db.noteFolders.find(f => f.id === (view.folderId ?? DEFAULT_NOTE_FOLDER_ID))?.name ?? '笔记'
  }
  const activeCount = db.tasks.filter(t => !t.done).length
  const isJournal = view.kind === 'journal'
  const isNotes = view.kind === 'noteFolder'
  const isFocus = view.kind === 'focus'
  const focusCount = db.tasks.filter(t => !t.done && t.plannedDay === localToday()).length
  const noteCount = db.notes.filter(n => n.folderId === (view.folderId ?? DEFAULT_NOTE_FOLDER_ID)).length

  const { completedToday } = taskMetrics(db.tasks, now)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-2 pt-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold leading-tight">{title}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <p className="text-xs text-zinc-400">
            {dateLabel}
            {isJournal
              ? ` · ${db.entries.length} 篇`
              : isNotes
                ? ` · ${noteCount} 条笔记`
                : isFocus
                  ? ` · ${focusCount} 项计划`
                  : ` · ${activeCount} 项待办`}
          </p>
          {!isJournal && !isNotes && !isFocus && completedToday > 0 && (
            <span className="text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400" title="按记录的实际完成日期统计，包括无截止日任务；自动推进的重复任务没有完成日志，不计入此数">
              今天已完成 {completedToday} 项
            </span>
          )}
        </div>
      </div>
      {!isJournal && !isNotes && !isFocus && (
        <div className="relative ml-auto w-60 shrink-0">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSearch('') } }}
            placeholder="搜索当前视图 · Ctrl+F"
            aria-label="搜索当前视图中的任务"
            className="input !py-1.5 pl-8 pr-8"
          />
          {search && <button onClick={() => { setSearch(''); searchRef.current?.focus() }} aria-label="清除搜索" className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-accent"><X size={14} /></button>}
        </div>
      )}
    </div>
  )
}
