import { CalendarClock, CalendarPlus, CheckCircle2, Repeat, BellRing, Pencil, Trash2, Sparkles, Flag, Sunrise } from 'lucide-react'
import type { Task } from '../../../shared/types'
import { formatDueLabel, formatReminderOffset, isDuePast } from '../../../shared/datetime'
import { localToday } from '../../../shared/defaults'
import { PRIORITY_COLORS } from '../utils/ui'
import { useStore } from '../store'
import { taskSections } from '../utils/views'

export default function TaskList(): JSX.Element {
  const db = useStore(s => s.db)!
  const view = useStore(s => s.view)
  const search = useStore(s => s.search)
  const showDone = useStore(s => s.showDone)

  if (db.tasks.length === 0 && !search.trim()) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center animate-fadeIn">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 text-accent">
          <Sparkles size={28} />
        </div>
        <h2 className="text-lg font-semibold">一切就绪，今天也轻松</h2>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">
          在上方输入框添加你的第一个任务。
          <br />
          试试：<span className="text-accent">明天 9 点 写周报 p1 #工作</span>
        </p>
      </div>
    )
  }

  const secs = taskSections(db, view, search, showDone)

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-10">
      {secs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 size={36} className="mb-3 text-zinc-300 dark:text-zinc-700" />
          <p className="text-sm text-zinc-400">这里空空如也</p>
        </div>
      )}
      {secs.map(sec => {
        const collapsed = sec.collapsible && !showDone
        return (
          <section key={sec.key} className="mt-4">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <h3
                className={`text-[13px] font-semibold ${
                  sec.key === 'overdue' ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {sec.label}
              </h3>
              {sec.collapsible && (
                <button
                  onClick={useStore.getState().toggleShowDone}
                  className="text-[11px] text-zinc-400 hover:text-accent"
                >
                  {showDone ? '收起' : '展开'}
                </button>
              )}
            </div>
            {!collapsed && sec.tasks.length > 0 && (
              <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {sec.tasks.map(t => (
                  <TaskItem key={t.id} task={t} hideProject={view.kind === 'project'} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function TaskItem({ task, hideProject }: { task: Task; hideProject?: boolean }): JSX.Element {
  const setDone = useStore(s => s.setDone)
  const deleteTask = useStore(s => s.deleteTask)
  const planTasksDay = useStore(s => s.planTasksDay)
  const selectTask = useStore(s => s.selectTask)
  const db = useStore(s => s.db)!
  const project = hideProject ? null : db.projects.find(p => p.id === (task.projectId ?? 'inbox'))
  const overdue = !!task.dueAt && !task.done && isDuePast(task.dueAt)

  return (
    <div
      onClick={() => selectTask(task.id)}
      className={`group flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
        task.done ? 'opacity-55' : ''
      }`}
    >
      {/* 复选框 */}
      <button
        onClick={e => {
          e.stopPropagation()
          void setDone(task.id, !task.done)
        }}
        className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border-2 transition ${
          task.done
            ? 'border-accent bg-accent text-white'
            : 'border-zinc-300 hover:border-accent dark:border-zinc-600'
        }`}
        title={task.done ? '标记未完成' : '完成'}
      >
        {task.done && (
          <svg viewBox="0 0 12 12" className="check-pop h-3 w-3" fill="none">
            <path d="M2 6.2L4.8 9L10 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* 优先级 */}
      {!task.done && (
        <Flag size={14} className="mt-[5px] shrink-0" style={{ color: PRIORITY_COLORS[task.priority], fill: task.priority <= 2 ? PRIORITY_COLORS[task.priority] : 'none' }} />
      )}

      {/* 内容 */}
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[13.5px] leading-snug ${
            task.done ? 'text-zinc-400 line-through' : 'font-medium'
          }`}
        >
          {task.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          {task.dueAt && (
            <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-red-500' : 'text-zinc-400'}`}>
              <CalendarClock size={11} />
              {formatDueLabel(task.dueAt)}
            </span>
          )}
          {task.reminders.length > 0 && (
            <span className="inline-flex items-center gap-1 text-zinc-400" title={task.reminders.map(r => formatReminderOffset(r.offsetMin)).join('、')}>
              <BellRing size={11} />
              {task.reminders.length}
            </span>
          )}
          {task.plannedDay && !task.done && (
            <span className="inline-flex items-center gap-1 font-medium text-accent" title="已列入今日聚焦计划">
              <Sunrise size={11} />
              今日聚焦
            </span>
          )}
          {task.repeat && <Repeat size={11} className="text-zinc-400" />}
          {task.tags.map(tg => (
            <span key={tg} className="rounded bg-zinc-100 px-1.5 py-[1px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              @{tg}
            </span>
          ))}
          {project && (
            <span className="inline-flex items-center gap-1 text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
        </div>
      </div>

      {/* 悬停操作 */}
      <div className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        {!task.done && task.plannedDay !== localToday() && (
          <button
            onClick={e => {
              e.stopPropagation()
              void planTasksDay([task.id], localToday())
            }}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-accent/10 hover:text-accent"
            title="加入今日聚焦"
          >
            <CalendarPlus size={13} />
          </button>
        )}
        <button
          onClick={e => {
            e.stopPropagation()
            selectTask(task.id)
          }}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          title="编辑"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={e => {
            e.stopPropagation()
            void deleteTask(task.id)
          }}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
