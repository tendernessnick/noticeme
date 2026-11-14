// 今日聚焦只读取任务，不自动更改计划日期、截止日或历史完成记录。
import type { Task } from './types'
import { localToday } from './defaults'
import { addDays, isDuePast } from './datetime'

function dueTime(task: Task): number {
  const ms = task.dueAt ? new Date(task.dueAt).getTime() : NaN
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

/** 优先级 → 截止时刻 → 原顺序；无截止日期时仍有确定的排序。 */
export function sortFocusTasks(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  const ad = dueTime(a)
  const bd = dueTime(b)
  if (ad !== bd) return ad < bd ? -1 : 1
  return a.order - b.order || a.id.localeCompare(b.id)
}

export interface FocusTasks {
  today: string
  tomorrow: string
  plan: Task[]
  done: Task[]
  carryover: Task[]
  overdue: Task[]
  candidates: Task[]
  total: number
  progress: number
}

export function selectFocusTasks(tasks: readonly Task[], now: Date = new Date()): FocusTasks {
  const today = localToday(now)
  const active = tasks.filter(t => !t.done)
  const plan = active.filter(t => t.plannedDay === today).sort(sortFocusTasks)
  const done = tasks.filter(t => t.done && t.plannedDay === today).sort(sortFocusTasks)
  // 旧计划即使没有截止时间也保留入口；不把它静默移进今天。
  const carryover = active
    .filter(t => !!t.plannedDay && t.plannedDay < today)
    .sort((a, b) => a.plannedDay!.localeCompare(b.plannedDay!) || sortFocusTasks(a, b))
  const carryoverIds = new Set(carryover.map(t => t.id))
  const candidates = active.filter(t => t.plannedDay !== today).sort(sortFocusTasks)
  const overdue = candidates.filter(t => !carryoverIds.has(t.id) && !!t.dueAt && isDuePast(t.dueAt, now))
  const total = plan.length + done.length
  return {
    today,
    tomorrow: localToday(addDays(now, 1)),
    plan,
    done,
    carryover,
    overdue,
    candidates,
    total,
    progress: total ? Math.round(done.length / total * 100) : 0
  }
}

/** 与主任务搜索一致，支持标题、备注与标签。 */
export function searchFocusCandidates(tasks: readonly Task[], query: string): Task[] {
  const needle = query.trim().toLocaleLowerCase()
  return tasks.filter(t => !needle || [t.title, t.notes ?? '', ...t.tags].some(v => v.toLocaleLowerCase().includes(needle)))
}
