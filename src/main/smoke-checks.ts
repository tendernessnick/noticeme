// 仅 NOTICE_ME_SMOKE 隔离数据模式调用，真实 Electron/React/IPC 回归。
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Store } from './store'
import { localToday, newJournalEntry, newNote, newTask } from '../shared/defaults'
import { addDays } from '../shared/datetime'

export async function runInteractionChecks(win: BrowserWindow, store: Store, outDir: string): Promise<void> {
  const checks: string[] = []
  const pause = (ms = 150): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
  const js = (code: string): Promise<any> => win.webContents.executeJavaScript(code)
  const click = async (selector: string): Promise<void> => {
    assert(await js(`!!document.querySelector(${JSON.stringify(selector)})`), `缺少 ${selector}`)
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await pause()
  }
  const clickText = async (text: string): Promise<void> => {
    assert(await js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`), `缺少按钮 ${text}`)
    await pause()
  }
  const fill = async (selector: string, text: string): Promise<void> => {
    assert(await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`), `缺少输入框 ${selector}`)
    await pause(30)
  }
  const record = (id: string) => store.get().tasks.find(t => t.id === id)!
  const capture = async (name: string): Promise<void> => writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG())

  const due = addDays(new Date(), 4).toISOString()
  store.mutate(db => {
    db.tasks.push(newTask({ id: 'reg-carry', title: '回归：昨天未完成的计划', plannedDay: localToday(addDays(new Date(), -1)), dueAt: null }),
      newTask({ id: 'reg-pick', title: '回归：待选任务', dueAt: due }))
    db.entries.push(newJournalEntry({ id: 'reg-journal-a', title: '回归日记 A' }), newJournalEntry({ id: 'reg-journal-b', title: '回归日记 B' }))
    db.notes.push(newNote({ id: 'reg-note-a', title: '回归笔记 A' }), newNote({ id: 'reg-note-b', title: '回归笔记 B' }))
  })
  await pause()
  assert(await js(`document.body.textContent.includes('之前的计划还没做完')`))
  await capture('focus-carryover.png')
  await clickText('全部带回今天')
  assert.equal(record('reg-carry').plannedDay, localToday())
  assert.equal(record('reg-carry').dueAt, null)
  checks.push('跨日计划可见并手动带回今天，截止日期不变')
  await clickText('选择任务')
  await fill('[aria-label="搜索待选任务"]', '回归：待选任务')
  await click('[aria-label="加入今日计划：回归：待选任务"]')
  assert.equal(record('reg-pick').plannedDay, localToday())
  assert.equal(record('reg-pick').dueAt, due)
  checks.push('无需AI，搜索并加入计划')
  await click('[aria-label="关闭任务选择"]')
  await clickText('选择任务')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await pause()
  assert(await js(`!document.querySelector('#focus-candidates') && document.activeElement.textContent.includes('选择任务')`))
  checks.push('原生键盘Esc关闭任务选择并回焦')
  await click('[aria-label="顺延到明天：回归：待选任务"]')
  assert.equal(record('reg-pick').plannedDay, localToday(addDays(new Date(), 1)))
  assert.equal(record('reg-pick').dueAt, due)
  checks.push('顺延计划保留原截止时间')

  await click('[aria-label="查看任务详情：回归：昨天未完成的计划"]')
  await fill('[aria-label="任务备注"]', '完成提醒与输入同时发生时保留这段备注')
  await js(`window.noticeme.setTaskDone('reg-carry', true)`)
  await pause(650)
  assert.equal(record('reg-carry').done, true)
  assert.equal(record('reg-carry').notes, '完成提醒与输入同时发生时保留这段备注')
  checks.push('任务草稿不回滚外部完成状态')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await pause()

  for (const scope of ['journal', 'note'] as const) {
    await click(scope === 'journal' ? '[data-nav="journal"]' : '[data-folder-id="notes-default"]')
    const attribute = scope === 'journal' ? 'data-entry-id' : 'data-note-id'
    const idA = scope === 'journal' ? 'reg-journal-a' : 'reg-note-a'
    const idB = scope === 'journal' ? 'reg-journal-b' : 'reg-note-b'
    const input = scope === 'journal' ? '[aria-label="日记正文"]' : '[aria-label="笔记正文"]'
    const records = () => scope === 'journal' ? store.get().entries : store.get().notes
    await click(`[${attribute}="${idA}"]`)
    await fill(input, 'A最后输入不可丢失')
    await click(`[${attribute}="${idB}"]`)
    await fill(input, 'B最后输入不可丢失')
    await click(`[${attribute}="${idA}"]`)
    await pause(600)
    assert.equal(records().find(r => r.id === idA)?.content, 'A最后输入不可丢失')
    assert.equal(records().find(r => r.id === idB)?.content, 'B最后输入不可丢失')
    checks.push(`${scope}快速切换保留两条记录的最后输入`)
    await fill(input, '文字与置顶一起保留')
    await click('[title="置顶"]')
    await pause(600)
    assert.equal(records().find(r => r.id === idA)?.content, '文字与置顶一起保留')
    assert.equal(records().find(r => r.id === idA)?.pinned, true)
    checks.push(`${scope}即时置顶不被旧防抖快照覆盖`)
    await fill(input, '待删除草稿')
    await click(scope === 'journal' ? '[title="删除随心记"]' : '[title="删除笔记"]')
    await click('[aria-label="确认删除"]')
    await pause(600)
    assert(!records().some(r => r.id === idA))
    checks.push(`${scope}删除后延迟保存不复活`)
  }
  await click('[data-nav="today"]')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['control'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'f', modifiers: ['control'] })
  await pause()
  assert(await js(`document.activeElement.getAttribute('aria-label') === '搜索当前视图中的任务'`))
  checks.push('原生键盘Ctrl+F聚焦当前视图搜索')
  await fill('[aria-label="搜索当前视图中的任务"]', '唯一没有结果的查询')
  assert(await js(`document.body.textContent.includes('当前视图没有匹配的任务')`))
  await click('[aria-label="清除搜索"]')
  checks.push('空搜索结果有反馈，清除后恢复视图')
  await capture('today-overview.png')
  for (const width of [860, 1080, 1440]) {
    win.setSize(width, 760)
    await pause()
    assert(await js('document.documentElement.scrollWidth <= innerWidth'), `宽度${width}横向溢出`)
  }
  checks.push('860/1080/1440窗口无页面横向溢出')
  await click('[data-nav="focus"]')
  win.setSize(1080, 760)
  await pause()
  await capture('focus-improved.png')
  store.mutate(db => { db.settings.theme = 'dark' })
  await pause()
  await capture('focus-improved-dark.png')
  writeFileSync(join(outDir, 'interaction-checks.json'), JSON.stringify({ passed: checks.length, checks }, null, 2))
  // 刚输入就真实退出，外层脚本在进程结束后检查落盘内容。
  await click('[data-nav="journal"]')
  await click('[data-entry-id="reg-journal-b"]')
  await fill('[aria-label="日记正文"]', '退出前最后输入不可丢失')
}
