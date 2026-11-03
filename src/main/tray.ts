// 系统托盘
import { Tray, Menu, nativeImage } from './electron-shims'
import type { TrayDeps } from './tray-deps'

let tray: Tray | null = null
let deps: TrayDeps | null = null

export function createTray(iconPath: string, d: TrayDeps): void {
  deps = d
  const img = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })
  tray = new Tray(img)
  tray.on('click', () => deps?.showMain())
  rebuild()
}

export function rebuild(): void {
  if (!tray || !deps) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 NoticeMe', click: () => deps?.showMain() },
      { label: '快速添加', click: () => deps?.onQuickAdd() },
      { type: 'separator' },
      { label: `今日待办 ${deps.getTodayCount()} 项`, enabled: false },
      { label: '开机自启', type: 'checkbox', checked: deps.getAutoStart(), click: () => deps?.toggleAutoStart() },
      { type: 'separator' },
      { label: '退出', click: () => deps?.onQuit() }
    ])
  )
  tray.setToolTip(`NoticeMe · 今日待办 ${deps.getTodayCount()} 项`)
}
