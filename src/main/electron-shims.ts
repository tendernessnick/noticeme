// 集中 re-export Electron 模块，便于统一 mock 与维护
export {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  Notification,
  nativeImage,
  globalShortcut,
  net,
  screen,
  utilityProcess
} from 'electron'

export function writeFileSyncSafe(file: string, data: Buffer): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { writeFileSync } = require('node:fs') as typeof import('node:fs')
  writeFileSync(file, data)
}
