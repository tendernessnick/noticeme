// 存储层测试：读写往返 / 原子写入 / 备份 / 导入导出 / 损坏恢复
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/main/store'
import { newTask } from '../src/shared/defaults'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noticeme-store-'))
})

describe('Store', () => {
  it('首次初始化 → 默认数据（收集箱 + 欢迎任务 + 欢迎日记 + 默认设置）', () => {
    const store = new Store(dir)
    const db = store.get()
    expect(db.projects.some(p => p.id === 'inbox')).toBe(true)
    expect(db.tasks).toHaveLength(1)
    expect(db.entries).toHaveLength(1)
    expect(db.entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(db.settings.notifyMode).toBe('card')
    expect(db.settings.snoozePresets).toContain(10)
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

  it('损坏的 data.json → 自动降级为默认数据并留档', () => {
    writeFileSync(join(dir, 'data.json'), '{oops not json', 'utf-8')
    const store = new Store(dir)
    expect(store.get().tasks.length).toBeGreaterThan(0) // 默认欢迎任务
    expect(readdirSync(dir).some(f => f.includes('.corrupt-'))).toBe(true)
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
})
