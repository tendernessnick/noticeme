// NoticeMe 主进程：生命周期 / IPC / 烟雾测试钩子
import { app, BrowserWindow, dialog, ipcMain } from './electron-shims'
import { join } from 'node:path'
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Store } from './store'
import { Scheduler } from './scheduler'
import { AlertManager } from './alerts'
import { showToast } from './notify'
import { createTray, rebuild } from './tray'
import { applyShortcuts } from './shortcuts'
import { defaultSettings, newTask } from '../shared/defaults'
import { nextOccurrence } from '../shared/recurrence'
import type { AlertEntry, JournalEntry, Project, Settings, Task, UiEvent } from '../shared/types'
import type { TrayDeps } from './tray-deps'
import type { FireItem } from '../shared/scheduler-core'

const SMOKE_DIR = process.env.NOTICE_ME_SMOKE || ''
const IS_SMOKE = !!SMOKE_DIR

if (IS_SMOKE) {
  // 每次冒烟使用独立数据目录，避免多次运行的数据互相污染
  app.setPath('userData', join(tmpdir(), `noticeme-smoke-${Date.now()}`))
}

app.setAppUserModelId('com.dsh.noticeme')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let win: BrowserWindow | null = null
let store: Store
let scheduler: Scheduler
let alerts: AlertManager
let quitting = false
/** 提示音的本地真实路径（打包时从 asar 拷出，供系统播放器读取） */
let chimeFile = ''

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())
}

function resourcePath(...p: string[]): string {
  // 开发时 = 项目根/resources；打包后 = asar 内的 resources（Electron 虚拟文件系统可直接读取）
  return join(app.getAppPath(), 'resources', ...p)
}

function loadPage(w: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void w.loadURL(`${devUrl}/${page}`)
  else void w.loadFile(join(__dirname, '../renderer', page))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e12',
    title: 'NoticeMe',
    icon: resourcePath('icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('close', e => {
    if (!quitting && store.get().settings.closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) {
      win?.webContents.toggleDevTools()
    }
  })
  loadPage(win, 'index.html')
}

function sendUi(payload: UiEvent): void {
  win?.webContents.send('ui', payload)
}

function showMain(opts?: { taskId?: string }): void {
  if (!win || win.isDestroyed()) createWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (opts?.taskId) sendUi({ type: 'open-task', taskId: opts.taskId })
}

function broadcastDb(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('db:updated', store.get())
  }
}

function todayCount(): number {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return store.get().tasks.filter(t => {
    if (t.done || !t.dueAt) return false
    const ms = new Date(t.dueAt).getTime()
    return ms < end.getTime()
  }).length
}

function setDoneInternal(id: string, done: boolean): void {
  store.mutate(db => {
    const t = db.tasks.find(x => x.id === id)
    if (!t) return
    const nowIso = new Date().toISOString()
    if (done) {
      if (t.repeat && t.dueAt) {
        // 重复任务：完成即推进到下一次，保持未完成
        const next = nextOccurrence(new Date(t.dueAt), t.repeat, new Date())
        if (next) t.dueAt = next.toISOString()
        else {
          t.done = true
          t.completedAt = nowIso
        }
      } else {
        t.done = true
        t.completedAt = nowIso
      }
    } else {
      t.done = false
      t.completedAt = null
    }
    t.updatedAt = nowIso
  })
  scheduler.wake()
  broadcastDb()
}

/** 用系统播放器播放提示音（不依赖任何窗口状态，规避渲染端竞态） */
function playChimeSound(): void {
  if (!chimeFile) return
  try {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `(New-Object System.Media.SoundPlayer '${chimeFile.replace(/'/g, "''")}').PlaySync()`
      ],
      { stdio: 'ignore', windowsHide: true }
    )
    ps.unref()
  } catch {
    /* 播放失败不影响提醒本身 */
  }
}

function onFires(fires: FireItem[]): void {
  const s = store.get().settings
  const db = store.get()
  const entries: AlertEntry[] = fires.map(f => ({
    taskId: f.taskId,
    title: f.title,
    priority: f.priority,
    dueAt: f.dueAt,
    fireAt: f.fireAt
  }))
  // 提醒方式：card=仅置顶卡片（默认） toast=仅系统通知 both=两者同时（通知中心留痕）
  const showCard = s.notifyMode !== 'toast'
  const showToastMsg = s.notifyMode === 'toast' || s.notifyMode === 'both'
  if (showCard) alerts.show(entries)
  if (s.soundOn) playChimeSound()
  if (showToastMsg) {
    const icon = resourcePath('icon.png')
    for (const f of fires) {
      const task = db.tasks.find(t => t.id === f.taskId)
      if (task) showToast(task, icon, taskId => showMain({ taskId }))
    }
  }
}

