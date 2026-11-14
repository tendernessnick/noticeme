import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutosaveQueue } from '../src/shared/autosave'

interface RecordPatch { title: string; content: string; pinned: boolean; done: boolean }
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

afterEach(() => vi.useRealTimers())

describe('编辑器自动保存的用户操作顺序', () => {
  it('快速从 A 切到 B 输入，两条记录都保存，不互相取消', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => {})
    const queue = new AutosaveQueue<RecordPatch>(write)
    queue.enqueue('A', { content: 'A最后一行' })
    void queue.flush('A') // 离开 A
    queue.enqueue('B', { content: 'B第一行' })
    await vi.advanceTimersByTimeAsync(500)
    expect(write.mock.calls).toEqual([['A', { content: 'A最后一行' }], ['B', { content: 'B第一行' }]])
    expect(queue.state).toBe('saved')
  })

  it('输入正文后立即置顶，正文与置顶合并且旧计时器不会回滚', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => {})
    const queue = new AutosaveQueue<RecordPatch>(write)
    queue.enqueue('A', { content: '最新正文' })
    queue.enqueue('A', { pinned: true }, true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(write.mock.calls).toEqual([['A', { content: '最新正文', pinned: true }]])
  })

  it('延迟修改只提交编辑过的字段，后台完成状态保留', async () => {
    vi.useFakeTimers()
    const persisted = { title: '任务', content: '旧备注', done: false, pinned: false }
    const queue = new AutosaveQueue<RecordPatch>(async (_id, patch) => { Object.assign(persisted, patch) })
    queue.enqueue('A', { content: '最新备注' })
    persisted.done = true // 提醒卡片在保存前完成任务
    await vi.advanceTimersByTimeAsync(500)
    expect(persisted).toEqual({ title: '任务', content: '最新备注', done: true, pinned: false })
  })

  it('删除取消尚未发出的修改，旧计时器不会重新创建记录', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => {})
    const queue = new AutosaveQueue<RecordPatch>(write)
    queue.enqueue('A', { content: '待保存' })
    await queue.discard('A')
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).not.toHaveBeenCalled()
    expect(queue.patch('A')).toEqual({})
  })

  it('删除等待已发出的写入结束，删除成为最后一个操作', async () => {
    const actions: string[] = []
    let finish!: () => void
    const queue = new AutosaveQueue<RecordPatch>(async () => {
      actions.push('write-start')
      await new Promise<void>(resolve => { finish = resolve })
      actions.push('write-done')
    })
    queue.enqueue('A', { content: '待保存' }, true)
    await settle()
    const deletion = queue.discard('A').then(() => { actions.push('delete') })
    expect(actions).toEqual(['write-start'])
    finish()
    await deletion
    expect(actions).toEqual(['write-start', 'write-done', 'delete'])
  })

  it('保存失败仍保留草稿，重试时合并用户之后的修改', async () => {
    vi.useFakeTimers()
    const write = vi.fn<(id: string, patch: Partial<RecordPatch>) => Promise<void>>()
      .mockRejectedValueOnce(new Error('磁盘写入失败'))
      .mockResolvedValue(undefined)
    const queue = new AutosaveQueue<RecordPatch>(write)
    queue.enqueue('A', { content: '不能丢失的正文' })
    expect(await queue.flushAll()).toBe(false)
    expect(queue.state).toBe('error')
    expect(queue.error).toBe('磁盘写入失败')
    expect(queue.patch('A')).toEqual({ content: '不能丢失的正文' })
    queue.enqueue('A', { pinned: true })
    expect(await queue.flushAll()).toBe(true)
    expect(write).toHaveBeenLastCalledWith('A', { content: '不能丢失的正文', pinned: true })
    expect(queue.state).toBe('saved')
  })

  it('旧写入尚未结束时的新输入按顺序保存，失败不盖掉新内容', async () => {
    vi.useFakeTimers()
    let rejectFirst!: (error: Error) => void
    const write = vi.fn<(id: string, patch: Partial<RecordPatch>) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject }))
      .mockResolvedValue(undefined)
    const queue = new AutosaveQueue<RecordPatch>(write)
    queue.enqueue('A', { content: '第一版' }, true)
    await settle()
    queue.enqueue('A', { content: '第二版', pinned: true })
    rejectFirst(new Error('磁盘忙'))
    await settle()
    expect(queue.patch('A')).toEqual({ content: '第二版', pinned: true })
    expect(await queue.flushAll()).toBe(true)
    expect(write).toHaveBeenLastCalledWith('A', { content: '第二版', pinned: true })
  })

  it('取消后正在保存的操作失败，不会把已删除草稿重新加入队列', async () => {
    let rejectWrite!: (error: Error) => void
    const queue = new AutosaveQueue<RecordPatch>(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject }))
    queue.enqueue('A', { content: '待删除' }, true)
    await settle()
    const deletion = queue.discard('A')
    rejectWrite(new Error('磁盘忙'))
    await deletion
    expect(queue.state).toBe('saved')
    expect(queue.patch('A')).toEqual({})
  })
})
