// 今日计划由用户主动选择；历史计划可见，AI 只能提议，确认后才写入。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarClock, CalendarPlus, CheckCircle2, Flag, History, Loader2, Plus, Search, Sparkles, Sunrise, X } from 'lucide-react'
import type { Task } from '../../../shared/types'
import type { FocusSuggestion } from '../../../shared/ai-schema'
import type { FocusCandidate } from '../../../shared/ai-prompts'
import { addDays, formatDueLabel, isDuePast, startOfDay } from '../../../shared/datetime'
import { searchFocusCandidates, selectFocusTasks } from '../../../shared/focus'
import { PRIORITY_COLORS } from '../utils/ui'
import { useAiProgress } from '../utils/aiProgress'
import { useStore } from '../store'

function dueLabel(dueAt: string | null, now: Date): string {
  if (!dueAt) return '无截止'
  const days = Math.round((startOfDay(new Date(dueAt)).getTime() - startOfDay(now).getTime()) / 86400000)
  if (days < 0) return `已逾期${-days}天`
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  return `${days}天后到期`
}

interface SuggestState {
  phase: 'idle' | 'running' | 'ready' | 'error'
  items: FocusSuggestion[]
  dismissed: string[]
  error: string
}
const SUGGEST_IDLE: SuggestState = { phase: 'idle', items: [], dismissed: [], error: '' }
const actionBtn = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:hover:bg-zinc-800'

