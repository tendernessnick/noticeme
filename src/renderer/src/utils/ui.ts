import type { Priority } from '../../../shared/types'

export const PRIORITY_COLORS: Record<Priority, string> = {
  1: '#ef4444',
  2: '#f59e0b',
  3: '#3b82f6',
  4: '#a1a1aa'
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: 'P1 · 紧急',
  2: 'P2 · 高',
  3: 'P3 · 中',
  4: 'P4 · 低'
}

export const START_OF_TODAY = (): number => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
