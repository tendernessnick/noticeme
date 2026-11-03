// 本地 JSON 持久化：原子写入 + 每日滚动备份（保留 7 份）
import {
  readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../shared/types'
import { createDefaultDb, sanitizeDb } from '../shared/defaults'

const BACKUP_KEEP = 7

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export class Store {
  private db: Database
  private readonly file: string
  private readonly backupDir: string
  private readonly listeners = new Set<() => void>()

  constructor(dir: string) {
    this.file = join(dir, 'data.json')
    this.backupDir = join(dir, 'backups')
    mkdirSync(dir, { recursive: true })
    mkdirSync(this.backupDir, { recursive: true })
    this.db = this.load()
  }

  private load(): Database {
    if (!existsSync(this.file)) return createDefaultDb()
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8'))
      const db = sanitizeDb(raw)
      if (db) return db
    } catch {
      // 损坏文件移到一旁，避免阻塞启动
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
    }
    return createDefaultDb()
  }

  get(): Database {
    return this.db
  }

  /** 所有变更的唯一入口：修改 → 原子持久化 → 通知监听者 */
  mutate(fn: (db: Database) => void): Database {
    fn(this.db)
    this.db.updatedAt = new Date().toISOString()
    this.persist()
    for (const l of this.listeners) l()
    return this.db
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf-8')
    renameSync(tmp, this.file)
    this.dailyBackup()
  }

  /** 每天第一笔变更时做一份快照，超出保留数删除最旧的 */
  private dailyBackup(): void {
    try {
      const d = new Date()
      const name = `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
      const target = join(this.backupDir, name)
      if (!existsSync(target)) copyFileSync(this.file, target)
      const backups = readdirSync(this.backupDir)
        .filter(f => f.startsWith('data-') && f.endsWith('.json'))
        .sort()
      while (backups.length > BACKUP_KEEP) {
        const oldest = backups.shift()
        if (oldest) unlinkSync(join(this.backupDir, oldest))
      }
    } catch {
      /* 备份失败不影响主流程 */
    }
  }

  exportTo(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.db, null, 2), 'utf-8')
  }

  /** 导入前先留存当前数据（首次启动尚未落盘时跳过留底） */
  importFrom(filePath: string): Database {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    const next = sanitizeDb(raw)
    if (!next) throw new Error('文件格式不是有效的 NoticeMe 备份')
    if (existsSync(this.file)) {
      copyFileSync(this.file, join(this.backupDir, `data-before-import-${Date.now()}.json`))
    }
    this.db = next
    this.persist()
    for (const l of this.listeners) l()
    return this.db
  }
}
