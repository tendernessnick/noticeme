// 置顶提醒弹窗卡片（无边框、不抢焦点、闪烁任务栏）
import { BrowserWindow, screen, ipcMain, writeFileSyncSafe } from './electron-shims'
import { join } from 'node:path'
import type { AlertEntry, Settings } from '../shared/types'

interface Deps {
  getSettings(): Settings
  onComplete(taskId: string): void
  onSnooze(taskId: string, minutes: number): void
  onOpen(taskId: string): void
  onDismissed(taskId: string): void
}

const WIN_W = 420

export class AlertManager {
  private win: BrowserWindow | null = null
  private queue: AlertEntry[] = []
  /** 渲染端实测的内容高度（px），用于让窗口精确贴合卡片 */
  private contentH = 0

  constructor(private readonly deps: Deps) {
    // 渲染端挂载时主动拉取当前队列（防止加载完成前的 IPC 消息丢失）
    ipcMain.handle('alert:sync', () => ({
      items: this.queue,
      presets: this.deps.getSettings().snoozePresets
    }))
    // 渲染端回报实际内容高度，窗口随之收紧，卡片底边紧贴任务栏
    ipcMain.handle('alert:resize', (_e, h: number) => {
      if (typeof h === 'number' && h > 0) {
        this.contentH = h
        this.refresh()
      }
    })
    ipcMain.handle('alert:action', (_e, p: { type: string; taskId: string; minutes?: number }) => {
      this.queue = this.queue.filter(x => x.taskId !== p.taskId)
      switch (p.type) {
        case 'complete':
          this.deps.onComplete(p.taskId)
          break
        case 'snooze':
          this.deps.onSnooze(p.taskId, p.minutes ?? 10)
          break
        case 'open':
          this.deps.onOpen(p.taskId)
          break
        case 'dismiss':
          this.deps.onDismissed(p.taskId)
          break
      }
      this.refresh()
    })
  }

  show(entries: AlertEntry[]): void {
    for (const e of entries) this.queue = this.queue.filter(x => x.taskId !== e.taskId)
    this.queue.push(...entries)
    if (this.queue.length > 5) this.queue = this.queue.slice(-5)
    this.ensureWin()
    this.refresh()
  }

  private ensureWin(): void {
    if (this.win && !this.win.isDestroyed()) return
    this.win = new BrowserWindow({
      width: WIN_W,
      height: 240,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    // 页面每次加载完成后重发队列，彻底规避加载期消息丢失
    this.win.webContents.on('did-finish-load', () => this.refresh())
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void this.win.loadURL(`${devUrl}/alert.html`)
    else void this.win.loadFile(join(__dirname, '../renderer/alert.html'))
  }

  refresh(): void {
    if (!this.win || this.win.isDestroyed()) return
    if (this.queue.length === 0) {
      this.win.hide()
      this.win.flashFrame(false)
      return
    }
    // 高度：优先用渲染端实测高度，未知时按条目估算
    const estimated = 110 + this.queue.length * 112
    const height = Math.max(140, Math.min(560, this.contentH > 0 ? this.contentH + 8 : estimated))
    const { workArea } = screen.getPrimaryDisplay()
    this.win.setBounds({
      x: workArea.x + workArea.width - WIN_W - 16,
      y: workArea.y + workArea.height - height, // 底边紧贴任务栏上沿
      width: WIN_W,
      height
    })
    this.win.showInactive()
    this.win.flashFrame(true)
    this.win.webContents.send('alert:queue', {
      items: this.queue,
      presets: this.deps.getSettings().snoozePresets
    })
  }

  debugState(): { queued: number; visible: boolean } {
    return { queued: this.queue.length, visible: !!(this.win && !this.win.isDestroyed() && this.win.isVisible()) }
  }

  /** 冒烟测试截图 */
  async captureTo(file: string): Promise<void> {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return
    try {
      const img = await this.win.webContents.capturePage()
      writeFileSyncSafe(file, img.toPNG())
    } catch {
      /* ignore */
    }
  }
}
