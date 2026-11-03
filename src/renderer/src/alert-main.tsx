// 提醒弹窗页面（无边框置顶窗口）
// 提示音由主进程在触发瞬间直接播放（系统级，更可靠）；本页只负责展示与操作，并回报实际高度让窗口贴合内容
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BellRing, X, Check, AlarmClockPlus, ExternalLink } from 'lucide-react'
import type { AlertEntry } from '../../shared/types'
import { formatDueLabel, formatSnoozeLabel, isDuePast } from '../../shared/datetime'
import { PRIORITY_COLORS } from './utils/ui'
import './index.css'

interface Payload {
  items: AlertEntry[]
  presets: number[]
}

const FALLBACK_PRESETS = [5, 10, 30, 60, 1440]

export default function AlertApp(): JSX.Element {
  const [payload, setPayload] = useState<Payload>({ items: [], presets: FALLBACK_PRESETS })
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 实测内容高度回报主进程 → 窗口精确贴合卡片、底边贴住任务栏
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      if (h > 0) void window.noticeme.alertResize(h)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    // 挂载时主动同步一次（防止加载期推送丢失）
    void window.noticeme
      .alertSync()
      .then(setPayload)
      .catch(() => undefined)
    window.noticeme.onAlertQueue(setPayload)
  }, [])

  const act = (type: 'complete' | 'snooze' | 'open' | 'dismiss', taskId: string, minutes?: number): void => {
    void window.noticeme.alertAction({ type, taskId, minutes })
    setSnoozeOpen(null)
  }

  return (
    <div ref={rootRef} className="select-none p-2 font-sans text-[13px] text-zinc-100">
      <div className="overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900/95 shadow-pop backdrop-blur">
        <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
          <BellRing size={13} className="text-accent" />
          <span className="text-[11px] font-semibold tracking-wide text-zinc-400">NoticeMe 提醒</span>
          <span className="ml-auto text-[11px] text-zinc-500">{payload.items.length} 条</span>
        </div>
        <div className="max-h-[520px] space-y-1.5 overflow-y-auto px-2 pb-2 pt-1">
          {payload.items.map(item => {
            const overdue = item.dueAt ? isDuePast(item.dueAt) : false
            return (
              <div
                key={item.taskId}
                className="rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-3 py-2.5 animate-slideUp"
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                    style={{ background: PRIORITY_COLORS[item.priority] }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13.5px] font-medium leading-snug">{item.title}</div>
                    <div className={`mt-0.5 text-[11px] ${overdue ? 'font-medium text-red-400' : 'text-zinc-400'}`}>
                      {item.dueAt ? formatDueLabel(item.dueAt) : `提醒 · ${formatDueLabel(item.fireAt)}`}
                      {overdue ? ' · 已逾期' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => act('dismiss', item.taskId)}
                    className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-300"
                    title="关闭"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 pl-4">
                  <button onClick={() => act('complete', item.taskId)} className="btn-primary !px-3 !py-1 text-xs">
                    <Check size={12} /> 完成
                  </button>
                  <button
                    onClick={() => setSnoozeOpen(snoozeOpen === item.taskId ? null : item.taskId)}
                    className="btn !bg-zinc-700/70 !py-1 text-xs text-zinc-200 hover:!bg-zinc-700"
                  >
                    <AlarmClockPlus size={12} /> 稍后
                  </button>
                  <button onClick={() => act('open', item.taskId)} className="btn-ghost !py-1 text-xs !text-zinc-400 hover:!text-zinc-200">
                    <ExternalLink size={12} /> 打开
                  </button>
                </div>
                {snoozeOpen === item.taskId && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-4 animate-fadeIn">
                    {payload.presets.map(m => (
                      <button
                        key={m}
                        onClick={() => act('snooze', item.taskId, m)}
                        className="chip bg-zinc-700/60 text-zinc-200 hover:bg-accent hover:text-white"
                      >
                        {formatSnoozeLabel(m)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {payload.items.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">暂无提醒</div>
          )}
        </div>
      </div>
    </div>
  )
}
