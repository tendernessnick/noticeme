import { useEffect, useRef, useState } from 'react'
import { Plus, CalendarClock, Flag, Hash, AtSign, Keyboard } from 'lucide-react'
import { parseQuickAdd, type ParsedQuickAdd } from '../../../shared/parse'
import { newTask, uid, PROJECT_PALETTE } from '../../../shared/defaults'
import { formatDueLabel } from '../../../shared/datetime'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../utils/ui'
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
      ['30分钟后', '当前时间 +30 分钟'],
      ['2小时后 / 半小时后', '当前时间 +2 小时 / +30 分钟'],
      ['3天后 / 三天之内', '3 天后 09:00']
    ]
  },
  {
    label: '时刻',
    items: [
      ['9点 / 九点半 / 9点30 / 14:30', '对应时刻'],
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

export default function QuickAdd(): JSX.Element {
  const db = useStore(s => s.db)!
  const upsertTask = useStore(s => s.upsertTask)
  const addProject = useStore(s => s.addProject)
  const view = useStore(s => s.view)
  const quickAddToken = useStore(s => s.quickAddToken)
  const [text, setText] = useState('')
  const [hint, setHint] = useState<ParsedQuickAdd | null>(null)
  const [syntaxOpen, setSyntaxOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (quickAddToken > 0) inputRef.current?.focus()
  }, [quickAddToken])

  useEffect(() => {
    const t = setTimeout(() => {
      setHint(text.trim() ? parseQuickAdd(text) : null)
    }, 120)
    return () => clearTimeout(t)
  }, [text])

  const submit = async (): Promise<void> => {
    const raw = text.trim()
    if (!raw) return
    const parsed = parseQuickAdd(raw)
    let projectId: string | null = null
    if (view.kind === 'project') projectId = view.projectId ?? 'inbox'
    if (parsed.projectName) {
      const found = db.projects.find(
        p => p.name.toLowerCase() === parsed.projectName!.toLowerCase()
      )
      projectId = found
        ? found.id
        : await addProject(parsed.projectName, PROJECT_PALETTE[db.projects.length % PROJECT_PALETTE.length])
    }
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
    setText('')
    setHint(null)
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
              setHint(null)
              inputRef.current?.blur()
            }
          }}
          placeholder="添加任务：明天 9 点 写周报 p1 #工作 @电脑"
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
            组合任意词条即可，例如：「9号早上9点 交房租 p1 #工作 @电脑」「月底 盘点 紧急」。只给日期未给时刻时默认 09:00；有截止时间的任务默认准时提醒。
          </p>
        </div>
      )}

      {hint && (hint.dueAt || hint.priority || hint.projectName || hint.tags.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 animate-fadeIn">
          {hint.dueAt && (
            <span className="chip bg-accent/10 text-accent">
              <CalendarClock size={11} />
              {formatDueLabel(hint.dueAt)}
            </span>
          )}
          {hint.priority && (
            <span className="chip bg-zinc-100 dark:bg-zinc-800" style={{ color: PRIORITY_COLORS[hint.priority] }}>
              <Flag size={11} />
              {PRIORITY_LABELS[hint.priority]}
            </span>
          )}
          {hint.projectName && (
            <span className="chip bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <Hash size={11} />
              {hint.projectName}
            </span>
          )}
          {hint.tags.map(tg => (
            <span key={tg} className="chip bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <AtSign size={11} />
              {tg}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
