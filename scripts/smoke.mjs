// 冒烟测试：启动打包后的应用（独立临时数据目录），自动截图并退出
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'smoke-out', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(outDir, { recursive: true })

const packagedExe = process.argv[2]
const exe = packagedExe || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(exe)) {
  console.error('✗ 未找到 Electron 可执行文件，请先 npm install')
  process.exit(1)
}

console.log('▶ 启动 NoticeMe 冒烟测试，输出目录：', outDir)
const childEnv = { ...process.env, NOTICE_ME_SMOKE: outDir }
delete childEnv.ELECTRON_RUN_AS_NODE
const child = spawn(exe, packagedExe ? [] : [root], {
  cwd: root,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stdout.on('data', d => process.stdout.write(d))
child.stderr.on('data', d => {
  stderr += String(d)
  process.stderr.write(d)
})

// 便携版包含原生 AI 运行时，自解压需要额外时间；交互步骤仍使用相同断言。
const timeoutMs = Number(process.env.NOTICE_ME_SMOKE_TIMEOUT_MS) || (packagedExe ? 180_000 : 60_000)
const timeout = setTimeout(() => {
  console.error(`✗ 冒烟测试超时（${timeoutMs / 1000}s），强制结束`)
  child.kill()
  process.exit(2)
}, timeoutMs)

child.on('exit', code => {
  clearTimeout(timeout)
  console.log(`\n▶ 应用退出码：${code}`)
  if (stderr.trim()) console.log('▶ stderr 摘要（最后 20 行）：\n' + stderr.trim().split('\n').slice(-20).join('\n'))
  let passed = code === 0
  try {
    const report = JSON.parse(readFileSync(join(outDir, 'interaction-checks.json'), 'utf8'))
    const { dir } = JSON.parse(readFileSync(join(outDir, 'smoke-data-info.json'), 'utf8'))
    const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'))
    if (!report.passed || data.entries.find(e => e.id === 'reg-journal-b')?.content !== '退出前最后输入不可丢失') throw new Error('退出前最后输入未成功保存')
    console.log(`▶ 交互回归 ${report.passed} 项 + 真正退出保存校验通过`)
    for (const name of ['main-tasks.png', 'alert-card.png', 'focus-improved.png', 'focus-improved-dark.png', 'today-overview.png']) {
      if (statSync(join(outDir, name)).size < 1000) throw new Error(`截图无效：${name}`)
    }
    const files = readdirSync(outDir).filter(f => !f.endsWith('.log'))
    console.log('▶ 产出文件：')
    for (const f of files) {
      const kb = (statSync(join(outDir, f)).size / 1024).toFixed(1)
      console.log(`   - ${f} (${kb} KB)`)
    }
  } catch (e) {
    console.error('✗ 冒烟验收失败', e.message)
    passed = false
  }
  process.exit(passed ? 0 : 1)
})
