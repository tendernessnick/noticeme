import { useEffect, useRef, useState } from 'react'
import { X, CalendarClock, BellRing, Repeat as RepeatIcon, Flag, FolderKanban, Trash2, Tags, StickyNote } from 'lucide-react'
import type { Priority, RepeatRule, Reminder, Task } from '../../../shared/types'
import { uid } from '../../../shared/defaults'
import {
  toLocalInputValue,
  fromLocalInputValue,
  formatReminderOffset,
  formatDateTimeCn,
  addDays,
  startOfDay
} from '../../../shared/datetime'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../utils/ui'
import { useStore } from '../store'

const REMINDER_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: '准时', value: null },
  { label: '提前 5 分钟', value: 5 },
  { label: '提前 10 分钟', value: 10 },
  { label: '提前 15 分钟', value: 15 },
  { label: '提前 30 分钟', value: 30 },
  { label: '提前 1 小时', value: 60 },
  { label: '提前 1 天', value: 1440 }
]

const REPEAT_OPTIONS: Array<{ label: string; value: RepeatRule | null }> = [
  { label: '不重复', value: null },
  { label: '每天', value: { freq: 'daily' } },
  { label: '每个工作日', value: { freq: 'weekdays' } },
  { label: '每周', value: { freq: 'weekly' } },
  { label: '每月', value: { freq: 'monthly' } },
  { label: '每年', value: { freq: 'yearly' } }
]

function sameRule(a: RepeatRule | null, b: RepeatRule | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.freq === b.freq && (a.interval ?? 1) === (b.interval ?? 1)
}

