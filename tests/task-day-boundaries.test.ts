import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDb, newTask } from '../src/shared/defaults'
import { taskMetrics } from '../src/shared/task-metrics'
import { taskSections } from '../src/renderer/src/utils/views'

describe('本地日历边界（可在 America/New_York TZ 下复验夏令时）', () => {
  afterEach(() => vi.useRealTimers())
  it.each([[2, 8], [10, 1]])('2026/%s/%s 明天零点不误算今天', (month, day) => {
    vi.useFakeTimers()
    const now = new Date(2026, month, day, 12)
    vi.setSystemTime(now)
    const tomorrow = new Date(2026, month, day + 1, 0, 30).toISOString()
    const lateToday = new Date(2026, month, day, 23, 45).toISOString()
    const db = createDefaultDb()
    db.tasks = [newTask({ id: 'tomorrow', dueAt: tomorrow }), newTask({ id: 'today', dueAt: lateToday })]
    expect(taskMetrics(db.tasks, now).dueToday).toBe(1)
    expect(taskSections(db, { kind: 'today' }, '', false).flatMap(s => s.tasks).map(t => t.id)).toEqual(['today'])
    expect(taskSections(db, { kind: 'upcoming' }, '', false).find(s => s.key === 'd1')?.tasks.map(t => t.id)).toEqual(['tomorrow'])
  })
})
