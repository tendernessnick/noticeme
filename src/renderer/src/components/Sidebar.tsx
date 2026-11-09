import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sun,
  CalendarDays,
  Layers,
  CheckCircle2,
  BookOpen,
  Settings as SettingsIcon,
  Plus,
  ListTodo,
  Pencil,
  Trash2,
  X,
  Check,
  FolderPlus,
  ChevronRight,
  ChevronDown
} from 'lucide-react'
import type { NoteFolder, Project } from '../../../shared/types'
import type { View } from '../store'
import { useStore } from '../store'
import { DEFAULT_NOTE_FOLDER_ID, PROJECT_PALETTE } from '../../../shared/defaults'
import { START_OF_TODAY } from '../utils/ui'

const NAV: Array<{ kind: View['kind']; label: string; icon: typeof Sun }> = [
  { kind: 'today', label: '今天', icon: Sun },
  { kind: 'upcoming', label: '即将到来', icon: CalendarDays },
  { kind: 'all', label: '全部', icon: Layers },
  { kind: 'done', label: '已完成', icon: CheckCircle2 },
  { kind: 'journal', label: '随心记', icon: BookOpen }
]

export default function Sidebar(): JSX.Element {
  const db = useStore(s => s.db)!
  const view = useStore(s => s.view)
  const setView = useStore(s => s.setView)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const addProject = useStore(s => s.addProject)
  const updateProject = useStore(s => s.updateProject)
  const deleteProject = useStore(s => s.deleteProject)
  const updater = useStore(s => s.updater)
  const addNoteFolder = useStore(s => s.addNoteFolder)
  const updateNoteFolder = useStore(s => s.updateNoteFolder)
  const deleteNoteFolder = useStore(s => s.deleteNoteFolder)
  const updateReady = updater?.phase === 'downloaded'
  const updateVersion = updater?.version ?? ''
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  /** 行内重命名状态 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  /** 两步删除确认状态（3 秒未确认自动复原） */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ---------- 笔记文件夹（树形） ----------
  const [addingFolder, setAddingFolder] = useState(false)
  /** 非空 = 正在该文件夹下新建子文件夹 */
  const [addingParentId, setAddingParentId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [confirmingFolderId, setConfirmingFolderId] = useState<string | null>(null)
  const folderConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 折叠的文件夹 id 集合（仅展开状态存于本地，不持久化） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      if (folderConfirmTimer.current) clearTimeout(folderConfirmTimer.current)
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
    done: db.tasks.filter(t => t.done).length,
    journal: db.entries.length
  }
  const projectCount = (pid: string): number =>
    active.filter(t => (t.projectId ?? 'inbox') === pid).length

  // ---------- 笔记文件夹树 ----------
  const folders = db.noteFolders
  /** parentId → 子文件夹（失效 parentId 视为根级；按创建时间排序） */
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, NoteFolder[]>()
    for (const f of folders) {
      const parent = f.parentId && folders.some(x => x.id === f.parentId) ? f.parentId : null
      if (!map.has(parent)) map.set(parent, [])
      map.get(parent)!.push(f)
    }
    for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return map
  }, [folders])
  const noteCount = (fid: string): number => db.notes.filter(n => n.folderId === fid).length

  const toggleCollapse = (id: string): void => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submitFolder = async (parentId: string | null): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) {
      setAddingFolder(false)
      setAddingParentId(null)
      return
    }
    const color = PROJECT_PALETTE[folders.length % PROJECT_PALETTE.length]
    const id = await addNoteFolder(name, color, parentId)
    setNewFolderName('')
    setAddingFolder(false)
    setAddingParentId(null)
    setView({ kind: 'noteFolder', folderId: id })
  }

  const saveFolderRename = async (f: NoteFolder): Promise<void> => {
    const name = editFolderName.trim()
    if (name && name !== f.name) await updateNoteFolder({ ...f, name })
    setEditingFolderId(null)
  }

  const startFolderRename = (f: NoteFolder): void => {
    setConfirmingFolderId(null)
    setEditingFolderId(f.id)
    setEditFolderName(f.name)
  }

  const startFolderConfirm = (id: string): void => {
    setConfirmingFolderId(id)
    if (folderConfirmTimer.current) clearTimeout(folderConfirmTimer.current)
    folderConfirmTimer.current = setTimeout(() => setConfirmingFolderId(null), 3000)
  }

  const cancelFolderConfirm = (): void => {
    if (folderConfirmTimer.current) clearTimeout(folderConfirmTimer.current)
    setConfirmingFolderId(null)
  }

  const doDeleteFolder = async (id: string): Promise<void> => {
    cancelFolderConfirm()
    await deleteNoteFolder(id)
    if (view.kind === 'noteFolder' && view.folderId === id) setView({ kind: 'today' })
  }

  /** 递归渲染一个文件夹行（含确认条、子级新建输入框、子树） */
  const renderFolder = (folder: NoteFolder, depth: number): JSX.Element => {
    const kids = childrenOf.get(folder.id) ?? []
    const isCollapsed = collapsed.has(folder.id)
    const isActive = view.kind === 'noteFolder' && view.folderId === folder.id
    const isEditing = editingFolderId === folder.id
    const isConfirming = confirmingFolderId === folder.id
    const isDefault = folder.id === DEFAULT_NOTE_FOLDER_ID
    const rowPad = { paddingLeft: 10 + depth * 14 }
    if (isEditing) {
      return (
        <div key={folder.id} className="mb-1 pr-2" style={rowPad}>
          <input
            autoFocus
            value={editFolderName}
            onChange={e => setEditFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void saveFolderRename(folder)
              if (e.key === 'Escape') setEditingFolderId(null)
            }}
            onBlur={() => void saveFolderRename(folder)}
            className="w-full rounded-lg border border-accent/50 bg-white px-2.5 py-1 text-[13px] outline-none ring-2 ring-accent/15 dark:bg-zinc-800"
          />
        </div>
      )
    }
    return (
      <div key={folder.id}>
        <div
          data-folder-id={folder.id}
          onClick={() => setView({ kind: 'noteFolder', folderId: folder.id })}
          style={rowPad}
          className={`group mb-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-[13px] transition ${
            isActive
              ? 'bg-accent/10 font-semibold text-accent dark:bg-accent/20'
              : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70'
          }`}
        >
          {kids.length > 0 ? (
            <button
              onClick={e => {
                e.stopPropagation()
                toggleCollapse(folder.id)
              }}
              title={isCollapsed ? '展开' : '折叠'}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="w-[17px] shrink-0" />
          )}
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: folder.color }} />
          <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
          {/* 悬停操作（默认文件夹不可改删） */}
          {!isDefault && (
            <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <button
                onClick={e => {
                  e.stopPropagation()
                  setAddingFolder(false)
                  setNewFolderName('')
                  setAddingParentId(folder.id)
                }}
                title="新建子文件夹"
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                <FolderPlus size={12} />
              </button>
              <button
                onClick={e => {
                  e.stopPropagation()
                  startFolderRename(folder)
                }}
                title="重命名"
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={e => {
                  e.stopPropagation()
                  startFolderConfirm(folder.id)
                }}
                title="删除文件夹（笔记移入默认）"
                className="rounded p-0.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </span>
          )}
          <span
            className={`shrink-0 text-[11px] tabular-nums text-zinc-400 ${!isDefault ? 'group-hover:hidden' : ''}`}
          >
            {noteCount(folder.id) > 0 ? noteCount(folder.id) : ''}
          </span>
        </div>
        {isConfirming && (
          <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1 text-[11px] text-red-500 animate-fadeIn">
            <span className="flex-1 truncate">删除文件夹？笔记移入默认</span>
            <button
              onClick={() => void doDeleteFolder(folder.id)}
              className="rounded bg-red-500 px-1.5 py-0.5 font-medium text-white hover:bg-red-600"
            >
              <Check size={11} />
            </button>
            <button onClick={cancelFolderConfirm} title="取消" className="rounded p-0.5 hover:bg-red-500/20">
              <X size={12} />
            </button>
          </div>
        )}
        {addingParentId === folder.id && (
          <div className="mb-1 pr-2" style={{ paddingLeft: 10 + (depth + 1) * 14 }}>
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void submitFolder(folder.id)
                if (e.key === 'Escape') {
                  setAddingParentId(null)
                  setNewFolderName('')
                }
              }}
              onBlur={() => void submitFolder(folder.id)}
              placeholder="子文件夹名称，回车保存"
              className="w-full rounded-lg border border-accent/50 bg-white px-2.5 py-1 text-[13px] outline-none ring-2 ring-accent/15 dark:bg-zinc-800"
            />
          </div>
        )}
        {!isCollapsed && kids.map(k => renderFolder(k, depth + 1))}
      </div>
    )
  }

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

      {/* 笔记文件夹 */}
      <div className="mt-4 flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">笔记</span>
        <button
          onClick={() => {
            setAddingParentId(null)
            setNewFolderName('')
            setAddingFolder(true)
          }}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-200/70 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="新建文件夹"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="px-2">
        {addingFolder && (
          <div className="mb-1 px-1">
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void submitFolder(null)
                if (e.key === 'Escape') {
                  setAddingFolder(false)
                  setNewFolderName('')
                }
              }}
              onBlur={() => void submitFolder(null)}
              placeholder="文件夹名称，回车保存"
              className="w-full rounded-lg border border-accent/50 bg-white px-2.5 py-1 text-[13px] outline-none ring-2 ring-accent/15 dark:bg-zinc-800"
            />
          </div>
        )}
        {(childrenOf.get(null) ?? []).map(f => renderFolder(f, 0))}
      </div>

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
          className="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] text-zinc-600 transition hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
        >
          <SettingsIcon size={16} className="text-zinc-400" />
          设置
          {updateReady && (
            <span
              className="absolute right-3 h-1.5 w-1.5 rounded-full bg-emerald-500"
              title={`新版本 v${updateVersion} 已就绪，重启后自动安装`}
            />
          )}
        </button>
      </div>
    </aside>
  )
}
