import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Download, FileCog, FlaskConical, Loader2, Volume2, X } from 'lucide-react'
import type { NotifyMode, Settings, ThemeMode } from '../../../shared/types'
import { useStore } from '../store'
import { flushEditorDrafts } from '../utils/useAutosave'

// 构建时由 electron.vite.config.ts（renderer.define）从 package.json 注入
declare const __APP_VERSION__: string

const NOTIFY_MODES: Array<[NotifyMode, string]> = [
  ['card', '卡片'],
  ['toast', '系统通知'],
  ['both', '同时']
]

export default function SettingsModal(): JSX.Element {
  const db = useStore(s => s.db)!
  const updateSettings = useStore(s => s.updateSettings)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const aiStatus = useStore(st => st.aiStatus)
  const updater = useStore(st => st.updater)
  const s = db.settings
  const [dataDir, setDataDir] = useState('')
  const [capturing, setCapturing] = useState<'add' | 'show' | null>(null)
  const [aiTestRaw, setAiTestRaw] = useState('')
  const [aiTesting, setAiTesting] = useState(false)
  const [dataActionBusy, setDataActionBusy] = useState(false)
  const actionLock = useRef(false)
  const [actionFeedback, setActionFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const updaterPhase = updater?.phase ?? 'idle'
  const updaterVersion = updater?.version ?? ''
  const updaterProgress = updater?.progress ?? -1
  const updaterError = updater?.error ?? ''
  const updaterFallback = updater?.fallback ?? false

  useEffect(() => {
    void window.noticeme.dataInfo().then(i => setDataDir(i.dir))
  }, [])

  // Esc 关闭设置
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') useStore.getState().setSettingsOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const patch = (p: Partial<Settings>): void => {
    void updateSettings(p)
  }

  const playChime = async (): Promise<void> => {
    const url = await window.noticeme.getChime()
    if (url) void new Audio(url).play()
  }

  const withSavedEditors = async (label: string, action: () => Promise<boolean | void>): Promise<void> => {
    if (actionLock.current) return
    actionLock.current = true
    setDataActionBusy(true)
    setActionFeedback(null)
    try {
      if (!await flushEditorDrafts()) {
        setActionFeedback({ error: true, text: `尚有修改未能保存，已取消${label}。请回到编辑器重试保存；会话草稿仍保留。` })
        return
      }
      const result = await action()
      setActionFeedback({ error: false, text: result === false ? `${label}已取消或未完成。若已选择文件，请检查备份格式及文件权限。` : `${label}已完成。` })
    } catch (error) {
      setActionFeedback({ error: true, text: `${label}失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      actionLock.current = false
      setDataActionBusy(false)
    }
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

        <Section title="本地 AI（实验性）">
          <Row label="启用本地 AI" desc="在本机运行 Qwen2.5-1.5B 小模型（约 1 GB），用于自由文本提取任务与生成周回顾。模型与数据都不出你的电脑，AI 不参与提醒触发。">
            <Switch checked={s.aiEnabled} onChange={v => patch({ aiEnabled: v })} />
          </Row>
          {s.aiEnabled && aiStatus && (
            <>
              <Row
                label="模型文件"
                desc={
                  aiStatus.downloading
                    ? `下载中 ${aiStatus.downloadProgress >= 0 ? `${Math.round(aiStatus.downloadProgress * 100)}%` : ''}`
                    : aiStatus.downloadError
                      ? `下载失败：${aiStatus.downloadError}`
                      : aiStatus.modelAvailable
                        ? aiStatus.modelCustom
                          ? '已就绪（手动指定的 GGUF 文件）'
                          : '已就绪'
                        : '尚未就绪：下载官方模型，或选择本地已下载的 GGUF 文件'
                }
              >
                <div className="flex items-center gap-1">
                  {aiStatus.downloading ? (
                    <button onClick={() => void window.noticeme.aiDownloadCancel()} className="btn-ghost !px-2 !py-1 text-xs">
                      取消
                    </button>
                  ) : !aiStatus.modelAvailable ? (
                    <button
                      onClick={() => void window.noticeme.aiDownloadStart()}
                      className="btn-ghost !px-2 !py-1 text-xs"
                      title="从 hf-mirror.com 下载（约 1 GB，支持断点续传）"
                    >
                      <Download size={13} /> 下载模型
                    </button>
                  ) : null}
                  <button
                    onClick={() => void window.noticeme.aiPickModel()}
                    className="btn-ghost !px-2 !py-1 text-xs"
                    title="选择本地 GGUF 模型文件"
                  >
                    <FileCog size={13} /> 选择文件…
                  </button>
                </div>
              </Row>
              {aiStatus.downloading && aiStatus.downloadProgress >= 0 && (
                <div className="px-4 pb-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(aiStatus.downloadProgress * 100)}%` }} />
                  </div>
                </div>
              )}
              <Row label="快速添加 AI 兜底" desc="正则未识别出时间时用 AI 解析（原有语法始终优先，结果经预览确认）">
                <Switch checked={s.aiQuickAddFallback} onChange={v => patch({ aiQuickAddFallback: v })} />
              </Row>
              <Row label="空闲自动卸载" desc="模型不推理时从内存释放（托盘应用常驻内存优先）">
                <select
                  value={s.aiIdleUnloadMin}
                  onChange={e => patch({ aiIdleUnloadMin: Number(e.target.value) })}
                  className="input !w-28 cursor-pointer"
                >
                  <option value={1}>1 分钟</option>
                  <option value={3}>3 分钟</option>
                  <option value={5}>5 分钟</option>
                  <option value={10}>10 分钟</option>
                  <option value={0}>常驻</option>
                </select>
              </Row>
              <Row
                label="GPU 加速（实验性）"
                desc={
                  aiStatus.gpuFallback
                    ? 'GPU 初始化失败，本次已自动回退 CPU（重新开关可重试）'
                    : aiStatus.gpuActive
                      ? '已启用：Vulkan 核显推理（生成速度约 2~4 倍）'
                      : '用核显（Vulkan）推理，速度约 2~4 倍；初始化失败自动回退 CPU'
                }
              >
                <Switch checked={s.aiGpu} onChange={v => patch({ aiGpu: v })} />
              </Row>
              <Row label="试一句" desc={aiStatus.busy || aiStatus.loading ? '模型加载 / 推理中…' : '用一句示例验证模型链路与延迟'}>
                <button
                  disabled={aiStatus.busy || aiStatus.loading || aiTesting || !aiStatus.modelAvailable}
                  onClick={() => {
                    setAiTesting(true)
                    setAiTestRaw('')
                    void window.noticeme
                      .aiTest()
                      .then(r => setAiTestRaw(`${(r.ms / 1000).toFixed(1)}s · ${r.raw}`))
                      .catch(e => setAiTestRaw(`失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setAiTesting(false))
                  }}
                  className="btn-ghost !px-2 !py-1 text-xs disabled:opacity-40"
                >
                  {aiTesting || aiStatus.busy || aiStatus.loading ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                  运行
                </button>
              </Row>
              {aiTestRaw && (
                <div className="mx-4 mb-3 max-h-28 overflow-y-auto rounded-lg bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                  {aiTestRaw}
                </div>
              )}
              {aiStatus.lastError && (
                <div className="mx-4 mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{aiStatus.lastError}</div>
              )}
            </>
          )}
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
          <Row label="导出备份" desc="先保存草稿，再导出任务、随心记、笔记及设置">
            <button disabled={dataActionBusy} onClick={() => void withSavedEditors('导出备份', () => window.noticeme.exportData())} className="btn-ghost !py-1 text-xs disabled:opacity-50">
              导出…
            </button>
          </Row>
          <Row label="导入备份" desc="将覆盖当前数据（自动留底）">
            <button disabled={dataActionBusy} onClick={() => void withSavedEditors('导入备份', () => window.noticeme.importData())} className="btn-ghost !py-1 text-xs disabled:opacity-50">
              导入…
            </button>
          </Row>
          <Row label="数据目录">
            <span className="max-w-[260px] truncate text-xs text-zinc-400" title={dataDir}>
              {dataDir}
            </span>
          </Row>
        </Section>

        <Section title="关于">
          <Row
            label="当前版本"
            desc={
              updaterPhase === 'downloaded'
                ? `新版本 v${updaterVersion} 已就绪，重启后自动安装`
                : updaterPhase === 'downloading'
                  ? `正在下载 v${updaterVersion}…${updaterProgress >= 0 ? ` ${Math.round(updaterProgress * 100)}%` : ''}`
                  : updaterPhase === 'available'
                    ? `发现新版本 v${updaterVersion}`
                    : updaterPhase === 'checking'
                      ? '正在检查更新…'
                      : updaterPhase === 'not-available'
                        ? '已是最新版本'
                        : updaterPhase === 'error'
                          ? `检查失败：${updaterError}`
                          : '本地优先，数据不出你的电脑'
            }
          >
            <div className="flex items-center gap-1">
              {updaterPhase === 'downloaded' ? (
                <button disabled={dataActionBusy} onClick={() => void withSavedEditors('重启更新', () => window.noticeme.updaterInstall())} className="btn-primary !px-3 !py-1 text-xs disabled:opacity-50">
                  重启更新
                </button>
              ) : updaterFallback && updaterPhase === 'available' ? (
                <button onClick={() => void window.noticeme.updaterOpenPage()} className="btn-primary !px-3 !py-1 text-xs">
                  去下载
                </button>
              ) : (
                <button
                  onClick={() => void window.noticeme.updaterCheck()}
                  disabled={updaterPhase === 'checking' || updaterPhase === 'downloading'}
                  className="btn-ghost !px-2 !py-1 text-xs disabled:opacity-40"
                >
                  {updaterPhase === 'checking' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  检查更新
                </button>
              )}
            </div>
          </Row>
          {updaterPhase === 'downloading' && updaterProgress >= 0 && (
            <div className="px-4 pb-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(updaterProgress * 100)}%` }} />
              </div>
            </div>
          )}
          <Row label="版本信息">
            <span className="max-w-[260px] truncate text-xs text-zinc-400" title="数据与模型全部本地保存">
              v{__APP_VERSION__} · 本地优先
            </span>
          </Row>
        </Section>

        {(dataActionBusy || actionFeedback) && (
          <p role="status" aria-live="polite" className={`mt-3 rounded-lg px-3 py-2 text-xs ${actionFeedback?.error ? 'bg-red-500/10 text-red-500' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
            {dataActionBusy ? '正在保存草稿并处理，请稍候…' : actionFeedback?.text}
          </p>
        )}
        <p className="mt-4 border-t border-zinc-100 pt-3 text-center text-[11px] text-zinc-400 dark:border-zinc-800">
          NoticeMe v{__APP_VERSION__} · 本地优先，数据不出你的电脑
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
