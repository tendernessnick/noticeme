import { useEffect } from 'react'
import type { Task } from '../../shared/types'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import QuickAdd from './components/QuickAdd'
import TaskList from './components/TaskList'
import TaskDetail from './components/TaskDetail'
import JournalView from './components/JournalView'
import SettingsModal from './components/SettingsModal'

export default function App(): JSX.Element {
  const db = useStore(s => s.db)
  const selectedTaskId = useStore(s => s.selectedTaskId)
  const settingsOpen = useStore(s => s.settingsOpen)
  const view = useStore(s => s.view)
  const init = useStore(s => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!db) {
    return (
      <div className="grid h-screen place-items-center text-sm text-zinc-500">加载中…</div>
    )
  }

  const selected: Task | null = selectedTaskId
    ? db.tasks.find(t => t.id === selectedTaskId) ?? null
    : null

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar />
      {view.kind === 'journal' ? (
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <JournalView />
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="px-6 pt-1 pb-2">
            <QuickAdd />
          </div>
          <TaskList />
        </main>
      )}
      {selected && <TaskDetail task={selected} />}
      {settingsOpen && <SettingsModal />}
    </div>
  )
}
