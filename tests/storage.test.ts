// 存储层测试：读写往返 / 原子写入 / 备份 / 导入导出 / 损坏恢复
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, utimesSync, unlinkSync, renameSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/main/store'
import { createDefaultDb, DEFAULT_NOTE_FOLDER_ID, newNote, newTask } from '../src/shared/defaults'

vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, renameSync: vi.fn(original.renameSync), copyFileSync: vi.fn(original.copyFileSync) }
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noticeme-store-'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Store', () => {
  it('首次初始化 → 默认数据（收集箱 + 欢迎任务 + 欢迎日记 + 默认笔记文件夹 + 默认设置）', () => {
    const store = new Store(dir)
    const db = store.get()
    expect(db.projects.some(p => p.id === 'inbox')).toBe(true)
    expect(db.tasks).toHaveLength(1)
    expect(db.entries).toHaveLength(1)
    expect(db.entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(db.noteFolders.some(f => f.id === DEFAULT_NOTE_FOLDER_ID)).toBe(true)
    expect(db.notes).toHaveLength(0)
    expect(db.settings.notifyMode).toBe('card')
    expect(db.settings.snoozePresets).toContain(10)
  })

  it('笔记模块迁移：旧数据无 notes/noteFolders → 补默认文件夹与空数组；folderId 失效的笔记归入默认', () => {
    // 0.4.x 旧格式：没有 notes / noteFolders 字段
    writeFileSync(
      join(dir, 'data.json'),
      JSON.stringify({
        version: 1,
        tasks: [{ id: 't1', title: '旧任务' }],
        projects: [{ id: 'inbox', name: '收集箱', color: '#6366f1', createdAt: '2026-01-01T00:00:00.000Z' }],
        settings: { notifyMode: 'card' }
      }),
      'utf-8'
    )
    const store = new Store(dir)
    const db = store.get()
    expect(db.noteFolders.some(f => f.id === DEFAULT_NOTE_FOLDER_ID)).toBe(true)
    expect(db.notes).toHaveLength(0)

    // 有笔记但 folderId 指向不存在的文件夹 → 迁移时移入默认文件夹
    const dir2 = mkdtempSync(join(tmpdir(), 'noticeme-store-'))
    const store2 = new Store(dir2)
    store2.mutate(d => {
      d.notes.push(newNote({ id: 'n1', title: '会议记录', content: '正文', folderId: 'ghost-folder' }))
    })
    const store3 = new Store(dir2)
    expect(store3.get().notes).toHaveLength(1)
    expect(store3.get().notes[0].folderId).toBe(DEFAULT_NOTE_FOLDER_ID)
    expect(store3.get().notes[0].title).toBe('会议记录')
  })

  it('旧版本数据（无 entries 字段）迁移为空数组；含日记数据完整读回', () => {
    // 0.1.x 旧格式：没有 entries 字段
    writeFileSync(
      join(dir, 'data.json'),
      JSON.stringify({
        version: 1,
        tasks: [{ id: 't1', title: '旧任务' }],
        projects: [{ id: 'inbox', name: '收集箱', color: '#6366f1', createdAt: '2026-01-01T00:00:00.000Z' }],
        settings: { notifyMode: 'card' }
      }),
      'utf-8'
    )
    const store = new Store(dir)
    expect(store.get().entries).toHaveLength(0)
    expect(store.get().tasks.some(t => t.title === '旧任务')).toBe(true)
    // 旧任务无 plannedDay → 迁移补 null（未列入今日聚焦计划）
    expect(store.get().tasks.find(t => t.title === '旧任务')?.plannedDay).toBeNull()

    // 新格式：日记往返
    const dir2 = mkdtempSync(join(tmpdir(), 'noticeme-store-'))
    const store2 = new Store(dir2)
    const entry = {
      id: 'j1',
      title: '规划',
      content: '下周完成模糊匹配优化',
      mood: '🙂',
      tags: ['规划'],
      pinned: true,
      date: '2026-11-04',
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z'
    }
    store2.mutate(db => db.entries.push(entry))
    const store3 = new Store(dir2)
    const entries = store3.get().entries
    const roundtripped = entries.find(e => e.id === 'j1')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(roundtripped?.pinned).toBe(true)
    expect(roundtripped?.mood).toBe('🙂')
    expect(roundtripped?.date).toBe('2026-11-04')
  })

  it('旧版本设置（独立双开关）自动迁移为 notifyMode', () => {
    // 双开（旧行为会重复提醒）→ 收敛为仅卡片
    writeFileSync(
      join(dir, 'data.json'),
      JSON.stringify({
        version: 1,
        tasks: [{ id: 't1', title: '旧任务' }],
        projects: [{ id: 'inbox', name: '收集箱', color: '#6366f1', createdAt: '2026-01-01T00:00:00.000Z' }],
        settings: { notifyAlert: true, notifyToast: true }
      }),
      'utf-8'
    )
    const store = new Store(dir)
    expect(store.get().settings.notifyMode).toBe('card')
    expect(store.get().tasks.some(t => t.title === '旧任务')).toBe(true)

    // 仅系统通知 → toast
    const dir2 = mkdtempSync(join(tmpdir(), 'noticeme-store-'))
    writeFileSync(
      join(dir2, 'data.json'),
      JSON.stringify({
        version: 1,
        tasks: [],
        projects: [{ id: 'inbox', name: '收集箱', color: '#6366f1', createdAt: '2026-01-01T00:00:00.000Z' }],
        settings: { notifyAlert: false, notifyToast: true }
      }),
      'utf-8'
    )
    const store2 = new Store(dir2)
    expect(store2.get().settings.notifyMode).toBe('toast')
  })

  it('mutate 后持久化，重新加载可读回（往返）', () => {
    const store = new Store(dir)
    const t = newTask({ title: '往返测试' })
    store.mutate(db => db.tasks.push(t))

    const store2 = new Store(dir)
    expect(store2.get().tasks.some(x => x.id === t.id && x.title === '往返测试')).toBe(true)
  })

  it('数据文件存在（原子写入落盘）且无 .tmp 残留', () => {
    const store = new Store(dir)
    store.mutate(db => {
      db.settings.soundOn = false
    })
    expect(existsSync(join(dir, 'data.json'))).toBe(true)
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toHaveLength(0)
    expect(JSON.parse(readFileSync(join(dir, 'data.json'), 'utf-8')).settings.soundOn).toBe(false)
  })

  it('持久化时生成当日备份', () => {
    const store = new Store(dir)
    store.mutate(() => undefined)
    const backups = readdirSync(join(dir, 'backups')).filter(f => f.startsWith('data-'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it('损坏且无有效备份 → 停止启动并原样保留 data.json，禁止默认欢迎数据覆盖历史', () => {
    writeFileSync(join(dir, 'data.json'), '{oops not json', 'utf-8')
    expect(() => new Store(dir)).toThrow('已停止启动以保护历史数据')
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe('{oops not json')
  })

  it('exportTo / importFrom 往返', () => {
    const store = new Store(dir)
    const t = newTask({ title: '导出我' })
    store.mutate(db => db.tasks.push(t))
    const exportPath = join(dir, 'export.json')
    store.exportTo(exportPath)

    const dir2 = mkdtempSync(join(tmpdir(), 'noticeme-store-'))
    const store2 = new Store(dir2)
    // 先落盘一份旧数据，导入时才有留底对象
    store2.mutate(db => {
      db.tasks.push(newTask({ title: '旧数据' }))
    })
    store2.importFrom(exportPath)
    expect(store2.get().tasks.some(x => x.title === '导出我')).toBe(true)
    expect(store2.get().tasks.some(x => x.title === '旧数据')).toBe(false)
    // 导入前旧数据有留底
    expect(readdirSync(join(dir2, 'backups')).some(f => f.includes('before-import'))).toBe(true)
  })

  it('导入非法文件 → 抛错且数据不变', () => {
    const store = new Store(dir)
    const before = store.get().tasks.length
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, JSON.stringify({ hello: 1 }), 'utf-8')
    expect(() => store.importFrom(bad)).toThrow()
    expect(store.get().tasks.length).toBe(before)
  })

  it('onChange 在 mutate 时被通知', () => {
    const store = new Store(dir)
    let called = 0
    const off = store.onChange(() => {
      called++
    })
    store.mutate(() => undefined)
    off()
    store.mutate(() => undefined)
    expect(called).toBe(1)
  })

  it.each(['{oops not json', '{"hello":1}'])('损坏或结构无效的主文件从最新有效备份恢复，跳过损坏备份并保留原始字节：%s', corrupt => {
    const backupDir = join(dir, 'backups')
    mkdirSync(backupDir)
    const older = createDefaultDb()
    older.tasks = [newTask({ id: 'older', title: '较早的任务' })]
    const recent = createDefaultDb()
    recent.tasks = [newTask({ id: 'recent', title: '需要保留的任务', plannedDay: '2026-11-14' })]
    recent.notes = [newNote({ id: 'note-kept', title: '历史笔记', content: '完整原文' })]
    const olderPath = join(backupDir, 'data-2026-01-01.json')
    const recentPath = join(backupDir, 'data-before-import-123.json')
    const brokenPath = join(backupDir, 'data-2026-01-03.json')
    writeFileSync(olderPath, JSON.stringify(older))
    writeFileSync(recentPath, JSON.stringify(recent))
    writeFileSync(brokenPath, '{broken')
    utimesSync(olderPath, 100, 100)
    utimesSync(recentPath, 200, 200)
    utimesSync(brokenPath, 300, 300)
    writeFileSync(join(dir, 'data.json'), corrupt)

    const store = new Store(dir)
    expect(store.get().tasks).toEqual(recent.tasks)
    expect(store.get().notes).toEqual(recent.notes)
    expect(store.get().entries).toEqual(recent.entries)
    expect(store.recoveryInfo?.backupFile).toBe(recentPath)
    expect(readFileSync(store.recoveryInfo!.archivedFile!, 'utf-8')).toBe(corrupt)
    expect(JSON.parse(readFileSync(join(dir, 'data.json'), 'utf-8')).notes).toEqual(recent.notes)
    expect(new Store(dir).recoveryInfo).toBeNull()
    expect(readFileSync(recentPath, 'utf-8')).toBe(JSON.stringify(recent))
  })

  it('主文件丢失但有有效快照 → 自动恢复，不能当作全新安装', () => {
    const store = new Store(dir)
    store.mutate(db => db.tasks.push(newTask({ id: 'kept', title: '别丢我' })))
    unlinkSync(join(dir, 'data.json'))
    const recovered = new Store(dir)
    expect(recovered.get().tasks.some(task => task.id === 'kept')).toBe(true)
    expect(recovered.recoveryInfo?.archivedFile).toBeNull()
    expect(existsSync(join(dir, 'data.json'))).toBe(true)
  })

  it('主文件缺失且只有损坏快照或旧损坏留档 → 停止启动，不生成默认数据', () => {
    mkdirSync(join(dir, 'backups'))
    writeFileSync(join(dir, 'backups', 'data-2026-01-01.json'), '{bad')
    expect(() => new Store(dir)).toThrow('已停止启动以保护历史数据')
    expect(existsSync(join(dir, 'data.json'))).toBe(false)
    unlinkSync(join(dir, 'backups', 'data-2026-01-01.json'))
    writeFileSync(join(dir, 'data.json.corrupt-123'), '{old broken')
    expect(() => new Store(dir)).toThrow('已停止启动以保护历史数据')
    expect(existsSync(join(dir, 'data.json'))).toBe(false)
  })

  it('数据版本比应用新 → 明确拒绝，不能回滚到旧快照', () => {
    mkdirSync(join(dir, 'backups'))
    writeFileSync(join(dir, 'backups', 'data-2026-01-01.json'), JSON.stringify(createDefaultDb()))
    const newer = JSON.stringify({ ...createDefaultDb(), version: 999 })
    writeFileSync(join(dir, 'data.json'), newer)
    expect(() => new Store(dir)).toThrow('更新版本')
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe(newer)
  })

  it('每日第一笔修改的快照保存修改前的数据', () => {
    const original = createDefaultDb()
    original.tasks = [newTask({ id: 'important', title: '修改前历史' })]
    writeFileSync(join(dir, 'data.json'), JSON.stringify(original))
    const store = new Store(dir)
    store.mutate(db => { db.tasks = [] })
    const snapshot = readdirSync(join(dir, 'backups')).find(file => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(file))!
    expect(JSON.parse(readFileSync(join(dir, 'backups', snapshot), 'utf-8')).tasks).toEqual(original.tasks)
    expect(store.get().tasks).toEqual([])
  })

  it('轮换仅保留 7 份每日快照，所有导入前留底与其他历史文件原样保留', () => {
    const store = new Store(dir)
    const backupDir = join(dir, 'backups')
    for (let day = 1; day <= 8; day++) writeFileSync(join(backupDir, `data-2020-01-0${day}.json`), '{}')
    for (let i = 0; i < 12; i++) writeFileSync(join(backupDir, `data-before-import-${i}.json`), `history-${i}`)
    writeFileSync(join(backupDir, 'data-important-history.json'), 'retain')
    store.mutate(() => undefined)
    const files = readdirSync(backupDir)
    expect(files.filter(file => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(file))).toHaveLength(7)
    expect(files.filter(file => file.startsWith('data-before-import-'))).toHaveLength(12)
    expect(readFileSync(join(backupDir, 'data-important-history.json'), 'utf-8')).toBe('retain')
    for (let i = 0; i < 12; i++) expect(readFileSync(join(backupDir, `data-before-import-${i}.json`), 'utf-8')).toBe(`history-${i}`)
  })

  it('修改函数抛错 → 内存、主文件和监听者保持不变', () => {
    const store = new Store(dir)
    store.mutate(() => undefined)
    const before = structuredClone(store.get())
    const beforeFile = readFileSync(join(dir, 'data.json'), 'utf-8')
    const listener = vi.fn()
    store.onChange(listener)
    expect(() => store.mutate(db => { db.tasks = []; throw new Error('cancel') })).toThrow('cancel')
    expect(store.get()).toEqual(before)
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe(beforeFile)
    expect(listener).not.toHaveBeenCalled()
  })

  it('原子替换失败 → 内存、原文件和监听者保持不变，清除本次临时文件', () => {
    const store = new Store(dir)
    store.mutate(() => undefined)
    const before = structuredClone(store.get())
    const beforeFile = readFileSync(join(dir, 'data.json'), 'utf-8')
    const listener = vi.fn()
    store.onChange(listener)
    vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('disk write failed') })
    expect(() => store.mutate(db => { db.tasks = [] })).toThrow('disk write failed')
    expect(store.get()).toEqual(before)
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe(beforeFile)
    expect(listener).not.toHaveBeenCalled()
    expect(readdirSync(dir).filter(file => file.endsWith('.tmp'))).toHaveLength(0)
  })

  it('写前快照失败 → 不能覆盖主文件或发布内存状态', () => {
    const original = createDefaultDb()
    const beforeFile = JSON.stringify(original)
    writeFileSync(join(dir, 'data.json'), beforeFile)
    const store = new Store(dir)
    const before = structuredClone(store.get())
    vi.mocked(copyFileSync).mockImplementationOnce(() => { throw new Error('backup disk failed') })
    expect(() => store.mutate(db => { db.tasks = [] })).toThrow('backup disk failed')
    expect(store.get()).toEqual(before)
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe(beforeFile)
  })

  it('导入写入失败 → 当前数据仍完整，导入前留底也完整', () => {
    const store = new Store(dir)
    store.mutate(db => db.tasks.push(newTask({ id: 'old', title: '不能丢的当前任务' })))
    const before = structuredClone(store.get())
    const beforeFile = readFileSync(join(dir, 'data.json'), 'utf-8')
    const imported = createDefaultDb()
    imported.tasks = []
    const importPath = join(dir, 'import.json')
    writeFileSync(importPath, JSON.stringify(imported))
    vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('import disk failed') })
    expect(() => store.importFrom(importPath)).toThrow('import disk failed')
    expect(store.get()).toEqual(before)
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe(beforeFile)
    const archived = readdirSync(join(dir, 'backups')).find(file => file.startsWith('data-before-import-'))!
    expect(readFileSync(join(dir, 'backups', archived), 'utf-8')).toBe(beforeFile)
  })

  it('导入含损坏记录的备份 → 拒绝而非静默过滤记录', () => {
    const store = new Store(dir)
    store.mutate(() => undefined)
    const before = readFileSync(join(dir, 'data.json'), 'utf-8')
    const broken = { ...createDefaultDb(), tasks: [{ id: 'broken', title: null }] }
    const importPath = join(dir, 'broken-import.json')
    writeFileSync(importPath, JSON.stringify(broken))
    expect(() => store.importFrom(importPath)).toThrow('损坏记录')
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe(before)
  })

  it('补默认文件夹不能掩盖导入中被过滤的损坏文件夹', () => {
    const store = new Store(dir)
    const broken = { ...createDefaultDb(), noteFolders: [{ id: 'broken-folder', name: null }] }
    const importPath = join(dir, 'broken-folders.json')
    writeFileSync(importPath, JSON.stringify(broken))
    expect(() => store.importFrom(importPath)).toThrow('损坏记录')
    expect(store.get().noteFolders.some(folder => folder.id === DEFAULT_NOTE_FOLDER_ID)).toBe(true)
    expect(existsSync(join(dir, 'data.json'))).toBe(false)
  })

  it('恢复时原子替换失败 → 损坏主文件及恢复来源都原样保留', () => {
    mkdirSync(join(dir, 'backups'))
    const source = JSON.stringify(createDefaultDb())
    const backupPath = join(dir, 'backups', 'data-2026-01-01.json')
    writeFileSync(backupPath, source)
    writeFileSync(join(dir, 'data.json'), '{bad')
    vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('recovery write failed') })
    expect(() => new Store(dir)).toThrow('recovery write failed')
    expect(readFileSync(join(dir, 'data.json'), 'utf-8')).toBe('{bad')
    expect(readFileSync(backupPath, 'utf-8')).toBe(source)
    const archived = readdirSync(dir).find(file => file.startsWith('data.json.corrupt-'))!
    expect(readFileSync(join(dir, archived), 'utf-8')).toBe('{bad')
  })
})
