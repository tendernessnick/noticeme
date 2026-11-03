import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Volume2, X } from 'lucide-react'
import type { NotifyMode, Settings, ThemeMode } from '../../../shared/types'
import { useStore } from '../store'

const NOTIFY_MODES: Array<[NotifyMode, string]> = [
  ['card', '卡片'],
  ['toast', '系统通知'],
  ['both', '同时']
]

export default function SettingsModal(): JSX.Element {
  const db = useStore(s => s.db)!
  const updateSettings = useStore(s => s.updateSettings)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const s = db.settings
  const [dataDir, setDataDir] = useState('')
  const [capturing, setCapturing] = useState<'add' | 'show' | null>(null)

  useEffect(() => {
    void window.noticeme.dataInfo().then(i => setDataDir(i.dir))
  }, [])

  const patch = (p: Partial<Settings>): void => {
    void updateSettings(p)
  }

  const playChime = async (): Promise<void> => {
    const url = await window.noticeme.getChime()
    if (url) void new Audio(url).play()
  }

  const captureHotkey = (which: 'add' | 'show') => (e: KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Control')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    let key = e.key
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return
    if (key.length === 1) key = key.toUpperCase()
    if (key === ' ') key = 'Space'
    parts.push(key)
    const accel = parts.join('+')
    patch(which === 'add' ? { hotkeyQuickAdd: accel } : { hotkeyShow: accel })
    setCapturing(null)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6 animate-fadeIn" onClick={() => setSettingsOpen(false)}>
      <div
        className="max-h-[85vh] w-[520px] overflow-y-auto rounded-card border border-zinc-200 bg-white p-6 shadow-pop animate-slideUp dark:border-zinc-800 dark:bg-zinc-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">设置</h2>
          <button onClick={() => setSettingsOpen(false)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        <Section title="外观">
          <Row label="主题">
            <select
              value={s.theme}
              onChange={e => patch({ theme: e.target.value as ThemeMode })}
              className="input !w-36 cursor-pointer"
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </Row>
        </Section>

        <Section title="提醒">
          <Row label="提醒方式" desc="卡片不抢焦点；系统通知留存到 Windows 通知中心">
            <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {NOTIFY_MODES.map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => patch({ notifyMode: mode })}
                  className={`px-2.5 py-1 text-xs font-medium transition ${
                    s.notifyMode === mode
                      ? 'bg-accent text-white'
                      : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="提示音">
            <div className="flex items-center gap-1">
              <button onClick={() => void playChime()} className="btn-ghost !px-2 !py-1 text-xs" title="试听">
                <Volume2 size={14} /> 试听
              </button>
              <Switch checked={s.soundOn} onChange={v => patch({ soundOn: v })} />
            </div>
          </Row>
          <Row label="未处理循环提醒" desc={`每次关闭弹窗后 ${s.nagIntervalMin} 分钟再提醒`}>
            <Switch checked={s.nagEnabled} onChange={v => patch({ nagEnabled: v })} />
          </Row>
          <Row label="错过补发窗口" desc="启动后 N 分钟内的错过的提醒会补弹">
            <input
              type="number"
              min={0}
              max={1440}
              value={s.missedFireWindowMin}
              onChange={e => patch({ missedFireWindowMin: Math.max(0, Number(e.target.value) || 0) })}
              className="input !w-20 text-center"
            />
          </Row>
        </Section>

        <Section title="快捷键">
          <Row label="快速添加">
            <input
              readOnly
              value={capturing === 'add' ? '按下组合键…' : s.hotkeyQuickAdd || '未设置'}
              onFocus={() => setCapturing('add')}
              onKeyDown={captureHotkey('add')}
              className="input !w-44 cursor-pointer text-center"
            />
          </Row>
          <Row label="显示 / 隐藏窗口">
            <input
              readOnly
              value={capturing === 'show' ? '按下组合键…' : s.hotkeyShow || '未设置'}
              onFocus={() => setCapturing('show')}
              onKeyDown={captureHotkey('show')}
              className="input !w-44 cursor-pointer text-center"
            />
          </Row>
        </Section>

        <Section title="通用">
          <Row label="开机自启">
            <Switch checked={s.autostart} onChange={v => patch({ autostart: v })} />
          </Row>
          <Row label="关闭时最小化到托盘" desc="关闭窗口后托盘常驻提醒">
            <Switch checked={s.closeToTray} onChange={v => patch({ closeToTray: v })} />
          </Row>
        </Section>

        <Section title="数据">
          <Row label="导出备份" desc="全部任务导出为 JSON">
            <button onClick={() => void window.noticeme.exportData()} className="btn-ghost !py-1 text-xs">
              导出…
            </button>
          </Row>
          <Row label="导入备份" desc="将覆盖当前数据（自动留底）">
            <button onClick={() => void window.noticeme.importData()} className="btn-ghost !py-1 text-xs">
              导入…
            </button>
          </Row>
          <Row label="数据目录">
            <span className="max-w-[260px] truncate text-xs text-zinc-400" title={dataDir}>
              {dataDir}
            </span>
          </Row>
        </Section>

        <p className="mt-4 border-t border-zinc-100 pt-3 text-center text-[11px] text-zinc-400 dark:border-zinc-800">
          NoticeMe v0.1.0 · 本地优先，数据不出你的电脑
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="mb-2">
      <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      <div className="card divide-y divide-zinc-100 dark:divide-zinc-800/70">{children}</div>
    </div>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-[11px] text-zinc-400">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}
