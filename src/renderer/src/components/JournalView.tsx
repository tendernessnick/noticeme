// 日记/随笔模块：左侧按月分组列表 + 右侧全高编辑器
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import type { JournalEntry } from '../../../shared/types'
import { newJournalEntry } from '../../../shared/defaults'
import { useStore } from '../store'

const MOODS = ['😊', '🙂', '😐', '😞', '😠'] as const

function localTodayStr(): string {
  const n = new Date()
  const m = String(n.getMonth() + 1).padStart(2, '0')
  const d = String(n.getDate()).padStart(2, '0')
  return `${n.getFullYear()}-${m}-${d}`
}

/** 列表日期标签：今天 / 昨天 / M月D日（跨年带年份） */
function entryDateLabel(date: string, now: Date): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(y, m - 1, d)
  const dayMs = 86400000
  const diff = Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / dayMs)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  const sameYear = dt.getFullYear() === now.getFullYear()
  return `${sameYear ? '' : `${dt.getFullYear()}年`}${dt.getMonth() + 1}月${dt.getDate()}日`
}

function previewOf(e: JournalEntry): string {
  const firstLine = e.content.split('\n').find(l => l.trim()) ?? ''
  return e.title || firstLine.trim().slice(0, 40) || '（无标题）'
}

export default function JournalView(): JSX.Element {
  const db = useStore(s => s.db)!
  const upsert = useStore(s => s.upsertJournal)
  const remove = useStore(s => s.deleteJournal)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  const entries = db.entries
  const selected: JournalEntry | null = selectedId ? entries.find(e => e.id === selectedId) ?? null : null

  // 过滤 + 排序：置顶优先，其余按日期倒序（同日按更新时间倒序）
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = entries.filter(e => {
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
    })
    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const dd = b.date.localeCompare(a.date)
      if (dd !== 0) return dd
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [entries, search])

  // 按月分组（搜索时不分组，扁平展示）
  const groups = useMemo(() => {
    if (search.trim()) return [{ key: '__search', label: `搜索结果（${filtered.length}）`, items: filtered }]
    const map = new Map<string, JournalEntry[]>()
    for (const e of filtered) {
      const key = e.date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()].map(([key, items]) => {
      const [y, m] = key.split('-').map(Number)
      return { key, label: `${y}年${m}月`, items }
    })
  }, [filtered, search])

  const createEntry = async (): Promise<void> => {
    const entry = newJournalEntry()
    await upsert(entry)
    setSelectedId(entry.id)
    setSearch('')
    window.setTimeout(() => contentRef.current?.focus(), 50)
  }

  // ---------- 编辑器草稿（自动保存，模式与任务详情一致） ----------
  const [draft, setDraft] = useState<JournalEntry | null>(selected)
  const [tagText, setTagText] = useState(selected?.tags.join(', ') ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(selected)
    setTagText(selected?.tags.join(', ') ?? '')
    setConfirmDelete(false)
  }, [selected?.id, selected?.updatedAt])

  const save = (patch: Partial<JournalEntry>): void => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    void upsert(next)
  }

  const saveDebounced = (patch: Partial<JournalEntry>): void => {
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
              placeholder="搜索日记…"
              className="input !py-1.5 pl-8 text-[13px]"
            />
          </div>
          <button onClick={() => void createEntry()} className="btn-primary !px-2.5 !py-1.5" title="新建日记">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fadeIn">
              <BookOpen size={30} className="mb-2.5 text-zinc-300 dark:text-zinc-700" />
              <p className="text-[13px] text-zinc-400">
                {search.trim() ? '没有匹配的日记' : '还没有日记，点右上角 + 开始记录'}
              </p>
            </div>
          )}
          {groups.map(group => (
            <div key={group.key} className="mt-3">
              <h3 className="mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map(e => {
                  const isActive = selectedId === e.id
                  return (
                    <div
                      key={e.id}
                      onClick={() => setSelectedId(e.id)}
                      className={`cursor-pointer rounded-xl border px-3 py-2 transition ${
                        isActive
                          ? 'border-accent/50 bg-accent/10 dark:bg-accent/20'
                          : 'border-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {e.pinned && <Pin size={11} className="shrink-0 text-accent" />}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {previewOf(e)}
                        </span>
                        {e.mood && <span className="shrink-0 text-[13px]">{e.mood}</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <span>{entryDateLabel(e.date, new Date())}</span>
                        {e.tags.slice(0, 2).map(t => (
                          <span key={t} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800 dark:text-zinc-400">
                            #{t}
                          </span>
                        ))}
                        {e.tags.length > 2 && <span>+{e.tags.length - 2}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 右侧：编辑器 */}
      {draft ? (
        <section className="flex min-w-0 flex-1 flex-col">
          {/* 头部：日期 / 心情 / 操作 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
            <input
              type="date"
              value={draft.date}
              onChange={e => save({ date: e.target.value || localTodayStr() })}
              className="input !w-auto !py-1 text-[12px]"
            />
            <div className="flex items-center gap-0.5">
              {MOODS.map(m => (
                <button
                  key={m}
                  onClick={() => save({ mood: draft.mood === m ? '' : m })}
                  title={`心情：${m}`}
                  className={`rounded-lg px-1.5 py-0.5 text-[15px] transition ${
                    draft.mood === m ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
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
                  title="删除日记"
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
              placeholder="规划, 想法（逗号分隔）"
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
            placeholder={'随便写点什么…想法、记录、规划都可以'}
            className="flex-1 resize-none bg-transparent px-5 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
          />

          <div className="border-t border-zinc-100 px-5 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
            {entryDateLabel(draft.date, new Date())} · 自动保存 · 创建于 {draft.createdAt.slice(0, 10)}
            {draft.pinned && ' · 置顶中'}
          </div>
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Pencil size={28} />
          </div>
          <h2 className="text-lg font-semibold">随手记，别让想法溜走</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">
            记录今天的想法与心情，或者写下接下来的规划。
            <br />
            点左上角 <span className="text-accent">+</span> 开始第一篇。
          </p>
        </section>
      )}
    </div>
  )
}
