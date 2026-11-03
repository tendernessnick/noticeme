// 提醒调度核心（纯函数）测试
import { describe, expect, it } from 'vitest'
import { collectFires } from '../src/shared/scheduler-core'
import { createDefaultDb, newTask, uid } from '../src/shared/defaults'
import type { Database, Task } from '../src/shared/types'

const NOW = new Date(2026, 10, 3, 14, 30, 0, 0)
const NOW_MS = NOW.getTime()
const WINDOW = 30 * 60000

function makeDb(over: Partial<Database> = {}): Database {
  const db = createDefaultDb()
  db.tasks = []
  Object.assign(db, over)
  return db
}

function taskWithReminder(dueAt: string, offsetMin: number | null = null, over: Partial<Task> = {}): Task {
  return newTask({
    title: '测试任务',
    dueAt,
    reminders: [{ id: uid(), offsetMin: offsetMin }],
    ...over
  })
}

describe('collectFires · 到点触发', () => {
  it('到点 1 分钟内 → 触发并标记', () => {
    const t = taskWithReminder(new Date(NOW_MS - 60000).toISOString())
    const db = makeDb({ tasks: [t] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(1)
    expect(res.fires[0].taskId).toBe(t.id)
    expect(res.fires[0].source).toBe('reminder')
    expect(res.markFired).toHaveLength(1)
    expect(res.markFired[0]).toBe(`${t.id}:${t.reminders[0].id}:${t.dueAt}`)
  })

  it('提前 5 分钟的提醒：未到截止但已到提醒点 → 触发', () => {
    const due = new Date(NOW_MS + 3 * 60000).toISOString() // 3 分钟后截止
    const t = taskWithReminder(due, 5) // 提前 5 分钟 → 提醒点在 2 分钟前
    const db = makeDb({ tasks: [t] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(1)
    expect(new Date(res.fires[0].fireAt).getTime()).toBe(NOW_MS - 2 * 60000)
  })

  it('未到提醒点 → 不触发', () => {
    const t = taskWithReminder(new Date(NOW_MS + 10 * 60000).toISOString())
    const db = makeDb({ tasks: [t] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
    expect(res.markFired).toHaveLength(0)
  })

  it('firedKeys 已存在的键 → 不重复触发', () => {
    const t = taskWithReminder(new Date(NOW_MS - 60000).toISOString())
    const db = makeDb({ tasks: [t], firedKeys: [`${t.id}:${t.reminders[0].id}:${t.dueAt}`] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
    expect(res.markFired).toHaveLength(0)
  })

  it('错过补发窗口外（>30 分钟）→ 静默标记不弹', () => {
    const t = taskWithReminder(new Date(NOW_MS - 3600000).toISOString()) // 1 小时前
    const db = makeDb({ tasks: [t] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
    expect(res.markFired).toHaveLength(1)
  })

  it('已完成任务 → 不触发', () => {
    const t = taskWithReminder(new Date(NOW_MS - 60000).toISOString(), null, { done: true })
    const db = makeDb({ tasks: [t] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
  })

  it('无截止时间任务 → 不触发', () => {
    const t = newTask({ title: '无日期', reminders: [{ id: uid(), offsetMin: null }] })
    const db = makeDb({ tasks: [t] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
  })
})

describe('collectFires · 贪睡', () => {
  it('贪睡到点 → 触发并消费', () => {
    const t = taskWithReminder(new Date(NOW_MS - 3600000).toISOString())
    const snooze = { id: uid(), taskId: t.id, fireAt: new Date(NOW_MS - 60000).toISOString() }
    const db = makeDb({ tasks: [t], snoozes: [snooze] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(1)
    expect(res.fires[0].source).toBe('snooze')
    expect(res.consumeSnoozes).toEqual([snooze.id])
  })

  it('贪睡未到点 → 不触发不消费', () => {
    const t = taskWithReminder(new Date(NOW_MS - 3600000).toISOString())
    const snooze = { id: uid(), taskId: t.id, fireAt: new Date(NOW_MS + 600000).toISOString() }
    const db = makeDb({ tasks: [t], snoozes: [snooze] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
    expect(res.consumeSnoozes).toHaveLength(0)
  })

  it('贪睡指向已完成任务 → 消费但不触发', () => {
    const t = taskWithReminder(new Date(NOW_MS - 3600000).toISOString(), null, { done: true })
    const snooze = { id: uid(), taskId: t.id, fireAt: new Date(NOW_MS - 60000).toISOString() }
    const db = makeDb({ tasks: [t], snoozes: [snooze] })
    const res = collectFires(db, NOW_MS, WINDOW)
    expect(res.fires).toHaveLength(0)
    expect(res.consumeSnoozes).toEqual([snooze.id])
  })
})
