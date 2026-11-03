// 日期时间工具（纯函数）
export const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 已到期（含今天已过时刻） */
export function isDuePast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() < now.getTime()
}

/** 逾期：截止日早于今天（整天级别） */
export function isOverdue(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() < startOfDay(now).getTime()
}

/** 列表上的短标签：今天 14:30 / 明天 09:00 / 周五 09:00 / 11月5日 09:00 */
export function formatDueLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (isSameDay(d, now)) return `今天 ${hm}`
  if (isSameDay(d, addDays(now, 1))) return `明天 ${hm}`
  if (isSameDay(d, addDays(now, -1))) return `昨天 ${hm}`
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000)
  if (diff > 1 && diff <= 7) return `${WEEKDAYS_CN[d.getDay()]} ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

/** 详情页完整标签：2026年11月5日 周四 09:30 */
export function formatDueFull(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS_CN[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 输入框的值 */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInputValue(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** 提醒偏移的可读标签 */
export function formatReminderOffset(offsetMin: number | null): string {
  if (offsetMin === null || offsetMin === 0) return '准时'
  if (offsetMin % 1440 === 0) {
    const days = offsetMin / 1440
    return `提前 ${days} 天`
  }
  if (offsetMin % 60 === 0) return `提前 ${offsetMin / 60} 小时`
  return `提前 ${offsetMin} 分钟`
}

/** 贪睡预设标签 */
export function formatSnoozeLabel(min: number): string {
  if (min >= 1440 && min % 1440 === 0) return `明天（${min / 1440} 天后）`
  if (min % 60 === 0) return `${min / 60} 小时`
  return `${min} 分钟`
}

export function formatDateTimeCn(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