export default function FocusView(): JSX.Element {
  const db = useStore(s => s.db)!
  const setDone = useStore(s => s.setDone)
  const selectTask = useStore(s => s.selectTask)
  const setView = useStore(s => s.setView)
  const bumpQuickAdd = useStore(s => s.bumpQuickAdd)
  const planTasksDay = useStore(s => s.planTasksDay)
  const aiStatus = useStore(s => s.aiStatus)
  const aiReady = !!aiStatus && aiStatus.enabled && aiStatus.modelAvailable

  const [now, setNow] = useState(() => new Date())
  const { today, tomorrow, plan, done, carryover, overdue, candidates, total, progress } = useMemo(
    () => selectFocusTasks(db.tasks, now), [db.tasks, now]
  )
  const [showDone, setShowDone] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [candidateLimit, setCandidateLimit] = useState(12)
  const [suggest, setSuggest] = useState<SuggestState>(SUGGEST_IDLE)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const pickerButton = useRef<HTMLButtonElement>(null)
  const suggestRequest = useRef(0)
  const suggestProgress = useAiProgress(suggest.phase === 'running')
  const matchingCandidates = useMemo(() => searchFocusCandidates(candidates, query), [candidates, query])

  useEffect(() => {
    const refresh = (): void => setNow(new Date())
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      suggestRequest.current++
    }
  }, [])

  useEffect(() => {
    suggestRequest.current++
    setSuggest(SUGGEST_IDLE)
  }, [today])

  const runAction = async (action: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setActionError('')
    try {
      await action()
      return true
    } catch (e) {
      setActionError(`操作未保存，请重试：${e instanceof Error ? e.message : String(e)}`)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const movePlan = (ids: string[], day: string | null): void => {
    void runAction(() => planTasksDay(ids, day))
  }

  const startSuggest = (): void => {
    const in7 = addDays(now, 7).getTime()
    const aiCandidates: FocusCandidate[] = candidates
      .filter(t => (t.dueAt && new Date(t.dueAt).getTime() <= in7) || t.priority <= 2)
      .slice(0, 24)
      .map(t => ({ id: t.id, title: t.title.slice(0, 30), due: dueLabel(t.dueAt, now), priority: t.priority, planned: false }))
    if (aiCandidates.length === 0) {
      setSuggest({ ...SUGGEST_IDLE, phase: 'error', error: '没有 7 天内到期或 P1 / P2 的候选任务，可以直接手动选择。' })
      return
    }
    const request = ++suggestRequest.current
    setSuggest({ ...SUGGEST_IDLE, phase: 'running' })
    window.noticeme.aiFocusSuggest(aiCandidates)
      .then(r => {
        if (suggestRequest.current === request) setSuggest({ ...SUGGEST_IDLE, phase: 'ready', items: r.suggestions })
      })
      .catch(e => {
        if (suggestRequest.current === request) {
          setSuggest({ ...SUGGEST_IDLE, phase: 'error', error: e instanceof Error ? e.message : String(e) })
        }
      })
  }

  const closePicker = (): void => {
    setPickerOpen(false)
    pickerButton.current?.focus()
  }
  const newTask = (): void => {
    setView({ kind: 'all' })
    bumpQuickAdd()
  }

  const taskRow = (task: Task, mode: 'plan' | 'carryover' | 'overdue' | 'candidate' | 'done'): JSX.Element => {
    const late = !!task.dueAt && !task.done && isDuePast(task.dueAt, now)
    const project = db.projects.find(p => p.id === (task.projectId ?? 'inbox'))
    return (
      <div key={task.id} className="flex items-start gap-2.5 px-3.5 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <button
          onClick={() => void runAction(() => setDone(task.id, !task.done))}
          disabled={busy}
          role="checkbox"
          aria-checked={task.done}
          aria-label={`${task.done ? '标记未完成' : '完成任务'}：${task.title}`}
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40 ${task.done ? 'border-accent bg-accent text-white' : 'border-zinc-300 hover:border-accent dark:border-zinc-600'}`}
        >
          {task.done && <CheckCircle2 size={14} aria-hidden="true" />}
        </button>
        {!task.done && <Flag size={13} className="mt-1 shrink-0" aria-hidden="true" style={{ color: PRIORITY_COLORS[task.priority], fill: task.priority <= 2 ? PRIORITY_COLORS[task.priority] : 'none' }} />}
        <div className="min-w-0 flex-1">
          <button
            onClick={() => selectTask(task.id)}
            aria-label={`查看任务详情：${task.title}`}
            className={`block w-full break-words rounded text-left text-[13.5px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${task.done ? 'text-zinc-400 line-through' : 'font-medium hover:text-accent'}`}
          >{task.title}</button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-400">
            {task.dueAt && <span className={`inline-flex items-center gap-1 ${late ? 'font-medium text-red-500' : ''}`}><CalendarClock size={11} aria-hidden="true" />{formatDueLabel(task.dueAt, now)}</span>}
            {(mode === 'carryover' || mode === 'candidate') && task.plannedDay && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><History size={11} aria-hidden="true" />原计划 {task.plannedDay}</span>}
            {project && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />{project.name}</span>}
            {task.tags.map(tag => <span key={tag} className="max-w-full break-words rounded bg-zinc-100 px-1.5 py-px dark:bg-zinc-800">@{tag}</span>)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {mode !== 'plan' && mode !== 'done' && <button onClick={() => movePlan([task.id], today)} disabled={busy} className={actionBtn} title="加入今日计划" aria-label={`加入今日计划：${task.title}`}><CalendarPlus size={15} aria-hidden="true" /></button>}
          {(mode === 'plan' || mode === 'carryover') && <button onClick={() => movePlan([task.id], tomorrow)} disabled={busy} className={actionBtn} title="顺延到明天（不改截止时间）" aria-label={`顺延到明天：${task.title}`}><ArrowRight size={15} aria-hidden="true" /></button>}
          {(mode === 'plan' || mode === 'carryover' || mode === 'done') && <button onClick={() => movePlan([task.id], null)} disabled={busy} className={actionBtn + ' hover:!text-red-500'} title="移出计划（保留任务）" aria-label={`移出计划：${task.title}`}><X size={15} aria-hidden="true" /></button>}
        </div>
      </div>
    )
  }
  const liveSuggestions = suggest.items.filter(s => !suggest.dismissed.includes(s.taskId) && db.tasks.some(t => t.id === s.taskId && !t.done))

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-10 pt-2">
      <section className="mb-5 rounded-2xl border border-accent/15 bg-gradient-to-br from-accent/10 to-white p-5 dark:to-zinc-900" aria-label="今日计划进度">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-accent"><Sunrise size={15} aria-hidden="true" />给今天留一点专注</p>
            <h2 className="mt-2 text-lg font-semibold">{total === 0 ? '从一件想完成的事开始' : plan.length === 0 ? '今天的计划已全部完成' : `还有 ${plan.length} 件事，按自己的节奏来`}</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">主动安排今天要做的事，加入或顺延计划不会改变截止时间。</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="text-2xl font-semibold tabular-nums text-accent">{done.length}<span className="text-sm font-normal text-zinc-400"> / {total}</span></span>
            <p className="mt-0.5 text-[11px] text-zinc-400">今日计划已完成</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-accent/10" role="progressbar" aria-label="今日计划完成比例" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`今日计划完成 ${done.length} 项，共 ${total} 项`}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button ref={pickerButton} onClick={() => { setPickerOpen(v => !v); setCandidateLimit(12) }} className="btn-primary text-[13px]" aria-expanded={pickerOpen} aria-controls={pickerOpen ? 'focus-candidates' : undefined}><Plus size={15} aria-hidden="true" />选择任务</button>
        <button onClick={newTask} className="btn-ghost text-[13px]"><Plus size={14} aria-hidden="true" />新建任务</button>
        <button onClick={startSuggest} disabled={!aiReady || suggest.phase === 'running'} className="btn-ghost text-[13px] disabled:opacity-40" title={!aiReady ? '可选：在设置中启用本地 AI 并下载模型' : '本地 AI 从近期和高优先级任务中提议，确认后加入'}>
          {suggest.phase === 'running' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          {suggest.phase === 'running' ? `整理中 ${suggestProgress.elapsed}s` : 'AI 帮我排今天'}
        </button>
        {plan.length > 0 && <button onClick={() => movePlan(plan.map(t => t.id), tomorrow)} disabled={busy} className="btn-ghost text-[12px] disabled:opacity-40" title="只顺延今日未完成计划，不修改截止时间"><ArrowRight size={13} aria-hidden="true" />未完成的顺延明天</button>}
      </div>
      {actionError && <div role="alert" className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-500">{actionError}</div>}

      {pickerOpen && <section id="focus-candidates" className="card mb-5 p-3" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closePicker() } }}>
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div><h3 className="text-[13px] font-semibold">加入今日计划</h3><p className="mt-0.5 text-[11px] text-zinc-400">按优先级和截止时间排列，点右侧 ＋ 加入；无需启用 AI。</p></div>
          <button onClick={closePicker} className={actionBtn} aria-label="关闭任务选择"><X size={15} aria-hidden="true" /></button>
        </div>
        <div className="relative mb-2"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" /><input autoFocus value={query} onChange={e => { setQuery(e.target.value); setCandidateLimit(12) }} aria-label="搜索待选任务" placeholder="搜索标题、备注或标签…" className="input pl-9" /></div>
        <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
          {matchingCandidates.slice(0, candidateLimit).map(t => taskRow(t, 'candidate'))}
          {matchingCandidates.length === 0 && <div className="px-4 py-6 text-center text-xs text-zinc-400">{query.trim() ? '没有匹配的待选任务，试试其他关键词。' : '待办都已加入今天，或还没有任务。可以先新建一件。'}</div>}
        </div>
        {matchingCandidates.length > candidateLimit && <button onClick={() => setCandidateLimit(v => v + 20)} className="btn-ghost mt-2 w-full text-xs">继续查看（剩余 {matchingCandidates.length - candidateLimit} 项）</button>}
      </section>}

      {suggest.phase === 'error' && <div role="status" className="mb-4 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">AI 建议暂不可用：{suggest.error}</div>}
      {suggest.phase === 'ready' && <section className="card mb-5 p-3" aria-label="AI 计划建议">
        <div className="mb-2 flex items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"><Sparkles size={13} className="text-accent" aria-hidden="true" />AI 建议 · 确认后才加入计划</h3><button onClick={() => { suggestRequest.current++; setSuggest(SUGGEST_IDLE) }} className={actionBtn} aria-label="收起 AI 建议"><X size={14} aria-hidden="true" /></button></div>
        {liveSuggestions.length === 0 && <p className="px-1 py-2 text-xs text-zinc-400">暂时没有其他建议。也可以自己选择今天想做的事。</p>}
        <div className="space-y-1">{liveSuggestions.map(s => {
          const task = db.tasks.find(t => t.id === s.taskId)!
          const added = task.plannedDay === today
          return <div key={s.taskId} className="flex items-start gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/50">
            <div className="min-w-0 flex-1"><button onClick={() => selectTask(task.id)} className="w-full break-words text-left text-[13px] hover:text-accent">{task.title}</button>{s.reason && <p className="mt-0.5 break-words text-[11px] text-zinc-400">{s.reason}</p>}</div>
            {added ? <span className="py-2 text-[11px] text-emerald-600 dark:text-emerald-400">已加入</span> : <button onClick={() => movePlan([task.id], today)} disabled={busy} className={actionBtn} title="加入今日计划" aria-label={`接受 AI 建议：${task.title}`}><CalendarPlus size={14} aria-hidden="true" /></button>}
            <button onClick={() => setSuggest(p => ({ ...p, dismissed: [...p.dismissed, s.taskId] }))} className={actionBtn} title="忽略建议" aria-label={`忽略 AI 建议：${task.title}`}><X size={14} aria-hidden="true" /></button>
          </div>
        })}</div>
      </section>}

      <section aria-labelledby="focus-plan-title">
        <h3 id="focus-plan-title" className="mb-2 px-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">今日计划 <span className="ml-1 font-normal tabular-nums text-zinc-400">{plan.length}</span></h3>
        {plan.length === 0 ? <div className="rounded-card border border-dashed border-zinc-200 px-4 py-7 text-center dark:border-zinc-800">
          <CheckCircle2 size={27} className="mx-auto mb-2 text-accent/60" aria-hidden="true" />
          <p className="text-[13px] font-medium">{total ? '计划里的事都做完了，给自己一点空闲。' : '今天想先完成哪一件事？'}</p>
          <p className="mt-1 text-xs text-zinc-400">{total ? '需要继续安排时，可以再选一件。' : '从已有待办里选择，或新建一项，不必一次排满。'}</p>
          <button onClick={() => setPickerOpen(true)} className="btn-ghost mt-3 text-xs text-accent"><CalendarPlus size={13} aria-hidden="true" />从待办中选择</button>
        </div> : <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">{plan.map(t => taskRow(t, 'plan'))}</div>}
      </section>

      {carryover.length > 0 && <section className="mt-5" aria-labelledby="focus-carryover-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1"><div><h3 id="focus-carryover-title" className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-600 dark:text-amber-400"><History size={13} aria-hidden="true" />之前的计划还没做完（{carryover.length}）</h3><p className="mt-0.5 text-[11px] text-zinc-400">保留原计划日期，由你决定带回今天、顺延或移出计划。</p></div><button onClick={() => movePlan(carryover.map(t => t.id), today)} disabled={busy} className="btn-ghost text-xs text-accent disabled:opacity-40"><CalendarPlus size={13} aria-hidden="true" />全部带回今天</button></div>
        <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">{carryover.map(t => taskRow(t, 'carryover'))}</div>
      </section>}

      {overdue.length > 0 && <section className="mt-5" aria-labelledby="focus-overdue-title"><h3 id="focus-overdue-title" className="mb-2 px-1 text-[13px] font-semibold text-red-500">已到期 · 尚未安排今天（{overdue.length}）</h3><div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">{overdue.map(t => taskRow(t, 'overdue'))}</div></section>}

      {done.length > 0 && <section className="mt-5"><button onClick={() => setShowDone(v => !v)} aria-expanded={showDone} aria-controls="focus-done" className="mb-2 flex w-full items-center justify-between rounded px-1 py-1 text-left text-[13px] font-semibold text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-zinc-400"><span>今日计划已完成（{done.length}）</span><span className="text-[11px] font-normal text-zinc-400">{showDone ? '收起' : '展开'}</span></button><div id="focus-done" hidden={!showDone} className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">{done.map(t => taskRow(t, 'done'))}</div></section>}
    </div>
  )
}
