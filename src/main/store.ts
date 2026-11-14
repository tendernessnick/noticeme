// 本地 JSON 持久化：事务式原子写入 + 写前每日快照 + 损坏恢复。
import {
  readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync,
  readdirSync, unlinkSync, statSync, constants
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Database } from '../shared/types'
import { createDefaultDb, DATA_VERSION, sanitizeDb } from '../shared/defaults'

const BACKUP_KEEP = 7
const DAILY_BACKUP = /^data-\d{4}-\d{2}-\d{2}\.json$/
const RECOVERABLE_BACKUP = /^(?:data-\d{4}-\d{2}-\d{2}|backup-\d{4}-\d{2}-\d{2}|data-before-import-\d+(?:-[0-9a-f-]+)?)\.json$/

export interface RecoveryInfo {
  backupFile: string
  archivedFile: string | null
}

class UnsupportedDataVersionError extends Error {}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 宽松迁移旧版本，但禁止以“迁移”为名静默丢弃损坏记录。 */
function readDatabase(file: string): Database {
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  if (raw && typeof raw.version === 'number' && raw.version > DATA_VERSION) {
    throw new UnsupportedDataVersionError('数据由更新版本的 NoticeMe 创建，请升级应用后再打开。原文件未修改。')
  }
  const db = sanitizeDb(raw)
  if (!db) throw new Error('数据格式无效')
  for (const key of ['tasks', 'projects', 'entries', 'notes', 'noteFolders', 'snoozes', 'firedKeys'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) throw new Error(`数据字段 ${key} 格式无效`)
    if (Array.isArray(raw[key]) && db[key].length < raw[key].length) {
      throw new Error(`数据字段 ${key} 含损坏记录，已停止自动覆盖`)
    }
  }
  // 默认文件夹的补齐可能抵消被过滤的坏文件夹数量，因此还要逐个确认来源 id 被保留。
  for (const key of ['tasks', 'projects', 'entries', 'notes', 'noteFolders'] as const) {
    if (!Array.isArray(raw[key])) continue
    const retainedIds = new Set(db[key].map(item => item.id))
    if (raw[key].some((item: unknown) => !item || typeof item !== 'object' || !retainedIds.has((item as { id: string }).id))) {
      throw new Error(`数据字段 ${key} 含损坏记录，已停止自动覆盖`)
    }
  }
  return db
}

export class Store {
  private db: Database
  private readonly file: string
  private readonly backupDir: string
  private readonly listeners = new Set<() => void>()
  private recovered: RecoveryInfo | null = null

  constructor(dir: string) {
    this.file = join(dir, 'data.json')
    this.backupDir = join(dir, 'backups')
    mkdirSync(dir, { recursive: true })
    mkdirSync(this.backupDir, { recursive: true })
    this.db = this.load()
  }

  /** 供启动界面告知恢复来源；不包含任务或笔记正文。 */
  get recoveryInfo(): RecoveryInfo | null {
    return this.recovered
  }

  private load(): Database {
    const hasMain = existsSync(this.file)
    if (hasMain) {
      try {
        return readDatabase(this.file)
      } catch (error) {
        // 降级打开新版数据时不能退回较旧快照。
        if (error instanceof UnsupportedDataVersionError) throw error
      }
    }

    const candidates = readdirSync(this.backupDir)
      .filter(name => RECOVERABLE_BACKUP.test(name))
      .map(name => {
        const file = join(this.backupDir, name)
        let modified = 0
        try { modified = statSync(file).mtimeMs } catch { /* 继续尝试其他快照 */ }
        return { file, modified }
      })
      .sort((a, b) => b.modified - a.modified || b.file.localeCompare(a.file))

    for (const candidate of candidates) {
      let db: Database
      try {
        db = readDatabase(candidate.file)
      } catch {
        continue
      }
      // 先复制原始字节，再原子替换；留档或写入失败都保留原 data.json。
      const archivedFile = hasMain ? `${this.file}.corrupt-${Date.now()}-${randomUUID()}` : null
      if (archivedFile) copyFileSync(this.file, archivedFile, constants.COPYFILE_EXCL)
      this.writeAtomic(db)
      this.recovered = { backupFile: candidate.file, archivedFile }
      return db
    }

    const hasCorruptArchive = readdirSync(dirname(this.file)).some(name => name.startsWith('data.json.corrupt-'))
    if (hasMain || candidates.length || hasCorruptArchive) {
      throw new Error('NoticeMe 数据无法读取，且未找到可恢复的有效备份。已停止启动以保护历史数据；请保留数据目录并从导出备份恢复。')
    }
    return createDefaultDb()
  }

  get(): Database {
    return this.db
  }

  /** 在副本上修改；只有落盘成功后才发布新状态，失败不会污染内存。 */
  mutate(fn: (db: Database) => void): Database {
    const next = structuredClone(this.db)
    fn(next)
    next.updatedAt = new Date().toISOString()
    this.persist(next)
    this.db = next
    for (const l of this.listeners) l()
    return this.db
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private writeAtomic(db: Database): void {
    const tmp = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8')
      renameSync(tmp, this.file)
    } finally {
      // 删除的仅是本次写入的临时文件；不触碰其他历史临时文件或快照。
      try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* 原文件仍保留 */ }
    }
  }

  private persist(next: Database): void {
    const hadFile = existsSync(this.file)
    // 每天首笔修改前保留上一状态；快照失败时不覆盖主文件。
    if (hadFile) this.dailyBackup()
    this.writeAtomic(next)
    // 全新安装的首次写入也保留一份有效快照。
    if (!hadFile) {
      try { this.dailyBackup() } catch { /* 主数据已成功落盘，不能报告成写入失败 */ }
    }
    this.pruneDailyBackups()
  }

  private dailyBackup(): void {
    const d = new Date()
    const name = `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
    const target = join(this.backupDir, name)
    if (!existsSync(target)) copyFileSync(this.file, target, constants.COPYFILE_EXCL)
  }

  /** 只轮换每日快照；导入前留底不计入 7 份限额，也不会被删除。 */
  private pruneDailyBackups(): void {
    try {
      const backups = readdirSync(this.backupDir).filter(f => DAILY_BACKUP.test(f)).sort()
      while (backups.length > BACKUP_KEEP) {
        const oldest = backups.shift()
        if (oldest) unlinkSync(join(this.backupDir, oldest))
      }
    } catch { /* 清理失败不影响已成功持久化的数据 */ }
  }

  exportTo(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.db, null, 2), 'utf-8')
  }

  /** 导入前持久保留当前版本；验证或写入失败时内存与主文件均保持原状态。 */
  importFrom(filePath: string): Database {
    const next = readDatabase(filePath)
    if (existsSync(this.file)) {
      copyFileSync(this.file, join(this.backupDir, `data-before-import-${Date.now()}-${randomUUID()}.json`), constants.COPYFILE_EXCL)
    }
    this.persist(next)
    this.db = next
    for (const l of this.listeners) l()
    return this.db
  }
}
