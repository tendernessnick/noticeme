// 重复任务规则推进（纯函数）
import type { RepeatRule } from './types'
import { addDays } from './datetime'

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate()
}

/**
 * 计算重复任务的下一个截止时间。
 * @param due 当前截止时间
 * @param rule 重复规则
 * @param now 当前时间（推进直到严格晚于 now，避免逾期的重复任务卡在过去的日期）
 */
export function nextOccurrence(due: Date, rule: RepeatRule, now: Date = new Date()): Date | null {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1))
  const advance = (d: Date): Date | null => {
    switch (rule.freq) {
      case 'daily':
        return addDays(d, interval)
      case 'weekdays': {
        let n = addDays(d, 1)
        while (n.getDay() === 0 || n.getDay() === 6) n = addDays(n, 1)
        return n
      }
      case 'weekly':
        return addDays(d, 7 * interval)
      case 'monthly': {
        const target = new Date(
          d.getFullYear(), d.getMonth() + interval, 1,
          d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
        )
        target.setDate(Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth())))
        return target
      }
      case 'yearly': {
        const y = d.getFullYear() + interval
        return new Date(
          y, d.getMonth(), Math.min(d.getDate(), daysInMonth(y, d.getMonth())),
          d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
        )
      }
      default:
        return null
    }
  }

  let next = advance(due)
  let guard = 0
  while (next && next.getTime() <= now.getTime() && guard < 100000) {
    next = advance(next)
    guard++
  }
  return next
}
