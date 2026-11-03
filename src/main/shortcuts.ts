// 全局快捷键（冲突时静默降级）
import { globalShortcut } from './electron-shims'
import type { Settings } from '../shared/types'

export interface ShortcutHandlers {
  onQuickAdd(): void
  onToggleShow(): void
}

export function applyShortcuts(settings: Settings, handlers: ShortcutHandlers): void {
  globalShortcut.unregisterAll()
  const reg = (accel: string, fn: () => void): boolean => {
    try {
      return globalShortcut.register(accel, fn)
    } catch {
      return false
    }
  }
  if (settings.hotkeyQuickAdd) reg(settings.hotkeyQuickAdd, handlers.onQuickAdd)
  if (settings.hotkeyShow) reg(settings.hotkeyShow, handlers.onToggleShow)
}
