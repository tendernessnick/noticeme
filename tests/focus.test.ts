import { describe, expect, it } from 'vitest'
import { newTask } from '../src/shared/defaults'
import { searchFocusCandidates, selectFocusTasks, sortFocusTasks } from '../src/shared/focus'

const NOW = new Date(2026, 10, 14, 12, 0)

describe('今日聚焦读取与规划', () => {
  it('未完成的旧计划无论是否到期都保留，读取不改变任何历史字段', () => {
    const tasks = [
      newTask({ id: 'no-due', plannedDay: '2026-11-12', dueAt: null }),
      newTask({ id: 'future-due', plannedDay: '2026-11-13', dueAt: new Date(2026, 11, 1).toISOString() }),
      newTask({ id: 'old-done', plannedDay: '2026-11-12', done: true }),
      newTask({ id: 'future-plan', plannedDay: '2026-11-15' })
    ]
    const snapshot = JSON.stringify(tasks)
    const result = selectFocusTasks(tasks, NOW)
    expect(result.carryover.map(t => t.id)).toEqual(['no-due', 'future-due'])
    expect(result.plan).toEqual([])
    expect(JSON.stringify(tasks)).toBe(snapshot)
  })

  it('旧计划和今天计划的逾期任务不在逾期区重复出现', () => {
    const dueAt = new Date(2026, 10, 13, 9).toISOString()
    const result = selectFocusTasks([
      newTask({ id: 'old', plannedDay: '2026-11-13', dueAt }),
      newTask({ id: 'today', plannedDay: '2026-11-14', dueAt }),
      newTask({ id: 'overdue', dueAt }),
      newTask({ id: 'done', done: true, dueAt })
    ], NOW)
    expect(result.carryover.map(t => t.id)).toEqual(['old'])
    expect(result.plan.map(t => t.id)).toEqual(['today'])
    expect(result.overdue.map(t => t.id)).toEqual(['overdue'])
  })

  it('候选任务包含无日期、低优先级与未来计划，不依赖 AI', () => {
    const result = selectFocusTasks([
      newTask({ id: 'no-due', priority: 4 }),
      newTask({ id: 'future', plannedDay: '2026-11-15' }),
      newTask({ id: 'today', plannedDay: '2026-11-14' }),
      newTask({ id: 'done', done: true })
    ], NOW)
    expect(result.candidates.map(t => t.id)).toEqual(['future', 'no-due'])
  })

  it('今日计划进度只统计今天的计划，不把历史完成算作今日表现', () => {
    const result = selectFocusTasks([
      newTask({ id: 'today-active', plannedDay: '2026-11-14' }),
      newTask({ id: 'today-done', plannedDay: '2026-11-14', done: true }),
      newTask({ id: 'history-done', plannedDay: '2026-11-13', done: true })
    ], NOW)
    expect(result.total).toBe(2)
    expect(result.progress).toBe(50)
    expect(result.done.map(t => t.id)).toEqual(['today-done'])
    expect(selectFocusTasks([], NOW).progress).toBe(0)
  })

  it('跨日读取自动把昨天未完成计划分到待续，明天使用本地日历增量', () => {
    const task = newTask({ id: 'carry', plannedDay: '2026-11-14' })
    expect(selectFocusTasks([task], new Date(2026, 10, 14, 23, 59)).plan).toHaveLength(1)
    const next = selectFocusTasks([task], new Date(2026, 10, 15, 0, 1))
    expect(next.carryover).toHaveLength(1)
    expect(next.tomorrow).toBe('2026-11-16')
    expect(selectFocusTasks([], new Date(2026, 11, 31, 23)).tomorrow).toBe('2027-01-01')
  })

  it('夏令时切换日仍以本地日历的下一天作为明天', () => {
    expect(selectFocusTasks([], new Date(2026, 2, 7, 23, 30)).tomorrow).toBe('2026-03-08')
    expect(selectFocusTasks([], new Date(2026, 10, 1, 0, 30)).tomorrow).toBe('2026-11-02')
  })

  it('先按优先级和真实时间排序，再以原顺序稳定排列无日期任务', () => {
    const tasks = [
      newTask({ id: 'p4', priority: 4, dueAt: new Date(2026, 10, 1).toISOString() }),
      newTask({ id: 'later', priority: 1, dueAt: '2026-11-14T12:00:00+08:00' }),
      newTask({ id: 'earlier', priority: 1, dueAt: '2026-11-14T05:00:00+02:00' }),
      newTask({ id: 'none-last', priority: 1, dueAt: null, order: 20 }),
      newTask({ id: 'none-first', priority: 1, dueAt: null, order: 10 })
    ]
    expect([...tasks].sort(sortFocusTasks).map(t => t.id)).toEqual(['earlier', 'later', 'none-first', 'none-last', 'p4'])
  })

  it('候选搜索覆盖标题、备注和标签，不更改候选或大小写内容', () => {
    const tasks = [
      newTask({ id: 'title', title: 'Review Report' }),
      newTask({ id: 'notes', notes: '找导师确认方案' }),
      newTask({ id: 'tag', tags: ['Work'] })
    ]
    expect(searchFocusCandidates(tasks, ' report ').map(t => t.id)).toEqual(['title'])
    expect(searchFocusCandidates(tasks, '导师').map(t => t.id)).toEqual(['notes'])
    expect(searchFocusCandidates(tasks, 'work').map(t => t.id)).toEqual(['tag'])
    expect(searchFocusCandidates(tasks, '缺失')).toEqual([])
    expect(searchFocusCandidates(tasks, '')).toHaveLength(3)
  })
})
