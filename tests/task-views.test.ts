import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDb, newTask } from '../src/shared/defaults'
import { taskSections, sortTasks } from '../src/renderer/src/utils/views'
import { taskMetrics } from '../src/shared/task-metrics'
import { patchRecord } from '../src/shared/record-patch'

describe('任务视图与真实完成日期', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 14, 12)) })
  afterEach(() => vi.useRealTimers())
  const iso = (day: number, hour = 9): string => new Date(2026, 10, day, hour).toISOString()
  it('无截止日期、同优先级仍按手动顺序排列', () => {
    const a = newTask({ id: 'a', order: 20, dueAt: null })
    const b = newTask({ id: 'b', order: 10, dueAt: null })
    expect([a, b].sort(sortTasks).map(t => t.id)).toEqual(['b', 'a'])
  })
  it('今天完成可包含无截止日期和未来截止任务，不包括昨天完成', () => {
    const db = createDefaultDb()
    db.tasks = [
      newTask({ id: 'old', done: true, completedAt: iso(13), dueAt: iso(12) }),
      newTask({ id: 'today-no-due', done: true, completedAt: iso(14), dueAt: null }),
      newTask({ id: 'future-due', done: true, completedAt: iso(14, 10), dueAt: iso(20) }),
      newTask({ id: 'late', dueAt: iso(13) }), newTask({ id: 'due', dueAt: iso(14, 18) })
    ]
    const sections = taskSections(db, { kind: 'today' }, '', false)
    expect(sections.find(s => s.key === 'done')?.tasks.map(t => t.id)).toEqual(['future-due', 'today-no-due'])
    expect(taskMetrics(db.tasks)).toEqual({ dueToday: 1, overdue: 1, completedToday: 2 })
  })
  it('当前清单搜索不泄漏其他清单，已完成搜索不含未完成', () => {
    const db = createDefaultDb()
    db.tasks = [newTask({ id: 'a', title: '报告', projectId: 'a' }), newTask({ id: 'b', title: '报告', projectId: 'b', done: true })]
    expect(taskSections(db, { kind: 'project', projectId: 'a' }, '报告', false)[0].tasks.map(t => t.id)).toEqual(['a'])
    expect(taskSections(db, { kind: 'done' }, '报告', false)[0].tasks.map(t => t.id)).toEqual(['b'])
  })
  it('明天边界不包含到今天，搜索支持备注与标签', () => {
    const db = createDefaultDb()
    db.tasks = [newTask({ id: 'tomorrow', dueAt: iso(15, 0) }), newTask({ id: 'note', notes: '关键证据', tags: ['复盘'] })]
    expect(taskSections(db, { kind: 'today' }, '', false).flatMap(s => s.tasks)).toHaveLength(0)
    expect(taskSections(db, { kind: 'all' }, '证据', false)[0].tasks[0].id).toBe('note')
    expect(taskSections(db, { kind: 'all' }, '复盘', false)[0].tasks[0].id).toBe('note')
  })
})

describe('字段级保存不回滚并发更新', () => {
  it('备注更新保留外部完成与计划日期，身份及创建日期不变', () => {
    const task = newTask({ done: true, completedAt: '2026-11-14T00:00:00Z', plannedDay: '2026-11-15' })
    const records = [task]
    patchRecord(records, task.id, { notes: '最后输入', done: false, id: 'bad', createdAt: 'bad' }, ['done', 'completedAt'])
    expect(records[0]).toMatchObject({ id: task.id, createdAt: task.createdAt, notes: '最后输入', done: true, completedAt: task.completedAt, plannedDay: task.plannedDay })
  })
  it('删除后的延迟保存明确失败，不创建记录', () => {
    const records: ReturnType<typeof newTask>[] = []
    expect(() => patchRecord(records, 'deleted', { notes: '旧草稿' })).toThrow('记录已被删除')
    expect(records).toHaveLength(0)
  })
})
