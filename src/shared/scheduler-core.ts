// 提醒触发收集（纯函数：给定数据库与当前时间 → 本轮应触发的提醒）
import type { Database, Priority } from './types'

export interface FireItem {
  taskId: string
  reminderId: string | null
  /** 防重键 */
  key: string
  fireAt: string
  source: 'reminder' | 'snooze'
  title: string
  priority: Priority
  dueAt: string | null
}

export interface CollectResult {
  fires: FireItem[]
  /** 需要标记为已消费的键（包含补发与窗口外静默消费） */
  markFired: string[]
  /** 需要删除的贪睡条目 id */
  consumeSnoozes: string[]
}

/**
 * @param db 数据库快照
 * @param nowMs 当前时间戳
 * @param missedWindowMs 错过补发窗口：超过该时长的历史提醒不再弹窗（静默标记已消费）
 */
export function collectFires(db: Database, nowMs: number, missedWindowMs: number): CollectResult {
  const fires: FireItem[] = []
  const markFired: string[] = []
  const consumeSnoozes: string[] = []
  const fired = new Set(db.firedKeys)

  // 1) 贪睡条目到点
  for (const s of db.snoozes) {
    if (new Date(s.fireAt).getTime() <= nowMs) {
      const task = db.tasks.find(t => t.id === s.taskId)
      if (task && !task.done) {
        fires.push({
          taskId: s.taskId, reminderId: null, key: `snooze:${s.id}`,
          fireAt: s.fireAt, source: 'snooze',
          title: task.title, priority: task.priority, dueAt: task.dueAt
        })
      }
      consumeSnoozes.push(s.id)
    }
  }

  // 2) 任务提醒到点
  for (const task of db.tasks) {
    if (task.done || !task.dueAt || task.reminders.length === 0) continue
    const dueMs = new Date(task.dueAt).getTime()
    for (const r of task.reminders) {
      const offsetMin = r.offsetMin ?? 0
      const fireMs = dueMs - offsetMin * 60000
      const key = `${task.id}:${r.id}:${task.dueAt}`
      if (fired.has(key)) continue
      if (fireMs <= nowMs) {
        if (nowMs - fireMs <= missedWindowMs) {
          fires.push({
            taskId: task.id, reminderId: r.id, key,
            fireAt: new Date(fireMs).toISOString(), source: 'reminder',
            title: task.title, priority: task.priority, dueAt: task.dueAt
          })
        }
        // 无论是否补发，过去的键都标记消费，避免反复扫描
        markFired.push(key)
      }
    }
  }

  return { fires, markFired, consumeSnoozes }
}
