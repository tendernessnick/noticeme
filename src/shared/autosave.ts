/** 按记录合并修改、串行写入。只提交脏字段，不用旧对象覆盖后台的完成/提醒状态。 */
export class AutosaveQueue<P extends object> {
  private pending = new Map<string, Partial<P>>()
  private writing = new Map<string, Partial<P>>()
  private jobs = new Map<string, Promise<boolean>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private errors = new Map<string, string>()
  private epochs = new Map<string, number>()
  private listeners = new Set<() => void>()

  constructor(private write: (id: string, patch: Partial<P>) => Promise<void>, private delay = 450) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void { for (const listener of this.listeners) listener() }

  patch(id: string): Partial<P> {
    return { ...this.writing.get(id), ...this.pending.get(id) }
  }

  get state(): 'saved' | 'pending' | 'saving' | 'error' {
    if (this.errors.size) return 'error'
    if (this.jobs.size) return 'saving'
    return this.pending.size ? 'pending' : 'saved'
  }

  get error(): string { return this.errors.values().next().value ?? '' }

  enqueue(id: string, patch: Partial<P>, immediate = false): void {
    this.pending.set(id, { ...this.pending.get(id), ...patch })
    this.errors.delete(id)
    this.clearTimer(id)
    this.emit()
    if (immediate) void this.flush(id)
    else this.timers.set(id, setTimeout(() => { void this.flush(id) }, this.delay))
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  async flush(id: string): Promise<boolean> {
    this.clearTimer(id)
    const previous = this.jobs.get(id)
    if (previous) {
      const ok = await previous
      return ok && this.pending.has(id) ? this.flush(id) : ok
    }
    const patch = this.pending.get(id)
    if (!patch) return true
    const epoch = this.epochs.get(id) ?? 0
    this.pending.delete(id)
    this.writing.set(id, patch)
    // 延后一微任务，确保同步抛错的适配器也在 jobs 登记后清理。
    const job = Promise.resolve().then(async () => {
      try {
        await this.write(id, patch)
        this.errors.delete(id)
        return true
      } catch (error) {
        if ((this.epochs.get(id) ?? 0) === epoch) {
          this.pending.set(id, { ...patch, ...this.pending.get(id) })
          this.errors.set(id, error instanceof Error ? error.message : String(error))
        }
        return false
      } finally {
        this.jobs.delete(id)
        this.writing.delete(id)
        this.emit()
      }
    })
    this.jobs.set(id, job)
    this.emit()
    return job
  }

  async flushAll(): Promise<boolean> {
    const ids = new Set([...this.pending.keys(), ...this.jobs.keys()])
    const results = await Promise.all([...ids].map(id => this.flush(id)))
    return results.every(Boolean)
  }

  /** 删除前取消尚未提交的修改，并等待已发出的写入完成，删除一定排在其后。 */
  async discard(id: string): Promise<void> {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1)
    this.clearTimer(id)
    this.pending.delete(id)
    this.errors.delete(id)
    this.emit()
    await this.jobs.get(id)
  }
}
