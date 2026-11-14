import { useEffect, useState } from 'react'
import { AutosaveQueue } from '../../../shared/autosave'

// 队列随渲染进程保留：切换板块后，失败的草稿仍可回来重试。
const queues = new Map<string, AutosaveQueue<object>>()
let unloadGuardInstalled = false
let flushingForClose = false

/** 导入/导出/启动安装器前先保存所有板块的会话草稿；失败时调用方必须中断操作。 */
export async function flushEditorDrafts(): Promise<boolean> {
  const results = await Promise.all([...queues.values()].map(queue => queue.flushAll()))
  return results.every(Boolean)
}

function installUnloadGuard(): void {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', event => {
    const unsaved = [...queues.values()].filter(queue => queue.state !== 'saved')
    if (!unsaved.length) return
    // Electron 不会等待异步 beforeunload；必须先取消关闭，落盘成功后再请求关闭。
    event.preventDefault()
    event.returnValue = false
    if (flushingForClose) return
    flushingForClose = true
    void Promise.all(unsaved.map(queue => queue.flushAll())).then(results => {
      flushingForClose = false
      if (results.every(Boolean)) window.close()
      else window.alert('仍有修改未保存，已取消关闭。请回到编辑器重试保存；当前会话的草稿仍保留。')
    })
  })
}

export function useAutosave<T extends { id: string }>(
  scope: string,
  record: T | null,
  write: (id: string, patch: Partial<T>) => Promise<void>
) {
  const [queue] = useState(() => {
    let existing = queues.get(scope)
    if (!existing) {
      existing = new AutosaveQueue<object>(write as (id: string, patch: object) => Promise<void>)
      queues.set(scope, existing)
    }
    return existing as AutosaveQueue<T>
  })
  const [, update] = useState(0)

  useEffect(() => queue.subscribe(() => update(n => n + 1)), [queue])
  useEffect(() => {
    const id = record?.id
    return () => { if (id) void queue.flush(id) }
  }, [queue, record?.id])
  useEffect(() => {
    installUnloadGuard()
    return () => { void queue.flushAll() }
  }, [queue])

  return {
    draft: record ? { ...record, ...queue.patch(record.id) } as T : null,
    state: queue.state,
    error: queue.error,
    save: (patch: Partial<T>): void => { if (record) queue.enqueue(record.id, patch, true) },
    saveDebounced: (patch: Partial<T>): void => { if (record) queue.enqueue(record.id, patch) },
    flush: (): Promise<boolean> => queue.flushAll(),
    discard: (): Promise<void> => record ? queue.discard(record.id) : Promise.resolve()
  }
}
