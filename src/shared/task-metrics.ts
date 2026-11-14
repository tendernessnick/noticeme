import type { Task } from './types'
import { addDays, startOfDay } from './datetime'

/** 以本地日历日计数；不把过去完成的任务充作今天的成绩。 */
export function taskMetrics(tasks: Task[], now = new Date()): {
  dueToday: number; overdue: number; completedToday: number
} {
  const start = startOfDay(now).getTime()
  const end = addDays(startOfDay(now), 1).getTime()
  return {
    dueToday: tasks.filter(t => !t.done && t.dueAt && Date.parse(t.dueAt) >= start && Date.parse(t.dueAt) < end).length,
    overdue: tasks.filter(t => !t.done && t.dueAt && Date.parse(t.dueAt) < now.getTime()).length,
    completedToday: tasks.filter(t => t.done && t.completedAt && Date.parse(t.completedAt) >= start && Date.parse(t.completedAt) < end).length
  }
}
