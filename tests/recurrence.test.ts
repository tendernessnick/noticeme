// 重复规则推进测试
import { describe, expect, it } from 'vitest'
import { nextOccurrence } from '../src/shared/recurrence'
import type { RepeatRule } from '../src/shared/types'

const NOW = new Date(2026, 10, 3, 14, 0, 0, 0) // 2026-11-03 周二 14:00

describe('nextOccurrence', () => {
  it('每天 → 明天同一时间', () => {
    const due = new Date(2026, 10, 3, 9, 0)
    const next = nextOccurrence(due, { freq: 'daily' }, NOW)
    expect(next).toEqual(new Date(2026, 10, 4, 9, 0))
  })

  it('间隔 2 天', () => {
    const due = new Date(2026, 10, 3, 9, 0)
    const next = nextOccurrence(due, { freq: 'daily', interval: 2 }, NOW)
    expect(next).toEqual(new Date(2026, 10, 5, 9, 0))
  })

  it('逾期的每日任务 → 推进到未来的下一天', () => {
    const due = new Date(2026, 10, 1, 9, 0) // 两天前
    const next = nextOccurrence(due, { freq: 'daily' }, NOW)
    expect(next).toEqual(new Date(2026, 10, 4, 9, 0))
  })

  it('每个工作日：周五 → 下周一', () => {
    const due = new Date(2026, 10, 6, 9, 0) // 周五
    const next = nextOccurrence(due, { freq: 'weekdays' }, new Date(2026, 10, 6, 10, 0))
    expect(next).toEqual(new Date(2026, 10, 9, 9, 0)) // 下周一
  })

  it('每周 → +7 天', () => {
    const due = new Date(2026, 10, 3, 9, 0)
    const next = nextOccurrence(due, { freq: 'weekly' }, NOW)
    expect(next).toEqual(new Date(2026, 10, 10, 9, 0))
  })

  it('每月：1月31日 → 2月28日（钳制到月末）', () => {
    const due = new Date(2026, 0, 31, 9, 0)
    const next = nextOccurrence(due, { freq: 'monthly' }, new Date(2026, 1, 1, 0, 0))
    expect(next).toEqual(new Date(2026, 1, 28, 9, 0))
  })

  it('每年：闰日 2024-02-29 → 2025-02-28', () => {
    const due = new Date(2024, 1, 29, 9, 0)
    const next = nextOccurrence(due, { freq: 'yearly' }, new Date(2024, 2, 1, 0, 0))
    expect(next).toEqual(new Date(2025, 1, 28, 9, 0))
  })

  it('不重复 → null', () => {
    const due = new Date(2026, 10, 3, 9, 0)
    expect(nextOccurrence(due, { freq: 'daily' as never }, NOW)).not.toBeNull()
    // freq 缺失时返回 null（防御）
    expect(nextOccurrence(due, { freq: undefined as never }, NOW)).toBeNull()
  })
})
