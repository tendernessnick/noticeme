import { useEffect, useRef, useState } from 'react'
import {
  Sun,
  CalendarDays,
  Layers,
  CheckCircle2,
  Settings as SettingsIcon,
  Plus,
  ListTodo,
  Pencil,
  Trash2,
  X,
  Check
} from 'lucide-react'
import type { Project } from '../../../shared/types'
import type { View } from '../store'
import { useStore } from '../store'
import { PROJECT_PALETTE } from '../../../shared/defaults'
import { START_OF_TODAY } from '../utils/ui'

const NAV: Array<{ kind: View['kind']; label: string; icon: typeof Sun }> = [
  { kind: 'today', label: '今天', icon: Sun },
  { kind: 'upcoming', label: '即将到来', icon: CalendarDays },
  { kind: 'all', label: '全部', icon: Layers },
  { kind: 'done', label: '已完成', icon: CheckCircle2 }
]

export default function Sidebar(): JSX.Element {
  const db = useStore(s => s.db)!
  const view = useStore(s => s.view)
  const setView = useStore(s => s.setView)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const addProject = useStore(s => s.addProject)
  const updateProject = useStore(s => s.updateProject)
  const deleteProject = useStore(s => s.deleteProject)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  /** 行内重命名状态 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  /** 两步删除确认状态（3 秒未确认自动复原） */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  const startConfirm = (id: string): void => {
    setConfirmingId(id)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmingId(null), 3000)
  }

  const cancelConfirm = (): void => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmingId(null)
  }

  const doDelete = async (id: string): Promise<void> => {
    cancelConfirm()
    await deleteProject(id)
    if (view.kind === 'project' && view.projectId === id) setView({ kind: 'today' })
  }

  const saveRename = async (p: Project): Promise<void> => {
    const name = editName.trim()
    if (name && name !== p.name) await updateProject({ ...p, name })
    setEditingId(null)
  }

  const startRename = (p: Project): void => {
    setConfirmingId(null)
    setEditingId(p.id)
    setEditName(p.name)
  }

  const submitProject = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) {
      setAdding(false)
      return
    }
    const color = PROJECT_PALETTE[db.projects.length % PROJECT_PALETTE.length]
    const id = await addProject(name, color)
    setNewName('')
    setAdding(false)
    setView({ kind: 'project', projectId: id })
  }

  const start = START_OF_TODAY()
  const active = db.tasks.filter(t => !t.done)
  const counts: Record<string, number> = {
    today: active.filter(t => t.dueAt && new Date(t.dueAt).getTime() < start + 86400000).length,
    upcoming: active.filter(t => t.dueAt && new Date(t.dueAt).getTime() >= start + 86400000).length,
    all: active.length,
    done: db.tasks.filter(t => t.done).length
  }
  const projectCount = (pid: string): number =>
    active.filter(t => (t.projectId ?? 'inbox') === pid).length

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200/70 bg-zinc-100/70 dark:border-zinc-800/80 dark:bg-zinc-900/60">
      {/* 品牌区 */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white shadow-soft">
          <ListTodo size={17} />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-tight tracking-wide">NoticeMe</div>
          <div className="text-[11px] text-zinc-400">别忘了任何事</div>
        </div>
      </div>

      {/* 固定视图 */}
      <nav className="px-2">
        {NAV.map(({ kind, label, icon: Icon }) => {
          const isActive = view.kind === kind
          return (
            <button
              key={kind}
              onClick={() => setView({ kind })}
              className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
                isActive
                  ? 'bg-accent/10 font-semibold text-accent dark:bg-accent/20'
                  : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-accent' : 'text-zinc-400'} />
              <span className="flex-1 text-left">{label}</span>
              {counts[kind] > 0 && (
                <span className="text-[11px] tabular-nums text-zinc-400">{counts[kind]}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* 项目 */}
      <div className="mt-4 flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">清单</span>
        <button
          onClick={() => setAdding(true)}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-200/70 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="新建清单"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="px-2">
        {adding && (
          <div className="mb-1 px-1">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void submitProject()
                if (e.key === 'Escape') {
                  setAdding(false)
                  setNewName('')
                }
              }}
              onBlur={() => void submitProject()}
              placeholder="清单名称，回车保存"
              className="w-full rounded-lg border border-accent/50 bg-white px-2.5 py-1 text-[13px] outline-none ring-2 ring-accent/15 dark:bg-zinc-800"
            />
          </div>
        )}
        {db.projects.map(p => {
          const isActive = view.kind === 'project' && view.projectId === p.id
          const isEditing = editingId === p.id
          const isConfirming = confirmingId === p.id
          const isCollection = p.id === 'inbox'
          if (isEditing) {
            return (
              <div key={p.id} className="mb-1 px-1">
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void saveRename(p)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => void saveRename(p)}
                  className="w-full rounded-lg border border-accent/50 bg-white px-2.5 py-1 text-[13px] outline-none ring-2 ring-accent/15 dark:bg-zinc-800"
                />
              </div>
            )
          }
          return (
            <div key={p.id}>
              <div
                onClick={() => setView({ kind: 'project', projectId: p.id })}
                className={`group mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
                  isActive
                    ? 'bg-accent/10 font-semibold text-accent dark:bg-accent/20'
                    : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                {/* 悬停操作（收集箱不可删改） */}
                {!isCollection && (
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        startRename(p)
                      }}
                      title="重命名"
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        startConfirm(p.id)
                      }}
                      title="删除清单（任务移回收集箱）"
                      className="rounded p-0.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                )}
                <span
                  className={`shrink-0 text-[11px] tabular-nums text-zinc-400 ${
                    !isCollection ? 'group-hover:hidden' : ''
                  }`}
                >
                  {projectCount(p.id) > 0 ? projectCount(p.id) : ''}
                </span>
              </div>
              {isConfirming && (
                <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1 text-[11px] text-red-500 animate-fadeIn">
                  <span className="flex-1 truncate">删除清单？任务移回收集箱</span>
                  <button
                    onClick={() => void doDelete(p.id)}
                    className="rounded bg-red-500 px-1.5 py-0.5 font-medium text-white hover:bg-red-600"
                  >
                    <Check size={11} />
                  </button>
                  <button
                    onClick={cancelConfirm}
                    title="取消"
                    className="rounded p-0.5 hover:bg-red-500/20"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-auto px-2 pb-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] text-zinc-600 transition hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
        >
          <SettingsIcon size={16} className="text-zinc-400" />
          设置
        </button>
      </div>
    </aside>
  )
}
