import type { ThemeMode } from '../../../shared/types'

const mq = window.matchMedia('(prefers-color-scheme: dark)')
let mode: ThemeMode = 'system'

function apply(): void {
  const dark = mode === 'dark' || (mode === 'system' && mq.matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function applyTheme(m: ThemeMode): void {
  mode = m
  mq.onchange = m === 'system' ? apply : null
  apply()
}
