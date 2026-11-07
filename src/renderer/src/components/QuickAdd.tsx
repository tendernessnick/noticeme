import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react'
import { Plus, CalendarClock, Flag, Hash, AtSign, Keyboard, Check, Loader2, ListChecks, Sparkles, X } from 'lucide-react'
import { parseQuickAdd, type ParsedQuickAdd } from '../../../shared/parse'
import { mergeQuickAdd, type TaskDraft } from '../../../shared/ai-schema'
import { newTask, uid, PROJECT_PALETTE } from '../../../shared/defaults'
import { formatDueLabel } from '../../../shared/datetime'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../utils/ui'
import { useAiProgress } from '../utils/aiProgress'
import { useStore } from '../store'

/** 快速添加完整语法速查（与 src/shared/parse.ts 保持同步） */
const SYNTAX_GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  {
    label: '相对日期',
    items: [
      ['今天 / 明天 / 后天 / 大后天', '当日 09:00 起'],
      ['今晚 · 今晚9点', '→ 20:00 · 21:00'],
      ['明早 / 明晚 / 今早', '→ 8:00 / 20:00 / 8:00']
    ]
  },
  {
    label: '周与锚点',
    items: [
      ['周X / 星期X / 礼拜X', '未来最近的该天 09:00'],
      ['下周X / 下下周X / 下周', '下周一 / 下下周一'],
      ['周末 / 下周末', '本周六 / 下周六'],
      ['月初 / 月中 / 月底 / 年底', '1号 / 15号 / 月末 / 12-31'],
      ['下个月 / 下个月15号', '下月同日 / 下月15号']
    ]
  },
  {
    label: '绝对日期',
    items: [
      ['11月9日 / 11月9 / 9号', '本月或未来最近的一月'],
      ['十九号（中文数字）', '同上'],
      ['2026-11-09 / 11/9', '按字面解析']
    ]
  },
  {
    label: '相对偏移',
    items: [
      ['30分钟后 / 10分钟内 / 5分钟之后', '当前时间 ±N 分钟'],
      ['2小时后 / 半小时后 / 2个小时内', '当前时间 ±N 小时'],
      ['两个钟头后 / 一刻钟后 / 三刻钟内', '钟头=小时 · 每刻=15 分钟'],
      ['3天后 / 三天之内', '3 天后 09:00']
    ]
  },
  {
    label: '时刻',
    items: [
      ['9点 / 九点半 / 9点30 / 14:30', '对应时刻'],
      ['10点一刻 / 八点三刻 / 9点整', '10:15 / 20:45 / 9:00'],
      ['早8点 / 晚10点', '8:00 / 22:00'],
      ['今晚10点', '→ 22:00（晚间语境）'],
      ['明天下午 / 晚上 / 上午', '时段默认 14:00 / 20:00 / 9:00']
    ]
  },
  {
    label: '优先级与组织',
    items: [
      ['p1~p4 / !1~!4', 'P1 最高'],
      ['紧急 / 重要', '→ P1'],
      ['高优先级 / 中优先级 / 低优先级', '→ P2 / P3 / P4'],
      ['#清单 · @标签', '清单不存在则自动创建']
    ]
  }
]

interface AiHintState {
  running: boolean
  /** AI 兜底后的合并解析结果 */
  merged: ParsedQuickAdd | null
  /** 合并结果里是否包含 AI 的贡献 */
  aiApplied: boolean
  ms: number
}

interface PasteCapture {
  state: 'loading' | 'ready' | 'error'
  error: string
  drafts: TaskDraft[]
  checked: boolean[]
}

