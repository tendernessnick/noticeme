// 视图分组与排序（渲染端）
import type { Database, Task, View } from '../../../shared/types'
import { startOfDay, isSameDay, addDays, WEEKDAYS_CN } from '../../../shared/datetime'

export interface Section {
  key: string
  label: string
  tasks: Task[]
  /** 已完成分组，可折叠 */
  collapsible?: boolean
}

function dueMs(t: Task): number {
  return t.dueAt ? new Date(t.dueAt).getTime() : Number.POSITIVE_INFINITY
}

export function sortTasks(a: Task, b: Task): number {
  if (a.done !== b.done) return a.done ? 1 : -1
  const p = a.priority - b.priority
  if (p !== 0) return p
  const dm = dueMs(a) - dueMs(b)
  if (!Number.isNaN(dm) && dm !== 0) return dm
  return a.order - b.order
}

function matchSearch(t: Task, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    t.title.toLowerCase().includes(needle) ||
    (t.notes ?? '').toLowerCase().includes(needle) ||
    t.tags.some(x => x.toLowerCase().includes(needle))
  )
}

function dayLabel(day: Date, now: Date): string {
  if (isSameDay(day, now)) return '今天'
  if (isSameDay(day, addDays(now, 1))) return '明天'
  const diff = Math.round((day.getTime() - startOfDay(now).getTime()) / 86400000)
  if (diff > 1 && diff <= 7) return WEEKDAYS_CN[day.getDay()]
  return `${day.getMonth() + 1}月${day.getDate()}日`
}

/** 通用分组：逾期 / 今天 / 明天 / 本周稍后 / 更晚 / 无日期 / 已完成 */
function groupDefault(tasks: Task[], now: Date): Section[] {
  const todayStart = startOfDay(now).getTime()
  const tomorrowStart = addDays(startOfDay(now), 1).getTime()
  const dayAfterStart = addDays(startOfDay(now), 2).getTime()
  const weekEnd = addDays(startOfDay(now), 7).getTime()
  const active = tasks.filter(t => !t.done)
  const done = tasks.filter(t => t.done)
  const g = (pred: (t: Task) => boolean): Task[] => active.filter(pred).sort(sortTasks)
  const secs: Section[] = []

  const overdue = g(t => !!t.dueAt && new Date(t.dueAt).getTime() < todayStart)
  const today = g(t => {
    if (!t.dueAt) return false
    const ms = new Date(t.dueAt).getTime()
    return ms >= todayStart && ms < tomorrowStart
  })
  const tomorrow = g(t => {
    if (!t.dueAt) return false
    const ms = new Date(t.dueAt).getTime()
    return ms >= tomorrowStart && ms < dayAfterStart
  })
  const future = g(t => {
    if (!t.dueAt) return false
    const ms = new Date(t.dueAt).getTime()
    return ms >= dayAfterStart && ms < weekEnd
  })
  const later = g(t => !!t.dueAt && new Date(t.dueAt).getTime() >= weekEnd)
  const noDate = g(t => !t.dueAt)

  if (overdue.length) secs.push({ key: 'overdue', label: `已逾期（${overdue.length}）`, tasks: overdue })
  if (today.length) secs.push({ key: 'today', label: `今天（${today.length}）`, tasks: today })
  if (tomorrow.length) secs.push({ key: 'tomorrow', label: `明天（${tomorrow.length}）`, tasks: tomorrow })
  if (future.length) secs.push({ key: 'future', label: '本周稍后', tasks: future })
  if (later.length) secs.push({ key: 'later', label: '更晚', tasks: later })
  if (noDate.length) secs.push({ key: 'nodate', label: '无日期', tasks: noDate })
  if (done.length)
    secs.push({ key: 'done', label: `已完成（${done.length}）`, tasks: [...done].sort(sortTasks), collapsible: true })
  return secs
}

export function taskSections(db: Database, view: View, search: string, showDone: boolean): Section[] {
  const now = new Date()
  if (search.trim()) {
    const scoped = taskSections(db, view, '', showDone).flatMap(s => s.tasks)
    const res = scoped.filter(t => matchSearch(t, search)).sort(sortTasks)
    return [{ key: 'search', label: `搜索结果（${res.length}）`, tasks: res }]
  }

  if (view.kind === 'done') {
    const done = db.tasks.filter(t => t.done).sort(sortTasks)
    return [{ key: 'done', label: `已完成（${done.length}）`, tasks: done }]
  }

  if (view.kind === 'today') {
    const todayStart = startOfDay(now).getTime()
    const tomorrowStart = addDays(startOfDay(now), 1).getTime()
    const inToday = db.tasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() < tomorrowStart)
    const overdue = inToday.filter(t => !t.done && new Date(t.dueAt!).getTime() < todayStart).sort(sortTasks)
    const today = inToday.filter(t => !t.done && new Date(t.dueAt!).getTime() >= todayStart).sort(sortTasks)
    const doneToday = db.tasks.filter(t => t.done && t.completedAt &&
      Date.parse(t.completedAt) >= todayStart && Date.parse(t.completedAt) < tomorrowStart)
      .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))
    const secs: Section[] = []
    if (overdue.length) secs.push({ key: 'overdue', label: `已逾期（${overdue.length}）`, tasks: overdue })
    secs.push({ key: 'today', label: `今天（${today.length}）`, tasks: today })
    if (doneToday.length)
      secs.push({ key: 'done', label: `已完成（${doneToday.length}）`, tasks: doneToday, collapsible: true })
    return secs
  }

  if (view.kind === 'upcoming') {
    const todayStart = startOfDay(now).getTime()
    const secs: Section[] = []
    const inRange = db.tasks.filter(t => !t.done && t.dueAt && new Date(t.dueAt).getTime() >= todayStart)
    for (let i = 0; i < 7; i++) {
      const s = addDays(startOfDay(now), i).getTime()
      const end = addDays(startOfDay(now), i + 1).getTime()
      const list = inRange
        .filter(t => {
          const ms = new Date(t.dueAt!).getTime()
          return ms >= s && ms < end
        })
        .sort(sortTasks)
      if (list.length) secs.push({ key: `d${i}`, label: dayLabel(new Date(s), now), tasks: list })
    }
    const later = inRange.filter(t => new Date(t.dueAt!).getTime() >= addDays(startOfDay(now), 7).getTime()).sort(sortTasks)
    if (later.length) secs.push({ key: 'later', label: '更晚', tasks: later })
    if (!secs.length) secs.push({ key: 'empty', label: '未来 7 天暂无安排', tasks: [] })
    return secs
  }

  if (view.kind === 'project') {
    const pid = view.projectId ?? 'inbox'
    return groupDefault(
      db.tasks.filter(t => (t.projectId ?? 'inbox') === pid),
      now
    )
  }

  return groupDefault(db.tasks, now)
}
