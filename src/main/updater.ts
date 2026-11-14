// 自动更新：electron-updater + GitHub Releases 更新源
// 优秀实践：启动静默检查 + 6h 轮询 + 手动检查；后台下载；退出静默安装或用户点「重启更新」；
// 失败完全静默（不打扰），任何更新器异常不得影响核心功能
import { app, shell } from './electron-shims'
import { autoUpdater } from 'electron-updater'
import { compareVersions } from '../shared/semver'
import type { UpdaterState } from '../shared/types'

const CHECK_INTERVAL_MS = 6 * 3600_000
const REPO_URL = 'https://github.com/tendernessnick/noticeme/releases/latest'

/** electron-updater 的错误 message 会带上完整 HTTP 头转储——只取首行并截断，供设置页展示 */
function sanitizeUpdaterError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const firstLine = raw.split('\n')[0].trim()
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine
}

export class AppUpdater {
  private state: UpdaterState = { phase: 'idle', version: '', progress: -1, error: '', notes: '', fallback: false }
  /** 更新器不可用（dev / 平台不支持 / 初始化失败）时置 true，所有调用静默短路 */
  private disabled = false
  private timer: NodeJS.Timeout | null = null
  /** macOS 未签名：electron-updater 无法静默安装，退化为「检查新版 + 打开下载页」 */
  private readonly isMacUnsigned = process.platform === 'darwin'
  /** portable 版：单文件形态不适合自动装回安装版，只提示去下载页 */
  private readonly isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR

  constructor(private readonly notify: (state: UpdaterState) => void) {}

  /** 应用就绪后调用；打包前（dev）与不支持的形态不启用 */
  init(isolatedTest = false): void {
    if (!app.isPackaged || isolatedTest) {
      this.disabled = true
      return
    }
    if (this.isPortable || this.isMacUnsigned) {
      // fallback 形态：不做静默更新，仅保留手动「检查新版」（GitHub API / 打开发布页）
      this.disabled = true
      this.state = { ...this.state, fallback: true }
      return
    }
    try {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.allowDowngrade = false
      autoUpdater.logger = console

      autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking' }))
      autoUpdater.on('update-available', info => {
        this.set({ phase: 'available', version: String(info.version ?? ''), progress: -1, error: '' })
      })
      autoUpdater.on('update-not-available', () => this.set({ phase: 'not-available', version: '', notes: '' }))
      autoUpdater.on('download-progress', p => {
        this.set({ phase: 'downloading', progress: p.percent != null ? p.percent / 100 : -1 })
      })
      autoUpdater.on('update-downloaded', info => {
        this.set({
          phase: 'downloaded',
          version: String(info.version ?? this.state.version),
          progress: 1
        })
      })
      autoUpdater.on('error', e => {
        // 失败静默：只记录到状态里，供设置页展示，绝不打扰
        this.set({ phase: 'error', error: sanitizeUpdaterError(e) })
      })
    } catch (e) {
      console.error('[updater] init failed:', e)
      this.disabled = true
      return
    }

    // 启动 15s 后错峰首查（不与启动加载/首帧竞争），之后每 6h
    setTimeout(() => this.check(), 15_000)
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 手动/定时检查。返回检查动作本身是否已发起（disabled 时不发起） */
  check(): boolean {
    if (this.disabled) return false
    this.set({ phase: 'checking', error: '' })
    void autoUpdater.checkForUpdates().catch(() => {
      /* error 事件已负责状态展示，这里吞掉避免 unhandled rejection */
    })
    return true
  }

  /** 手动检查入口（设置页按钮）：fallback 形态走对应退化路径，正常形态走 electron-updater */
  async checkManual(): Promise<UpdaterState> {
    if (this.isPortable) {
      await this.openReleasesPage()
      return this.state
    }
    if (this.isMacUnsigned) {
      this.set({ phase: 'checking' })
      const r = await this.checkMacVersion()
      if (!r) this.set({ phase: 'error', error: '检查失败：无法访问 GitHub' })
      else if (r.hasUpdate) this.set({ phase: 'available', version: r.latest, notes: '' })
      else this.set({ phase: 'not-available', version: '', notes: '' })
      return this.state
    }
    this.check()
    return this.state
  }

  /** macOS 未签名 / portable：打开发布页手动下载 */
  async openReleasesPage(): Promise<void> {
    await shell.openExternal(REPO_URL)
  }

  /** 退出并安装已下载的更新（仅 Windows NSIS 安装版） */
  install(): void {
    if (this.disabled || this.isMacUnsigned || this.state.phase !== 'downloaded') return
    autoUpdater.quitAndInstall(false, true)
  }

  /** macOS 未签名时的轻量检查：GitHub API 比对版本号 */
  async checkMacVersion(): Promise<{ latest: string; hasUpdate: boolean } | null> {
    if (!this.isMacUnsigned) return null
    try {
      const res = await fetch('https://api.github.com/repos/tendernessnick/noticeme/releases/latest')
      if (!res.ok) return null
      const data = (await res.json()) as { tag_name?: string }
      const latest = (data.tag_name ?? '').replace(/^v/, '')
      if (!latest) return null
      return { latest, hasUpdate: compareVersions(latest, app.getVersion()) > 0 }
    } catch {
      return null
    }
  }

  getState(): UpdaterState {
    return this.state
  }

  private set(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch }
    this.notify(this.state)
  }
}
