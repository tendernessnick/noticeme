// 今日聚焦：每天重置的主动规划清单（与截止日无关）。
// AI 建议仅供预览确认（点 ⊕ 才入库），绝不自动改动任务——同提取待办的产品红线
import { useMemo, useState } from 'react'
import { ArrowRight, CalendarPlus, Flag, Loader2, Sparkles, X } from 'lucide-react'
import type { Task } from '../../../shared/types'
import type { FocusSuggestion } from '../../../shared/ai-schema'
import type { FocusCandidate } from '../../../shared/ai-prompts'
import { localToday } from '../../../shared/defaults'
import { formatDueLabel, isDuePast, startOfDay } from '../../../shared/datetime'
import { PRIORITY_COLORS } from '../utils/ui'
import { useAiProgress } from '../utils/aiProgress'
import { useStore } from '../store'

/** 紧凑截止描述（喂给 AI 候选行）：已逾期2天 / 今天到期 / 明天到期 / 3天后到期 / 无截止 */
function dueLabel(dueAt: string | null): string {
  if (!dueAt) return '无截止'
  const days = Math.round((startOfDay(new Date(dueAt)).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (days < 0) return `已逾期${-days}天`
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  return `${days}天后到期`
}

interface SuggestState {
  phase: 'idle' | 'running' | 'ready' | 'error'
  items: FocusSuggestion[]
  added: string[]
  dismissed: string[]
  error: string
}

const SUGGEST_IDLE: SuggestState = { phase: 'idle', items: [], added: [], dismissed: [], error: '' }

export default function FocusView(): JSX.Element {
  const db = useStore(s => s.db)!
  const setDone = useStore(s => s.setDone)
  const planTasksDay = useStore(s => s.planTasksDay)
  const aiStatus = useStore(s => s.aiStatus)
  const aiReady = !!aiStatus && aiStatus.enabled && aiStatus.modelAvailable

  const today = localToday()
  const tomorrow = localToday(new Date(Date.now() + 86400000))

  const [showDone, setShowDone] = useState(false)
  const [suggest, setSuggest] = useState<SuggestState>(SUGGEST_IDLE)
  const suggestProgress = useAiProgress(suggest.phase === 'running')

  // 今日计划：优先级 → 截止 → 手动顺序
  const plan = useMemo(
    () =>
      db.tasks
        .filter(t => !t.done && t.plannedDay === today)
        .sort(
          (a, b) =>
            a.priority - b.priority ||
            (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') ||
            a.order - b.order
        ),
    [db.tasks, today]
  )
  const doneToday = useMemo(() => db.tasks.filter(t => t.done && t.plannedDay === today), [db.tasks, today])
  const overdue = useMemo(
    () =>
      db.tasks
        .filter(t => !t.done && t.dueAt && isDuePast(t.dueAt) && t.plannedDay !== today)
        .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    [db.tasks, today]
  )

  const visibleSuggestions = suggest.items.filter(s => !suggest.dismissed.includes(s.taskId) && !suggest.added.includes(s.taskId))

  const startSuggest = (): void => {
    // 候选：7 天内到期 或 高优先级（p1/p2），未在今日计划中，上限 24 条保住小模型上下文
    const in7 = Date.now() + 7 * 86400000
    const candidates: FocusCandidate[] = db.tasks
      .filter(t => !t.done && t.plannedDay !== today)
      .filter(t => (t.dueAt && new Date(t.dueAt).getTime() <= in7) || t.priority <= 2)
      .slice(0, 24)
      .map(t => ({ id: t.id, title: t.title.slice(0, 30), due: dueLabel(t.dueAt), priority: t.priority, planned: false }))
    if (candidates.length === 0) {
      setSuggest({ ...SUGGEST_IDLE, phase: 'error', error: '没有可安排的候选任务（7 天内到期或 p1/p2 优先级）' })
      return
    }
    setSuggest({ phase: 'running', items: [], added: [], dismissed: [], error: '' })
    window.noticeme
      .aiFocusSuggest(candidates)
      .then(r => setSuggest(p => (p.phase === 'running' ? { ...p, phase: 'ready', items: r.suggestions } : p)))
      .catch(e =>
        setSuggest(p =>
          p.phase === 'running' ? { ...p, phase: 'error', error: e instanceof Error ? e.message : String(e) } : p
        )
      )
  }

  const addToPlan = async (id: string): Promise<void> => {
    await planTasksDay([id], today)
    setSuggest(p => ({ ...p, added: [...p.added, id] }))
  }

  const dismiss = (id: string): void => {
    setSuggest(p => ({ ...p, dismissed: [...p.dismissed, id] }))
  }

  const deferTomorrow = async (): Promise<void> => {
    if (plan.length === 0) return
    await planTasksDay(plan.map(t => t.id), tomorrow)
  }

  // ---------- 行渲染（计划 / 逾期 / 已完成 三种形态共用骨架） ----------
  const metaOf = (t: Task): JSX.Element => {
    const overdueDue = !!t.dueAt && isDuePast(t.dueAt)
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
        {t.dueAt && (
          <span className={`inline-flex items-center gap-1 ${overdueDue ? 'font-medium text-red-500' : 'text-zinc-400'}`}>
            <CalendarPlus size={11} className="rotate-45" />
            {formatDueLabel(t.dueAt)}
          </span>
        )}
        {t.tags.map(tg => (
          <span key={tg} className="rounded bg-zinc-100 px-1.5 py-[1px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            @{tg}
          </span>
        ))}
      </div>
    )
  }

  const checkboxOf = (t: Task): JSX.Element => (
    <button
      onClick={e => {
        e.stopPropagation()
        void setDone(t.id, !t.done)
      }}
      className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border-2 transition ${
        t.done ? 'border-accent bg-accent text-white' : 'border-zinc-300 hover:border-accent dark:border-zinc-600'
      }`}
      title={t.done ? '标记未完成' : '完成'}
    >
      {t.done && (
        <svg viewBox="0 0 12 12" className="check-pop h-3 w-3" fill="none">
          <path d="M2 6.2L4.8 9L10 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )

  const hoverBtn = 'rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-200/70 dark:hover:bg-zinc-700'

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-10">
      {/* 操作条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={startSuggest}
          disabled={!aiReady || suggest.phase === 'running'}
          className="btn-primary !py-1.5 text-[13px] disabled:opacity-50"
          title={!aiReady ? '需在设置中启用本地 AI 并下载模型' : '让本地 AI 从逾期与近期任务中挑选今天值得做的'}
        >
          {suggest.phase === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {suggest.phase === 'running' ? `整理中 ${suggestProgress.elapsed}s` : 'AI 帮我排今天'}
        </button>
        {plan.length > 0 && (
          <button
            onClick={() => void deferTomorrow()}
            className="btn !py-1.5 text-[13px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            title={`把 ${plan.length} 条未完成的计划顺延到明天`}
          >
            <ArrowRight size={13} /> 没做完的顺延明天
          </button>
        )}
        {!aiReady && <span className="text-[11px] text-zinc-400">AI 建议需在设置中启用本地 AI</span>}
      </div>

      {/* AI 建议面板 */}
      {suggest.phase === 'error' && (
        <div className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-500 animate-fadeIn">
          排程失败：{suggest.error}
        </div>
      )}
      {suggest.phase === 'ready' && visibleSuggestions.length === 0 && suggest.added.length === 0 && (
        <div className="mb-4 rounded-card border border-zinc-200/70 bg-white px-3 py-2 text-[12px] text-zinc-400 shadow-soft animate-fadeIn dark:border-zinc-800 dark:bg-zinc-900">
          AI 看了一圈：今天没有特别值得加进来的任务，轻松一点 🙂
        </div>
      )}
      {(visibleSuggestions.length > 0 || suggest.added.length > 0) && suggest.phase === 'ready' && (
        <div className="mb-4 rounded-card border border-zinc-200/70 bg-white p-2.5 shadow-soft animate-fadeIn dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <Sparkles size={12} className="text-accent" />
              AI 建议（点 ⊕ 才会加入计划）
            </span>
            <button onClick={() => setSuggest(SUGGEST_IDLE)} className="text-zinc-400 hover:text-accent" title="收起">
              <X size={12} />
            </button>
          </div>
          <div className="space-y-1">
            {suggest.items.map(s => {
              if (suggest.dismissed.includes(s.taskId)) return null
              const t = db.tasks.find(x => x.id === s.taskId)
              if (!t) return null
              const added = suggest.added.includes(s.taskId)
              return (
                <div key={s.taskId} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/50">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                  {s.reason && <span className="chip shrink-0 bg-accent/10 text-accent">{s.reason}</span>}
                  {added ? (
                    <span className="shrink-0 text-[11px] text-emerald-500">已加入</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => void addToPlan(s.taskId)}
                        className={hoverBtn + ' hover:text-accent'}
                        title="加入今日计划"
                      >
                        <CalendarPlus size={13} />
                      </button>
                      <button onClick={() => dismiss(s.taskId)} className={hoverBtn + ' hover:text-red-500'} title="忽略这条建议">
                        <X size={13} />
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 今日计划 */}
      <section className="mt-1">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">今日计划（{plan.length}）</h3>
        </div>
        {plan.length === 0 ? (
          <div className="rounded-card border border-dashed border-zinc-200 px-4 py-6 text-center text-[13px] text-zinc-400 dark:border-zinc-800">
            今天还没有计划——从下方逾期任务加入，或点「AI 帮我排今天」
          </div>
        ) : (
          <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {plan.map(t => (
              <div
                key={t.id}
                className="group flex items-start gap-2.5 px-3.5 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                {checkboxOf(t)}
                {!t.done && (
                  <Flag
                    size={14}
                    className="mt-[5px] shrink-0"
                    style={{ color: PRIORITY_COLORS[t.priority], fill: t.priority <= 2 ? PRIORITY_COLORS[t.priority] : 'none' }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium leading-snug">{t.title}</div>
                  {metaOf(t)}
                </div>
                <div className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => void planTasksDay([t.id], tomorrow)} className={hoverBtn + ' hover:text-accent'} title="顺延到明天">
                    <ArrowRight size={13} />
                  </button>
                  <button onClick={() => void planTasksDay([t.id], null)} className={hoverBtn + ' hover:text-red-500'} title="移出今日计划">
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 已逾期 */}
      {overdue.length > 0 && (
        <section className="mt-4">
          <div className="mb-1.5 px-1">
            <h3 className="text-[13px] font-semibold text-red-500">已逾期（{overdue.length}）</h3>
          </div>
          <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {overdue.map(t => (
              <div
                key={t.id}
                className="group flex items-start gap-2.5 px-3.5 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                {checkboxOf(t)}
                <Flag
                  size={14}
                  className="mt-[5px] shrink-0"
                  style={{ color: PRIORITY_COLORS[t.priority], fill: t.priority <= 2 ? PRIORITY_COLORS[t.priority] : 'none' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium leading-snug">{t.title}</div>
                  {metaOf(t)}
                </div>
                <div className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => void planTasksDay([t.id], today)}
                    className={hoverBtn + ' hover:text-accent'}
                    title="加入今日计划"
                  >
                    <CalendarPlus size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 今日已完成 */}
      {doneToday.length > 0 && (
        <section className="mt-4">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">今日已完成（{doneToday.length}）</h3>
            <button onClick={() => setShowDone(v => !v)} className="text-[11px] text-zinc-400 hover:text-accent">
              {showDone ? '收起' : '展开'}
            </button>
          </div>
          {showDone && (
            <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {doneToday.map(t => (
                <div
                  key={t.id}
                  className="group flex items-start gap-2.5 px-3.5 py-2.5 opacity-55 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  {checkboxOf(t)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] leading-snug text-zinc-400 line-through">{t.title}</div>
                  </div>
                  <div className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => void planTasksDay([t.id], null)} className={hoverBtn + ' hover:text-red-500'} title="移出今日计划">
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
