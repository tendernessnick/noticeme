// 提醒调度器：周期扫描 + 数据变更即刻唤醒
import type { Store } from './store'
import { collectFires, type FireItem } from '../shared/scheduler-core'

const TICK_MS = 5_000
const WAKE_MS = 400

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private wakeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly store: Store,
    private readonly onFire: (fires: FireItem[]) => void
  ) {}

  start(): void {
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.timer = null
    this.wakeTimer = null
  }

  /** 任务数据变化后尽快触发一轮扫描（去抖） */
  wake(): void {
    if (this.wakeTimer) return
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      this.tick()
    }, WAKE_MS)
  }

  private tick(): void {
    const db = this.store.get()
    const missedWindowMs = Math.max(0, db.settings.missedFireWindowMin) * 60_000
    const res = collectFires(db, Date.now(), missedWindowMs)
    if (res.fires.length === 0 && res.markFired.length === 0 && res.consumeSnoozes.length === 0) return
    this.store.mutate(d => {
      if (res.markFired.length) {
        d.firedKeys.push(...res.markFired)
        // 防重键上限，修剪最旧的
        if (d.firedKeys.length > 500) d.firedKeys = d.firedKeys.slice(-500)
      }
      if (res.consumeSnoozes.length) {
        const consumed = new Set(res.consumeSnoozes)
        d.snoozes = d.snoozes.filter(s => !consumed.has(s.id))
      }
    })
    if (res.fires.length) this.onFire(res.fires)
  }
}
