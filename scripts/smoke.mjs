// 冒烟测试：启动打包后的应用（独立临时数据目录），自动截图并退出
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'smoke-out')
mkdirSync(outDir, { recursive: true })

const exe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(exe)) {
  console.error('✗ 未找到 Electron 可执行文件，请先 npm install')
  process.exit(1)
}

console.log('▶ 启动 NoticeMe 冒烟测试，输出目录：', outDir)
const child = spawn(exe, [root], {
  cwd: root,
  env: { ...process.env, NOTICE_ME_SMOKE: outDir },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stdout.on('data', d => process.stdout.write(d))
child.stderr.on('data', d => {
  stderr += String(d)
  process.stderr.write(d)
})

const timeout = setTimeout(() => {
  console.error('✗ 冒烟测试超时（60s），强制结束')
  child.kill()
  process.exit(2)
}, 60_000)

child.on('exit', code => {
  clearTimeout(timeout)
  console.log(`\n▶ 应用退出码：${code}`)
  if (stderr.trim()) console.log('▶ stderr 摘要（最后 20 行）：\n' + stderr.trim().split('\n').slice(-20).join('\n'))
  try {
    const files = readdirSync(outDir).filter(f => !f.endsWith('.log'))
    console.log('▶ 产出文件：')
    for (const f of files) {
      const kb = (statSync(join(outDir, f)).size / 1024).toFixed(1)
      console.log(`   - ${f} (${kb} KB)`)
    }
  } catch (e) {
    console.error('✗ 读取输出目录失败', e.message)
  }
  process.exit(code ?? 0)
})