export default function QuickAdd(): JSX.Element {
  const db = useStore(s => s.db)!
  const upsertTask = useStore(s => s.upsertTask)
  const addProject = useStore(s => s.addProject)
  const view = useStore(s => s.view)
  const aiStatus = useStore(s => s.aiStatus)
  const quickAddToken = useStore(s => s.quickAddToken)
  const [text, setText] = useState('')
  const [regexHint, setRegexHint] = useState<ParsedQuickAdd | null>(null)
  const [ai, setAi] = useState<AiHintState>({ running: false, merged: null, aiApplied: false, ms: 0 })
  const [paste, setPaste] = useState<PasteCapture | null>(null)
  const [syntaxOpen, setSyntaxOpen] = useState(false)
  /** 添加成功后的即时反馈（2 秒渐隐） */
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 在途的 AI 解析（Enter 提交时等待它，避免带时间的输入被吞掉时间） */
  const aiPromiseRef = useRef<Promise<void> | null>(null)
  /** AI 兜底请求的代际标记，忽略过期响应 */
  const aiGenRef = useRef(0)

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  useEffect(() => {
    if (quickAddToken > 0) inputRef.current?.focus()
  }, [quickAddToken])

  // 正则解析（主路径，确定性）
  useEffect(() => {
    const t = setTimeout(() => {
      setRegexHint(text.trim() ? parseQuickAdd(text) : null)
    }, 120)
    return () => clearTimeout(t)
  }, [text])

  const aiFallbackOn =
    !!aiStatus &&
    aiStatus.enabled &&
    aiStatus.quickAddFallback &&
    aiStatus.modelAvailable
  const aiRunProgress = useAiProgress(ai.running)
  const pasteProgress = useAiProgress(paste?.state === 'loading')

  // AI 兜底：正则没解析出截止时间时异步补解析（700ms 防抖）
  useEffect(() => {
    aiGenRef.current += 1
    const gen = aiGenRef.current
    if (!aiFallbackOn || !regexHint || regexHint.dueAt || text.trim().length < 4) {
      aiPromiseRef.current = null
      setAi({ running: false, merged: null, aiApplied: false, ms: 0 })
      return
    }
    setAi({ running: true, merged: null, aiApplied: false, ms: 0 })
    const promise = window.noticeme
      .aiParse(text.trim())
      .then(r => {
        if (gen !== aiGenRef.current) return
        if (r.draft) {
          const merged = mergeQuickAdd(regexHint, r.draft)
          const aiApplied =
            merged.title !== regexHint.title ||
            merged.dueAt !== regexHint.dueAt ||
            merged.projectName !== regexHint.projectName ||
            merged.priority !== regexHint.priority
          setAi({ running: false, merged, aiApplied, ms: r.ms })
        } else {
          setAi({ running: false, merged: null, aiApplied: false, ms: r.ms })
        }
      })
      .catch(() => {
        if (gen !== aiGenRef.current) return
        setAi({ running: false, merged: null, aiApplied: false, ms: 0 })
      })
    aiPromiseRef.current = promise.finally(() => {
      if (gen === aiGenRef.current) aiPromiseRef.current = null
    })
    return () => {
      aiGenRef.current += 1
      aiPromiseRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, regexHint, aiFallbackOn])

  /** 最终采用的解析结果：AI 合并结果优先（AI 未参与时即正则结果） */
  const finalHint = ai.merged ?? regexHint

  const resolveProjectId = async (projectName: string | null): Promise<string | null> => {
    if (projectName) {
      const found = db.projects.find(p => p.name.toLowerCase() === projectName.toLowerCase())
      if (found) return found.id
      return addProject(projectName, PROJECT_PALETTE[db.projects.length % PROJECT_PALETTE.length])
    }
    if (view.kind === 'project') return view.projectId ?? 'inbox'
    return null
  }

  const submit = async (): Promise<void> => {
    const raw = text.trim()
    if (!raw) return
    // 在途 AI 解析未完成时稍等（有截止时间的自由表达不该被吞掉时间）
    if (aiPromiseRef.current) await Promise.race([aiPromiseRef.current, new Promise(r => setTimeout(r, 8000))])
    const parsed = finalHint ?? parseQuickAdd(raw)
    const projectId = await resolveProjectId(parsed.projectName)
    const task = newTask({
      title: parsed.title,
      priority: parsed.priority ?? 3,
      dueAt: parsed.dueAt,
      tags: parsed.tags,
      projectId
    })
    // PRD 决策：有截止时间即默认准时提醒
    if (parsed.dueAt) task.reminders = [{ id: uid(), offsetMin: null }]
    await upsertTask(task)
    setFlash(
      `已添加「${parsed.title.slice(0, 18)}${parsed.title.length > 18 ? '…' : ''}」${
        parsed.dueAt ? ` · ${formatDueLabel(parsed.dueAt)}` : ''
      }${ai.aiApplied ? ' · AI' : ''}`
    )
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 2200)
    setText('')
    setRegexHint(null)
    setAi({ running: false, merged: null, aiApplied: false, ms: 0 })
    inputRef.current?.focus()
  }

  // ---------- 粘贴捕获：多行 / 长文本 → AI 拆解为多条任务 ----------
  const onPaste = (e: ReactClipboardEvent<HTMLInputElement>): void => {
    const clip = e.clipboardData.getData('text')
    const trimmed = clip.trim()
    if (!trimmed || (!trimmed.includes('\n') && trimmed.length <= 40)) return // 普通短文本按原样输入
    e.preventDefault()
    setPaste({ state: 'loading', error: '', drafts: [], checked: [] })
    window.noticeme
      .aiExtractMany(trimmed)
      .then(r =>
        setPaste({
          state: 'ready',
          error: '',
          drafts: r.drafts,
          checked: r.drafts.map(() => true)
        })
      )
      .catch(err =>
        setPaste({ state: 'error', error: err instanceof Error ? err.message : String(err), drafts: [], checked: [] })
      )
  }

  const addCheckedDrafts = async (): Promise<void> => {
    if (!paste) return
    const picked = paste.drafts.filter((_, i) => paste.checked[i])
    let added = 0
    for (const d of picked) {
      const projectId = await resolveProjectId(d.projectName)
      const task = newTask({
        title: d.title,
        priority: d.priority ?? 3,
        dueAt: d.dueAt,
        tags: d.tags,
        projectId
      })
      if (d.dueAt) task.reminders = [{ id: uid(), offsetMin: null }]
      await upsertTask(task)
      added += 1
    }
    setPaste(null)
    if (added > 0) {
      setFlash(`已从粘贴内容创建 ${added} 个任务`)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(null), 2600)
    }
    setText('')
    setRegexHint(null)
    setAi({ running: false, merged: null, aiApplied: false, ms: 0 })
    inputRef.current?.focus()
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 shadow-soft transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15 dark:border-zinc-800 dark:bg-zinc-900">
        <Plus size={16} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') {
              setText('')
              setRegexHint(null)
              setAi({ running: false, merged: null, aiApplied: false, ms: 0 })
              inputRef.current?.blur()
            }
          }}
          onPaste={onPaste}
          placeholder="添加任务：明天 9 点 写周报 p1 #工作 @电脑（粘贴长文本可 AI 拆解）"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
        <button
          onClick={() => setSyntaxOpen(v => !v)}
          className={`shrink-0 rounded-md p-1 transition ${
            syntaxOpen
              ? 'bg-accent/10 text-accent'
              : 'text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
          }`}
          title="快速添加完整语法"
        >
          <Keyboard size={14} />
        </button>
        <span className="shrink-0 text-[11px] text-zinc-300 dark:text-zinc-600">Enter 添加</span>
      </div>

      {syntaxOpen && (
        <div className="mt-1.5 animate-fadeIn rounded-xl border border-zinc-200/80 bg-white p-3 shadow-soft dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              快速添加完整语法
            </span>
            <button
              onClick={() => setSyntaxOpen(false)}
              className="text-[11px] text-zinc-400 hover:text-accent"
            >
              收起
            </button>
          </div>
          <div className="space-y-1.5">
            {SYNTAX_GROUPS.map(group => (
              <div key={group.label} className="flex gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/50">
                <span className="w-20 shrink-0 pt-[1px] text-[11px] font-semibold text-accent">{group.label}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {group.items.map(([k, v]) => (
                    <div key={k} className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-relaxed">
                      <code className="text-zinc-700 dark:text-zinc-200">{k}</code>
                      <span className="text-zinc-400 dark:text-zinc-500">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 px-0.5 text-[11px] text-zinc-400">
            组合任意词条即可，例如：「9号早上9点 交房租 p1 #工作 @电脑」「月底 盘点 紧急」「一刻钟后 回电」。只给日期未给时刻时默认 09:00；有截止时间的任务默认准时提醒。语法外的自由表达（如「周五之前发方案」「下班后取快递」）在设置开启本地 AI 后自动兜底解析。
          </p>
        </div>
      )}

      {flash && (
        <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-emerald-600 animate-fadeIn dark:text-emerald-400">
          <Check size={12} />
          {flash}
        </div>
      )}

      {ai.running && (
        <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-zinc-400 animate-fadeIn">
          <Loader2 size={11} className="animate-spin text-accent" />
          AI 解析中… {aiRunProgress.elapsed}s
          {aiRunProgress.chars > 0 && ` · 已生成 ${aiRunProgress.chars} 字`}
        </div>
      )}

      {finalHint && (finalHint.dueAt || finalHint.priority || finalHint.projectName || finalHint.tags.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 animate-fadeIn">
          {ai.aiApplied && (
            <span className="chip bg-violet-500/10 text-violet-500" title="包含本地 AI 的解析结果">
              <Sparkles size={11} />
              AI
            </span>
          )}
          {finalHint.dueAt && (
            <span className="chip bg-accent/10 text-accent">
              <CalendarClock size={11} />
              {formatDueLabel(finalHint.dueAt)}
            </span>
          )}
          {finalHint.priority && (
            <span className="chip bg-zinc-100 dark:bg-zinc-800" style={{ color: PRIORITY_COLORS[finalHint.priority] }}>
              <Flag size={11} />
              {PRIORITY_LABELS[finalHint.priority]}
            </span>
          )}
          {finalHint.projectName && (
            <span className="chip bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <Hash size={11} />
              {finalHint.projectName}
            </span>
          )}
          {finalHint.tags.map(tg => (
            <span key={tg} className="chip bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <AtSign size={11} />
              {tg}
            </span>
          ))}
        </div>
      )}

      {paste && (
        <div className="mt-1.5 animate-fadeIn rounded-xl border border-zinc-200/80 bg-white p-3 shadow-soft dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <ListChecks size={12} />
              粘贴内容拆解{paste.state === 'ready' ? `（${paste.drafts.length} 项）` : ''}
            </span>
            <button onClick={() => setPaste(null)} className="text-[11px] text-zinc-400 hover:text-accent">
              <X size={12} />
            </button>
          </div>
          {paste.state === 'loading' && (
            <div className="flex items-center gap-2 px-1 py-3 text-[12px] text-zinc-400">
              <Loader2 size={13} className="animate-spin text-accent" />
              本地 AI 正在拆解… {pasteProgress.elapsed}s
              {pasteProgress.chars > 0 && ` · 已生成 ${pasteProgress.chars} 字`}（推理时长取决于机器负载，通常 10~60 秒）
            </div>
          )}
          {paste.state === 'error' && (
            <div className="px-1 py-2 text-[12px] text-red-500">拆解失败：{paste.error}</div>
          )}
          {paste.state === 'ready' && paste.drafts.length === 0 && (
            <div className="px-1 py-2 text-[12px] text-zinc-400">没有提取到明确的任务，试试直接用快速添加输入。</div>
          )}
          {paste.state === 'ready' && paste.drafts.length > 0 && (
            <>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {paste.drafts.map((d, i) => (
                  <label
                    key={`${d.title}-${i}`}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={paste.checked[i]}
                      onChange={() =>
                        setPaste(p => {
                          if (!p) return p
                          const checked = [...p.checked]
                          checked[i] = !checked[i]
                          return { ...p, checked }
                        })
                      }
                      className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{d.title}</span>
                    {d.dueAt && (
                      <span className="chip shrink-0 bg-accent/10 text-accent">
                        <CalendarClock size={10} />
                        {formatDueLabel(d.dueAt)}
                      </span>
                    )}
                    {d.priority && (
                      <span className="chip shrink-0 bg-zinc-100 dark:bg-zinc-800" style={{ color: PRIORITY_COLORS[d.priority] }}>
                        {PRIORITY_LABELS[d.priority]}
                      </span>
                    )}
                    {d.projectName && (
                      <span className="chip shrink-0 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                        <Hash size={10} />
                        {d.projectName}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <button onClick={() => setPaste(null)} className="btn-ghost !px-2.5 !py-1 text-xs">
                  取消
                </button>
                <button onClick={() => void addCheckedDrafts()} className="btn-primary !px-3 !py-1 text-xs">
                  添加 {paste.checked.filter(Boolean).length} 项
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
