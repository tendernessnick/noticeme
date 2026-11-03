// Windows 系统通知（Toast，进入通知中心）
import { Notification, nativeImage } from './electron-shims'
import { formatDueLabel } from '../shared/datetime'
import type { Task } from '../shared/types'

export function showToast(
  task: Pick<Task, 'id' | 'title' | 'dueAt'>,
  iconPath: string,
  onClick: (taskId: string) => void
): void {
  try {
    const n = new Notification({
      title: task.title,
      body: task.dueAt ? formatDueLabel(task.dueAt) : '到点提醒',
      icon: nativeImage.createFromPath(iconPath),
      silent: true // 声音由提醒卡片统一播放，避免双重提示音
    })
    n.on('click', () => onClick(task.id))
    n.show()
  } catch {
    // 某些未打包环境系统通知不可用，弹窗卡片已兜底
  }
}
