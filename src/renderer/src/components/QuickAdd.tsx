import { useEffect, useRef, useState } from 'react'
import { Plus, CalendarClock, Flag, Hash, AtSign } from 'lucide-react'
import { parseQuickAdd, type ParsedQuickAdd } from '../../../shared/parse'
import { newTask, uid, PROJECT_PALETTE } from '../../../shared/defaults'
import { formatDueLabel } from '../../../shared/datetime'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../utils/ui'
import { useStore } from '../store'

export default function QuickAdd(): JSX.Element {
  const db = useStore(s => s.db)!
  const upsertTask = useStore(s => s.upsertTask)
  const addProject = useStore(s => s.addProject)
  const view = useStore(s => s.view)
  const quickAddToken = useStore(s => s.quickAddToken)
  const [text, setText] = useState('')
  const [hint, setHint] = useState<ParsedQuickAdd | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (quickAddToken > 0) inputRef.current?.focus()
  }, [quickAddToken])

  useEffect(() => {
    const t = setTimeout(() => {
      setHint(text.trim() ? parseQuickAdd(text) : null)
    }, 120)
    return () => clearTimeout(t)
  }, [text])

  const submit = async (): Promise<void> => {
    const raw = text.trim()
    if (!raw) return
    const parsed = parseQuickAdd(raw)
    let projectId: string | null = null
    if (view.kind === 'project') projectId = view.projectId ?? 'inbox'
    if (parsed.projectName) {
      const found = db.projects.find(
        p => p.name.toLowerCase() === parsed.projectName!.toLowerCase()
      )
      projectId = found
        ? found.id
        : await addProject(parsed.projectName, PROJECT_PALETTE[db.projects.length % PROJECT_PALETTE.length])
    }
    const task = newTask({
      title: parsed.title,
      priority: parsed.priority ?? 3,
      dueAt: parsed.dueAt,
      tags: parsed.tags,
      projectId
    })
    // PRD 决策：有截止时间即默认准时提醒
    if (parsed.dueAt) task.reminders = [{ id: uid(), offsetMin: null }]
    await upsertTask(task)
    setText('')
    setHint(null)
    inputRef.current?.focus()
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 shadow-soft transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15 dark:border-zinc-800 dark:bg-zinc-900">
        <Plus size={16} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') {
              setText('')
              setHint(null)
              inputRef.current?.blur()
            }
          }}
          placeholder="添加任务：明天 9 点 写周报 p1 #工作 @电脑"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
        <span className="shrink-0 text-[11px] text-zinc-300 dark:text-zinc-600">Enter 添加</span>
      </div>

      {hint && (hint.dueAt || hint.priority || hint.projectName || hint.tags.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 animate-fadeIn">
          {hint.dueAt && (
            <span className="chip bg-accent/10 text-accent">
              <CalendarClock size={11} />
              {formatDueLabel(hint.dueAt)}
            </span>
          )}
          {hint.priority && (
            <span className="chip bg-zinc-100 dark:bg-zinc-800" style={{ color: PRIORITY_COLORS[hint.priority] }}>
              <Flag size={11} />
              {PRIORITY_LABELS[hint.priority]}
            </span>
          )}
          {hint.projectName && (
            <span className="chip bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <Hash size={11} />
              {hint.projectName}
            </span>
          )}
          {hint.tags.map(tg => (
            <span key={tg} className="chip bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <AtSign size={11} />
              {tg}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
