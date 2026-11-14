// 日记/随笔模块：左侧按月分组列表 + 右侧全高编辑器
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, CalendarClock, Check, Copy, ListTodo, Loader2, Pencil, Pin, PinOff, Plus, Search, Sparkles, Trash2, X
} from 'lucide-react'
import type { JournalEntry } from '../../../shared/types'
import type { TaskDraft } from '../../../shared/ai-schema'
import { newJournalEntry, newTask, uid } from '../../../shared/defaults'
import { formatDueLabel } from '../../../shared/datetime'
import { useAiProgress } from '../utils/aiProgress'
import { useStore } from '../store'
import { useAutosave } from '../utils/useAutosave'
import SaveStatus from './SaveStatus'

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
  const upsertTask = useStore(s => s.upsertTask)
  const aiStatus = useStore(s => s.aiStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  // ---------- 本地 AI：周回顾 / 日记待办提取 ----------
  const [review, setReview] = useState<{
    open: boolean
    phase: 'running' | 'done' | 'error'
    text: string
    ms: number
    error: string
    saved: boolean
  }>({ open: false, phase: 'running', text: '', ms: 0, error: '', saved: false })
  const [todoSuggest, setTodoSuggest] = useState<{
    phase: 'idle' | 'running' | 'ready' | 'error'
    drafts: TaskDraft[]
    added: number[]
    error: string
  }>({ phase: 'idle', drafts: [], added: [], error: '' })

  const aiReady = !!aiStatus && aiStatus.enabled && aiStatus.modelAvailable
  const reviewProgress = useAiProgress(review.open && review.phase === 'running')
  const todoProgress = useAiProgress(todoSuggest.phase === 'running')

  const openReview = (): void => {
    setReview({ open: true, phase: 'running', text: '', ms: 0, error: '', saved: false })
    const now = new Date()
    const cutoff = new Date(now.getTime() - 7 * 86400_000)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const entries = db.entries
      .filter(e => e.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-24)
      .map(e => ({ date: e.date, mood: e.mood, content: e.content.slice(0, 400) }))
    const doneTaskTitles = db.tasks
      .filter(t => t.done && t.completedAt && t.completedAt >= cutoff.toISOString())
      .slice(-12)
      .map(t => t.title)
    const pendingTitles = db.tasks
      .filter(t => !t.done && t.dueAt && t.dueAt < now.toISOString())
      .slice(0, 5)
      .map(t => t.title)
    window.noticeme
      .aiWeeklyReview({
        sinceISO: cutoff.toISOString(),
        untilISO: now.toISOString(),
        entries,
        doneTaskTitles,
        pendingTitles
      })
      .then(r => setReview(p => (p.open ? { ...p, phase: 'done', text: r.text, ms: r.ms } : p)))
      .catch(e =>
        setReview(p =>
          p.open ? { ...p, phase: 'error', error: e instanceof Error ? e.message : String(e) } : p
        )
      )
  }

  const saveReviewAsJournal = async (): Promise<void> => {
    if (review.phase !== 'done' || !review.text) return
    const now = new Date()
    const entry = newJournalEntry({
      title: `周回顾 ${now.getMonth() + 1}月${now.getDate()}日`,
      content: review.text,
      tags: ['周回顾'],
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    })
    await upsert(entry)
    setReview(p => ({ ...p, saved: true }))
    setSelectedId(entry.id)
  }

  const startTodoExtract = (): void => {
    if (!draft?.content.trim()) return
    setTodoSuggest({ phase: 'running', drafts: [], added: [], error: '' })
    window.noticeme
      .aiJournalTodos(draft.content)
      .then(r => setTodoSuggest({ phase: 'ready', drafts: r.drafts, added: [], error: '' }))
      .catch(e =>
        setTodoSuggest({
          phase: 'error',
          drafts: [],
          added: [],
          error: e instanceof Error ? e.message : String(e)
        })
      )
  }

  const addTodoDraft = async (index: number): Promise<void> => {
    const d = todoSuggest.drafts[index]
    if (!d) return
    const task = newTask({
      title: d.title,
      priority: d.priority ?? 3,
      dueAt: d.dueAt,
      tags: d.tags,
      projectId: null
    })
    if (d.dueAt) task.reminders = [{ id: uid(), offsetMin: null }]
    await upsertTask(task)
    setTodoSuggest(p => ({ ...p, added: [...p.added, index] }))
  }

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
  const autosave = useAutosave('journal', selected, (id, patch) => window.noticeme.patchJournal(id, patch))
  const { draft, save, saveDebounced } = autosave
  const [tagText, setTagText] = useState(selected?.tags.join(', ') ?? '')

  useEffect(() => {
    setTagText(draft?.tags.join(', ') ?? '')
    setConfirmDelete(false)
  }, [selected?.id])

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
    await autosave.discard()
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
              placeholder="搜索随心记…"
              className="input !py-1.5 pl-8 text-[13px]"
            />
          </div>
          <button
            onClick={openReview}
            className="btn !px-2 !py-1.5 text-zinc-400 hover:bg-accent/10 hover:text-accent"
            title="生成本周回顾（本地 AI）"
          >
            <Sparkles size={14} />
          </button>
          <button onClick={() => void createEntry()} className="btn-primary !px-2.5 !py-1.5" title="新建随心记">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fadeIn">
              <BookOpen size={30} className="mb-2.5 text-zinc-300 dark:text-zinc-700" />
              <p className="text-[13px] text-zinc-400">
                {search.trim() ? '没有匹配的随心记' : '还没有随心记，点右上角 + 开始记录'}
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
                    <button
                      type="button"
                      key={e.id}
                      data-entry-id={e.id}
                      aria-pressed={isActive}
                      onClick={() => setSelectedId(e.id)}
                      className={`w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition ${
                        isActive
                          ? 'border-accent/50 bg-accent/10 dark:bg-accent/20'
                          : 'border-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {e.pinned && <Pin size={11} className="shrink-0 text-accent" />}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {previewOf(e)}
                        </span>
                        {e.mood && <span className="shrink-0 text-[13px]">{e.mood}</span>}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <span>{entryDateLabel(e.date, new Date())}</span>
                        {e.tags.slice(0, 2).map(t => (
                          <span key={t} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800 dark:text-zinc-400">
                            #{t}
                          </span>
                        ))}
                        {e.tags.length > 2 && <span>+{e.tags.length - 2}</span>}
                      </span>
                    </button>
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
                onClick={startTodoExtract}
                disabled={!aiReady || !draft.content.trim() || todoSuggest.phase === 'running'}
                className={`btn !px-2 !py-1 text-xs ${
                  todoSuggest.phase === 'running'
                    ? 'text-accent'
                    : 'text-zinc-400 hover:bg-accent/10 hover:text-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400'
                }`}
                title={!aiReady ? '需在设置中启用本地 AI 并下载模型' : '从这篇随心记提取待办（本地 AI）'}
              >
                {todoSuggest.phase === 'running' ? <Loader2 size={13} className="animate-spin" /> : <ListTodo size={13} />}
                {todoSuggest.phase === 'running' ? `生成中 ${todoProgress.elapsed}s` : '提取待办'}
              </button>
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
                  <button aria-label="确认删除" onClick={() => void doDelete()} className="rounded bg-red-500 px-1.5 py-0.5 text-white hover:bg-red-600">
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
                  title="删除随心记"
                >
                  <Trash2 size={13} /> 删除
                </button>
              )}
            </div>
          </div>

          {/* 标题 */}
          <input
            aria-label="随心记标题"
            value={draft.title}
            onChange={e => saveDebounced({ title: e.target.value })}
            onBlur={() => void autosave.flush()}
            placeholder="标题（可留空）"
            className="bg-transparent px-5 pt-4 text-lg font-semibold outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
          />

          {/* 标签 */}
          <div className="flex items-center gap-2 px-5 pt-2">
            <span className="text-[11px] text-zinc-400">标签</span>
            <input
              value={tagText}
              onChange={e => {
                setTagText(e.target.value)
                saveDebounced({ tags: e.target.value.split(/[,，\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean) })
              }}
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

          {/* AI 待办提取建议 */}
          {todoSuggest.phase === 'error' && (
            <div className="mx-5 mt-1 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-500 animate-fadeIn">
              提取失败：{todoSuggest.error}
            </div>
          )}
          {todoSuggest.phase === 'ready' && (
            <div className="mx-5 mt-1 rounded-xl border border-zinc-200/80 bg-white p-2.5 shadow-soft animate-fadeIn dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-1.5 flex items-center justify-between px-0.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  <ListTodo size={12} />
                  {todoSuggest.drafts.length > 0 ? `提取到 ${todoSuggest.drafts.length} 条待办` : '这篇随心记里没有明确的待办'}
                </span>
                <button onClick={() => setTodoSuggest({ phase: 'idle', drafts: [], added: [], error: '' })} className="text-zinc-400 hover:text-accent">
                  <X size={12} />
                </button>
              </div>
              {todoSuggest.drafts.map((d, i) => {
                const added = todoSuggest.added.includes(i)
                return (
                  <div key={`${d.title}-${i}`} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/50">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{d.title}</span>
                    {d.dueAt && (
                      <span className="chip shrink-0 bg-accent/10 text-accent">
                        <CalendarClock size={10} />
                        {formatDueLabel(d.dueAt)}
                      </span>
                    )}
                    <button
                      onClick={() => void addTodoDraft(i)}
                      disabled={added}
                      className={`btn shrink-0 !px-2 !py-0.5 text-[11px] ${
                        added ? 'text-emerald-500' : 'text-zinc-400 hover:bg-accent/10 hover:text-accent'
                      }`}
                    >
                      {added ? <><Check size={11} /> 已添加</> : '添加为任务'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* 正文 */}
          <textarea
            aria-label="日记正文"
            ref={contentRef}
            value={draft.content}
            onChange={e => saveDebounced({ content: e.target.value })}
            onBlur={() => void autosave.flush()}
            placeholder={'随便写点什么…想法、记录、规划都可以'}
            className="flex-1 resize-none bg-transparent px-5 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
          />

          <div className="border-t border-zinc-100 px-5 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
            {entryDateLabel(draft.date, new Date())} · <SaveStatus state={autosave.state} error={autosave.error} retry={autosave.flush} /> · 创建于 {draft.createdAt.slice(0, 10)}
            {draft.pinned && ' · 置顶中'}
          </div>
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Pencil size={28} />
          </div>
          <h2 className="text-lg font-semibold">随心而记，别让想法溜走</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">
            记录今天的想法与心情，或者写下接下来的规划。
            <br />
            点左上角 <span className="text-accent">+</span> 开始第一篇。
          </p>
        </section>
      )}

      {/* 周回顾弹层 */}
      {review.open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6 animate-fadeIn"
          onClick={() => setReview(p => ({ ...p, open: false }))}
        >
          <div
            className="max-h-[80vh] w-[560px] overflow-y-auto rounded-card border border-zinc-200 bg-white p-6 shadow-pop animate-slideUp dark:border-zinc-800 dark:bg-zinc-900"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Sparkles size={17} className="text-accent" />
                本周回顾
              </h2>
              <button
                onClick={() => setReview(p => ({ ...p, open: false }))}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </div>
            {review.phase === 'running' && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Loader2 size={22} className="animate-spin text-accent" />
                <p className="text-[13px] text-zinc-400">
                  本地 AI 正在阅读你这一周的随心记与任务…
                  <br />
                  <span className="text-[11px] text-zinc-400/80">
                    已 {reviewProgress.elapsed}s{reviewProgress.chars > 0 ? ` · 已生成 ${reviewProgress.chars} 字` : ''}（推理时长取决于机器负载，通常 10~60 秒，请稍候）
                  </span>
                </p>
              </div>
            )}
            {review.phase === 'error' && (
              <div className="py-8 text-center text-[13px] text-red-500">生成失败：{review.error}</div>
            )}
            {review.phase === 'done' && (
              <>
                <div className="whitespace-pre-wrap rounded-xl bg-zinc-50 px-4 py-3 text-[13px] leading-relaxed dark:bg-zinc-800/50">
                  {review.text}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">生成耗时 {(review.ms / 1000).toFixed(1)}s</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => void navigator.clipboard.writeText(review.text)}
                      className="btn-ghost !px-2.5 !py-1 text-xs"
                    >
                      <Copy size={13} /> 复制
                    </button>
                    <button
                      onClick={() => void saveReviewAsJournal()}
                      disabled={review.saved}
                      className="btn-primary !px-3 !py-1 text-xs disabled:opacity-50"
                    >
                      {review.saved ? '已存入随心记' : '存为随心记'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
