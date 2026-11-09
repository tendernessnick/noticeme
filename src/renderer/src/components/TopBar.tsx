import { Search } from 'lucide-react'
import { DEFAULT_NOTE_FOLDER_ID, localToday } from '../../../shared/defaults'
import { useStore } from '../store'
import { START_OF_TODAY } from '../utils/ui'

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

  // 今日完成度（截止在今天及今天之前的任务）
  const start = START_OF_TODAY()
  const end = start + 86400000
  const todays = db.tasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() < end)
  const doneToday = todays.filter(t => t.done).length
  const progress = todays.length > 0 ? Math.round((doneToday / todays.length) * 100) : 0

  return (
    <div className="flex items-center gap-4 px-6 pb-2 pt-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold leading-tight">{title}</h1>
        <div className="mt-0.5 flex items-center gap-2">
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
          {!isJournal && !isNotes && !isFocus && todays.length > 0 && (
            <span className="flex items-center gap-1.5" title={`今日完成 ${doneToday}/${todays.length}`}>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <span
                  className="block h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </span>
              <span className="text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                {doneToday}/{todays.length}
              </span>
            </span>
          )}
        </div>
      </div>
      {!isJournal && !isNotes && !isFocus && (
        <div className="relative ml-auto w-60 shrink-0">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索任务…"
            className="input !py-1.5 pl-8"
          />
        </div>
      )}
    </div>
  )
}
