import { Search } from 'lucide-react'
import { useStore } from '../store'

const TITLES: Record<string, { title: string; sub?: string }> = {
  today: { title: '今天' },
  upcoming: { title: '即将到来' },
  all: { title: '全部任务' },
  done: { title: '已完成' }
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
  const activeCount = db.tasks.filter(t => !t.done).length

  return (
    <div className="flex items-center gap-4 px-6 pb-2 pt-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold leading-tight">{title}</h1>
        <p className="mt-0.5 text-xs text-zinc-400">
          {dateLabel} · {activeCount} 项待办
        </p>
      </div>
      <div className="relative ml-auto w-60 shrink-0">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索任务…"
          className="input !py-1.5 pl-8"
        />
      </div>
    </div>
  )
}