export default function TaskDetail({ task }: { task: Task }): JSX.Element {
  const db = useStore(s => s.db)!
  const upsertTask = useStore(s => s.upsertTask)
  const deleteTask = useStore(s => s.deleteTask)
  const selectTask = useStore(s => s.selectTask)
  const [draft, setDraft] = useState<Task>(task)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tagText, setTagText] = useState(task.tags.join(', '))

  useEffect(() => {
    setDraft(task)
    setTagText(task.tags.join(', '))
  }, [task.id, task.updatedAt])

  // Esc 关闭抽屉
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useStore.getState().selectTask(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  /** 离散修改立即保存 */
  const save = (patch: Partial<Task>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    void upsertTask(next)
  }

  /** 文本输入防抖保存 */
  const saveDebounced = (patch: Partial<Task>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void upsertTask(next), 450)
  }

  const setDue = (iso: string | null): void => {
    save({ dueAt: iso })
  }

  const quickDate = (dayOffset: number, hour: number): void => {
    const d = addDays(startOfDay(new Date()), dayOffset)
    d.setHours(hour, 0, 0, 0)
    setDue(d.toISOString())
  }

  const addReminder = (value: number | null): void => {
    if (!draft.dueAt) return
    if (draft.reminders.some(r => r.offsetMin === value)) return
    const r: Reminder = { id: uid(), offsetMin: value }
    save({ reminders: [...draft.reminders, r] })
  }

  const applyRepeat = (freq: RepeatRule | null): void => {
    save({ repeat: freq })
  }

  const commitTags = (): void => {
    const tags = tagText
      .split(/[,，\s]+/)
      .map(s => s.replace(/^@/, '').trim())
      .filter(Boolean)
    save({ tags })
  }

  const labelCls = 'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 animate-fadeIn" onClick={() => selectTask(null)} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[400px] animate-slideInRight flex-col border-l border-zinc-200 bg-white shadow-pop dark:border-zinc-800 dark:bg-zinc-900">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <span className="text-[11px] text-zinc-400">任务详情</span>
          <button onClick={() => selectTask(null)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 标题 */}
          <input
            value={draft.title}
            onChange={e => saveDebounced({ title: e.target.value })}
            className={`w-full bg-transparent text-lg font-semibold outline-none ${draft.done ? 'text-zinc-400 line-through' : ''}`}
          />

          {/* 完成 */}
          <button
            onClick={() => void useStore.getState().setDone(task.id, !task.done)}
            className={`btn w-full ${draft.done ? 'btn-ghost' : 'btn-primary'}`}
          >
            {draft.done ? '标记为未完成' : '完成任务'}
          </button>

          {/* 截止时间 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <CalendarClock size={12} /> 截止时间
            </div>
            <input
              type="datetime-local"
              value={draft.dueAt ? toLocalInputValue(draft.dueAt) : ''}
              onChange={e => setDue(fromLocalInputValue(e.target.value))}
              className="input"
            />
            <div className="flex flex-wrap gap-1.5">
              <button className="chip cursor-pointer bg-zinc-100 text-zinc-500 hover:bg-accent/10 hover:text-accent dark:bg-zinc-800 dark:text-zinc-300" onClick={() => quickDate(0, 9)}>今天 9 点</button>
              <button className="chip cursor-pointer bg-zinc-100 text-zinc-500 hover:bg-accent/10 hover:text-accent dark:bg-zinc-800 dark:text-zinc-300" onClick={() => quickDate(0, 20)}>今天 20 点</button>
              <button className="chip cursor-pointer bg-zinc-100 text-zinc-500 hover:bg-accent/10 hover:text-accent dark:bg-zinc-800 dark:text-zinc-300" onClick={() => quickDate(1, 9)}>明天 9 点</button>
              <button className="chip cursor-pointer bg-zinc-100 text-zinc-500 hover:bg-accent/10 hover:text-accent dark:bg-zinc-800 dark:text-zinc-300" onClick={() => setDue(null)}>清除</button>
            </div>
          </div>

          {/* 提醒 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <BellRing size={12} /> 提醒
            </div>
            {!draft.dueAt && <p className="text-xs text-zinc-400">设置截止时间后可添加提醒</p>}
            {draft.dueAt && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {draft.reminders.map(r => (
                    <span key={r.id} className="chip bg-accent/10 text-accent">
                      {formatReminderOffset(r.offsetMin)}
                      <button
                        onClick={() => save({ reminders: draft.reminders.filter(x => x.id !== r.id) })}
                        className="ml-0.5 rounded p-[1px] hover:bg-accent/20"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {draft.reminders.length === 0 && <span className="text-xs text-zinc-400">暂无提醒</span>}
                </div>
                <select
                  value=""
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') return
                    addReminder(v === 'ontime' ? null : Number(v))
                    e.target.value = ''
                  }}
                  className="input cursor-pointer"
                >
                  <option value="">+ 添加提醒…</option>
                  {REMINDER_PRESETS.map(p => (
                    <option key={p.label} value={p.value === null ? 'ontime' : p.value} disabled={draft.reminders.some(r => r.offsetMin === p.value)}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* 重复 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <RepeatIcon size={12} /> 重复
            </div>
            <select
              value={draft.repeat?.freq ?? 'none'}
              onChange={e => {
                const found = REPEAT_OPTIONS.find(o => o.value?.freq === e.target.value || (e.target.value === 'none' && o.value === null))
                applyRepeat(found ? found.value : null)
              }}
              className="input cursor-pointer"
            >
              {REPEAT_OPTIONS.map(o => (
                <option key={o.label} value={o.value?.freq ?? 'none'}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* 优先级 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <Flag size={12} /> 优先级
            </div>
            <div className="flex gap-1.5">
              {([1, 2, 3, 4] as Priority[]).map(p => (
                <button
                  key={p}
                  onClick={() => save({ priority: p })}
                  className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-medium transition ${
                    draft.priority === p
                      ? 'border-transparent text-white'
                      : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'
                  }`}
                  style={draft.priority === p ? { background: PRIORITY_COLORS[p] } : undefined}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* 项目 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <FolderKanban size={12} /> 清单
            </div>
            <select
              value={draft.projectId ?? 'inbox'}
              onChange={e => save({ projectId: e.target.value === 'inbox' ? null : e.target.value })}
              className="input cursor-pointer"
            >
              {db.projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 标签 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <Tags size={12} /> 标签（逗号分隔）
            </div>
            <input
              value={tagText}
              onChange={e => setTagText(e.target.value)}
              onBlur={commitTags}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTags()
              }}
              placeholder="工作, 电脑"
              className="input"
            />
          </div>

          {/* 备注 */}
          <div className="space-y-2">
            <div className={labelCls}>
              <StickyNote size={12} /> 备注
            </div>
            <textarea
              value={draft.notes ?? ''}
              onChange={e => saveDebounced({ notes: e.target.value })}
              rows={4}
              placeholder="补充说明…"
              className="input resize-none leading-relaxed"
            />
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <span className="text-[11px] text-zinc-400">创建于 {formatDateTimeCn(draft.createdAt)}</span>
          <button
            onClick={() => void deleteTask(task.id)}
            className="btn-danger !px-2.5 !py-1.5 text-xs"
          >
            <Trash2 size={13} /> 删除任务
          </button>
        </div>
      </div>
    </>
  )
}
