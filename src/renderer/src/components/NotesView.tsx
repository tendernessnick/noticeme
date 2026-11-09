// 笔记模块：左侧文件夹内笔记列表 + 右侧编辑器（文件夹树形下拉可移动；不带 AI）
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, NotebookPen, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import type { Note, NoteFolder } from '../../../shared/types'
import { DEFAULT_NOTE_FOLDER_ID, newNote } from '../../../shared/defaults'
import { useStore } from '../store'

/** 更新时间标签：今天 / 昨天 / M月D日（跨年带年份） */
function updatedLabel(updatedAt: string, now: Date): string {
  const d = new Date(updatedAt)
  if (Number.isNaN(d.getTime())) return ''
  const dayMs = 86400000
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - base) / dayMs)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  const sameYear = d.getFullYear() === now.getFullYear()
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日`
}

function previewOf(n: Note): string {
  const firstLine = n.content.split('\n').find(l => l.trim()) ?? ''
  return n.title || firstLine.trim().slice(0, 40) || '（无标题）'
}

export default function NotesView(): JSX.Element {
  const db = useStore(s => s.db)!
  const view = useStore(s => s.view)
  const upsert = useStore(s => s.upsertNote)
  const remove = useStore(s => s.deleteNote)
  const folderId = view.kind === 'noteFolder' ? view.folderId ?? DEFAULT_NOTE_FOLDER_ID : DEFAULT_NOTE_FOLDER_ID
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const folders = db.noteFolders

  // 当前文件夹直属笔记：置顶优先，其余按更新时间倒序
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = db.notes.filter(n => {
      if (n.folderId !== folderId) return false
      if (!q) return true
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some(t => t.toLowerCase().includes(q))
      )
    })
    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [db.notes, folderId, search])

  // 文件夹下拉选项：树形深度优先，全角空格缩进体现层级
  const folderOptions = useMemo(() => {
    const map = new Map<string | null, NoteFolder[]>()
    for (const f of folders) {
      const parent = f.parentId && folders.some(x => x.id === f.parentId) ? f.parentId : null
      if (!map.has(parent)) map.set(parent, [])
      map.get(parent)!.push(f)
    }
    for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const out: Array<{ id: string; label: string }> = []
    const walk = (parent: string | null, depth: number): void => {
      for (const f of map.get(parent) ?? []) {
        out.push({ id: f.id, label: '　'.repeat(depth) + f.name })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [folders])

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  // 切换文件夹时清空选择与搜索
  useEffect(() => {
    setSelectedId(null)
    setSearch('')
  }, [folderId])

  const selected: Note | null = selectedId ? db.notes.find(n => n.id === selectedId) ?? null : null

  const createNote = async (): Promise<void> => {
    const note = newNote({ folderId })
    await upsert(note)
    setSelectedId(note.id)
    setSearch('')
    window.setTimeout(() => contentRef.current?.focus(), 50)
  }

  // ---------- 编辑器草稿（自动保存，模式与随心记一致） ----------
  const [draft, setDraft] = useState<Note | null>(selected)
  const [tagText, setTagText] = useState(selected?.tags.join(', ') ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(selected)
    setTagText(selected?.tags.join(', ') ?? '')
    setConfirmDelete(false)
  }, [selected?.id, selected?.updatedAt])

  const save = (patch: Partial<Note>): void => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    void upsert(next)
  }

  const saveDebounced = (patch: Partial<Note>): void => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void upsert(next), 450)
  }

  const commitTags = (): void => {
    const tags = tagText
      .split(/[,，\s]+/)
      .map(s => s.replace(/^#/, '').trim())
      .filter(Boolean)
    save({ tags })
  }

  const doDelete = async (): Promise<void> => {
    if (!draft) return
    const id = draft.id
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmDelete(false)
    await remove(id)
    if (selectedId === id) setSelectedId(null)
  }

  const startConfirmDelete = (): void => {
    setConfirmDelete(true)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000)
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左侧：列表 */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-zinc-200/70 dark:border-zinc-800/80">
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索笔记…"
              className="input !py-1.5 pl-8 text-[13px]"
            />
          </div>
          <button onClick={() => void createNote()} className="btn-primary !px-2.5 !py-1.5" title="新建笔记">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fadeIn">
              <NotebookPen size={30} className="mb-2.5 text-zinc-300 dark:text-zinc-700" />
              <p className="text-[13px] text-zinc-400">
                {search.trim() ? '没有匹配的笔记' : '还没有笔记，点右上角 + 开始记录'}
              </p>
            </div>
          )}
          <div className="space-y-1">
            {filtered.map(n => {
              const isActive = selectedId === n.id
              return (
                <div
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={`cursor-pointer rounded-xl border px-3 py-2 transition ${
                    isActive
                      ? 'border-accent/50 bg-accent/10 dark:bg-accent/20'
                      : 'border-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {n.pinned && <Pin size={11} className="shrink-0 text-accent" />}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{previewOf(n)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <span>更新于 {updatedLabel(n.updatedAt, new Date())}</span>
                    {n.tags.slice(0, 2).map(t => (
                      <span key={t} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800 dark:text-zinc-400">
                        #{t}
                      </span>
                    ))}
                    {n.tags.length > 2 && <span>+{n.tags.length - 2}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      {/* 右侧：编辑器 */}
      {draft ? (
        <section className="flex min-w-0 flex-1 flex-col">
          {/* 头部：所属文件夹 / 操作 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              文件夹
              <select
                value={draft.folderId}
                onChange={e => save({ folderId: e.target.value })}
                className="input !w-auto !py-1 text-[12px]"
              >
                {folderOptions.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => save({ pinned: !draft.pinned })}
                className={`btn !px-2 !py-1 text-xs ${
                  draft.pinned
                    ? 'bg-accent/10 text-accent'
                    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                }`}
                title={draft.pinned ? '取消置顶' : '置顶'}
              >
                {draft.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                {draft.pinned ? '已置顶' : '置顶'}
              </button>
              {confirmDelete ? (
                <span className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-500 animate-fadeIn">
                  确认删除？
                  <button onClick={() => void doDelete()} className="rounded bg-red-500 px-1.5 py-0.5 text-white hover:bg-red-600">
                    <Check size={11} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded p-0.5 hover:bg-red-500/20"
                    title="取消"
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={startConfirmDelete}
                  className="btn !px-2 !py-1 text-xs text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
                  title="删除笔记"
                >
                  <Trash2 size={13} /> 删除
                </button>
              )}
            </div>
          </div>

          {/* 标题 */}
          <input
            value={draft.title}
            onChange={e => saveDebounced({ title: e.target.value })}
            placeholder="标题（可留空）"
            className="bg-transparent px-5 pt-4 text-lg font-semibold outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
          />

          {/* 标签 */}
          <div className="flex items-center gap-2 px-5 pt-2">
            <span className="text-[11px] text-zinc-400">标签</span>
            <input
              value={tagText}
              onChange={e => setTagText(e.target.value)}
              onBlur={commitTags}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTags()
              }}
              placeholder="资料, 灵感（逗号分隔）"
              className="w-64 bg-transparent text-[12px] outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
            />
            {draft.pinned && (
              <span className="chip bg-accent/10 text-accent">
                <Pin size={10} /> 置顶
              </span>
            )}
          </div>

          {/* 正文 */}
          <textarea
            ref={contentRef}
            value={draft.content}
            onChange={e => saveDebounced({ content: e.target.value })}
            placeholder={'写点什么…资料、想法、清单都可以'}
            className="flex-1 resize-none bg-transparent px-5 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
          />

          <div className="border-t border-zinc-100 px-5 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
            更新于 {updatedLabel(draft.updatedAt, new Date())} · 自动保存 · 创建于 {draft.createdAt.slice(0, 10)}
            {draft.pinned && ' · 置顶中'}
          </div>
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 text-accent">
            <NotebookPen size={28} />
          </div>
          <h2 className="text-lg font-semibold">记录资料与想法</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">
            用文件夹整理你的笔记，随时补充、随时翻阅。
            <br />
            点左上角 <span className="text-accent">+</span> 开始第一条。
          </p>
        </section>
      )}
    </div>
  )
}
