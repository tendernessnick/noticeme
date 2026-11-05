// AI 探针：启动真实 Electron 验证 node-llama-cpp 原生运行时可用性（不依赖模型文件）
// 用法：
//   npm run ai:probe                     —— 只验证原生运行时初始化（几秒）
//   npm run ai:probe -- path/to/model.gguf —— 额外加载模型并报告加载耗时
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(exe)) {
  console.error('✗ 未找到 Electron 可执行文件，请先 npm install')
  process.exit(1)
}

const modelArg = process.argv[2] ? resolve(process.argv[2]) : ''
if (modelArg && !existsSync(modelArg)) {
  console.error(`✗ 模型文件不存在：${modelArg}`)
  process.exit(1)
}

console.log(modelArg ? `▶ AI 探针（含模型加载）：${modelArg}` : '▶ AI 探针（仅原生运行时）')
const child = spawn(exe, [root], {
  cwd: root,
  env: { ...process.env, NOTICE_ME_AI_PROBE: '1', ...(modelArg ? { NOTICE_ME_AI_MODEL: modelArg } : {}) },
  stdio: ['ignore', 'pipe', 'pipe']
})

let buf = ''
child.stdout.on('data', d => {
  buf += String(d)
  process.stdout.write(d)
})
child.stderr.on('data', d => process.stderr.write(d))

const timeout = setTimeout(() => {
  console.error('✗ AI 探针超时（120s），强制结束')
  child.kill()
  process.exit(2)
}, 120_000)

child.on('exit', code => {
  clearTimeout(timeout)
  const line = buf.split('\n').find(l => l.startsWith('[ai-probe]'))
  if (code === 0 && line) {
    try {
      const r = JSON.parse(line.slice('[ai-probe]'.length))
      console.log(`\n✓ 原生运行时 OK：fork ${r.forkMs}ms · llama 初始化 ${r.initMs}ms` +
        (r.loadMs != null ? ` · 模型加载 ${r.loadMs}ms` : ''))
    } catch {
      console.log('\n✓ AI 探针通过')
    }
  } else {
    console.error(`\n✗ AI 探针失败（退出码 ${code}）`)
  }
  process.exit(code ?? 1)
})