function applySettingsSideEffects(): void {
  const s = store.get().settings
  applyShortcuts(s, {
    onQuickAdd: () => {
      showMain()
      sendUi({ type: 'quickadd' })
    },
    onToggleShow: () => {
      if (!win || win.isDestroyed()) {
        createWindow()
        return
      }
      if (win.isVisible() && win.isFocused()) win.hide()
      else showMain()
    }
  })
  try {
    app.setLoginItemSettings({ openAtLogin: s.autostart, path: process.execPath })
  } catch {
    /* ignore */
  }
}

const trayDeps: TrayDeps = {
  showMain: () => showMain(),
  onQuickAdd: () => {
    showMain()
    sendUi({ type: 'quickadd' })
  },
  onQuit: () => {
    quitting = true
    app.quit()
  },
  getTodayCount: () => todayCount(),
  getAutoStart: () => store.get().settings.autostart,
  toggleAutoStart: () => {
    store.mutate(db => {
      db.settings.autostart = !db.settings.autostart
    })
    applySettingsSideEffects()
    broadcastDb()
  }
}

function registerIpc(): void {
  ipcMain.handle('db:get', () => store.get())

  ipcMain.handle('task:upsert', (_e, task: Task) => {
    const nowIso = new Date().toISOString()
    store.mutate(db => {
      const idx = db.tasks.findIndex(t => t.id === task.id)
      if (idx >= 0) db.tasks[idx] = { ...task, updatedAt: nowIso }
      else db.tasks.push({ ...task, createdAt: task.createdAt || nowIso, updatedAt: nowIso })
    })
    scheduler.wake()
    broadcastDb()
  })

  ipcMain.handle('task:delete', (_e, id: string) => {
    store.mutate(db => {
      db.tasks = db.tasks.filter(t => t.id !== id)
      db.snoozes = db.snoozes.filter(s => s.taskId !== id)
    })
    scheduler.wake()
    broadcastDb()
  })

  ipcMain.handle('task:setDone', (_e, p: { id: string; done: boolean }) => {
    setDoneInternal(p.id, p.done)
  })

  ipcMain.handle('project:add', (_e, p: { name: string; color: string }): string => {
    let id = ''
    store.mutate(db => {
      const proj: Project = {
        id: randomUUID(),
        name: p.name.trim().slice(0, 30) || '新清单',
        color: p.color,
        createdAt: new Date().toISOString()
      }
      db.projects.push(proj)
      id = proj.id
    })
    broadcastDb()
    return id
  })

  ipcMain.handle('project:update', (_e, p: Project) => {
    store.mutate(db => {
      const i = db.projects.findIndex(x => x.id === p.id)
      if (i >= 0) db.projects[i] = p
    })
    broadcastDb()
  })

  ipcMain.handle('project:delete', (_e, id: string) => {
    store.mutate(db => {
      if (id === 'inbox') return
      db.projects = db.projects.filter(x => x.id !== id)
      for (const t of db.tasks) if (t.projectId === id) t.projectId = 'inbox'
    })
    broadcastDb()
  })

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    store.mutate(db => {
      db.settings = { ...defaultSettings(), ...db.settings, ...patch }
    })
    applySettingsSideEffects()
    rebuild()
    broadcastDb()
  })

  ipcMain.handle('data:export', async () => {
    if (!win) return false
    const r = await dialog.showSaveDialog(win, {
      title: '导出数据',
      defaultPath: 'noticeme-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return false
    store.exportTo(r.filePath)
    return true
  })

  ipcMain.handle('data:import', async () => {
    if (!win) return false
    const r = await dialog.showOpenDialog(win, {
      title: '导入数据（将覆盖当前数据，已自动备份）',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return false
    try {
      store.importFrom(r.filePaths[0])
    } catch {
      return false
    }
    scheduler.wake()
    broadcastDb()
    return true
  })

  ipcMain.handle('journal:upsert', (_e, entry: JournalEntry) => {
    const nowIso = new Date().toISOString()
    store.mutate(db => {
      const idx = db.entries.findIndex(x => x.id === entry.id)
      if (idx >= 0) db.entries[idx] = { ...entry, updatedAt: nowIso }
      else db.entries.push({ ...entry, createdAt: entry.createdAt || nowIso, updatedAt: nowIso })
    })
    broadcastDb()
  })

  ipcMain.handle('journal:delete', (_e, id: string) => {
    store.mutate(db => {
      db.entries = db.entries.filter(x => x.id !== id)
    })
    broadcastDb()
  })

  ipcMain.handle('data:info', () => ({ dir: app.getPath('userData') }))

  ipcMain.handle('assets:chime', () => {
    try {
      return 'data:audio/wav;base64,' + readFileSync(resourcePath('chime.wav')).toString('base64')
    } catch {
      return ''
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms))
}

async function capture(w: BrowserWindow | null, file: string): Promise<void> {
  if (!w || w.isDestroyed()) return
  try {
    const img = await w.webContents.capturePage()
    writeFileSync(file, img.toPNG())
  } catch {
    /* ignore */
  }
}

/** 烟雾测试钩子：NOTICE_ME_SMOKE=<输出目录> 时自动注入演示数据、截图并退出 */
async function runSmoke(): Promise<void> {
  const outDir = SMOKE_DIR
  const log = (m: string): void => {
    try {
      writeFileSync(join(outDir, 'smoke.log'), `${new Date().toISOString()} ${m}\n`, { flag: 'a' })
    } catch {
      /* ignore */
    }
  }
  mkdirSync(outDir, { recursive: true })
  log('smoke start')
  await sleep(1800)
  await capture(win, join(outDir, 'main-initial.png'))

  // 注入演示数据（独立临时数据目录，不污染真实数据）
  const now = new Date()
  store.mutate(db => {
    const mk = (title: string, priority: Task['priority'], dueAt: string | null): Task =>
      newTask({ title, priority, dueAt, projectId: 'inbox' })
    db.tasks.push(
      mk('整理季度报表初稿', 1, new Date(now.getTime() - 2 * 3600_000).toISOString()),
      mk('回复合作方邮件', 2, new Date(now.getTime() + 2 * 3600_000).toISOString()),
      mk('团队周会准备', 3, new Date(now.getTime() + 26 * 3600_000).toISOString()),
      mk('购买咖啡豆', 4, null),
      newTask({
        title: '演示：到点弹窗提醒',
        priority: 2,
        dueAt: new Date(now.getTime() + 2_000).toISOString(),
        projectId: 'inbox',
        reminders: [{ id: randomUUID(), offsetMin: null }]
      })
    )
  })
  scheduler.wake()
  await sleep(800)
  await capture(win, join(outDir, 'main-tasks.png'))

  await sleep(9000) // 等待演示提醒触发
  await capture(win, join(outDir, 'main-when-alert.png'))
  await alerts.captureTo(join(outDir, 'alert-card.png'))

  // 暗色主题验收截图
  store.mutate(db => {
    db.settings.theme = 'dark'
  })
  await sleep(800)
  await capture(win, join(outDir, 'main-dark.png'))

  log(`smoke done ${JSON.stringify(alerts.debugState())}`)
  app.exit(0)
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'))

  // 提示音拷贝到真实文件路径（PowerShell 播放器无法读取 asar 内部路径）
  try {
    chimeFile = join(app.getPath('userData'), 'chime.wav')
    copyFileSync(resourcePath('chime.wav'), chimeFile)
  } catch {
    chimeFile = resourcePath('chime.wav')
  }

  alerts = new AlertManager({
    getSettings: () => store.get().settings,
    onComplete: id => setDoneInternal(id, true),
    onSnooze: (id, minutes) => {
      store.mutate(db => {
        db.snoozes.push({
          id: randomUUID(),
          taskId: id,
          fireAt: new Date(Date.now() + minutes * 60_000).toISOString()
        })
      })
      scheduler.wake()
    },
    onOpen: id => showMain({ taskId: id }),
    onDismissed: id => {
      const s = store.get().settings
      if (s.nagEnabled) {
        store.mutate(db => {
          db.snoozes.push({
            id: randomUUID(),
            taskId: id,
            fireAt: new Date(Date.now() + s.nagIntervalMin * 60_000).toISOString()
          })
        })
        scheduler.wake()
      }
    }
  })

  scheduler = new Scheduler(store, onFires)
  registerIpc()
  createWindow()
  createTray(resourcePath('icon.png'), trayDeps)
  scheduler.start()
  applySettingsSideEffects()
  rebuild()
  // 任何数据变更统一广播到所有窗口 + 刷新托盘
  store.onChange(() => {
    broadcastDb()
    rebuild()
  })

  if (IS_SMOKE) void runSmoke()
})

app.on('window-all-closed', () => {
  if (quitting || !store?.get().settings.closeToTray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
})
