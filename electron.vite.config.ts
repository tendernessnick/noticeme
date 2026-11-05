import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkgVersion = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // AI 推理 worker（utilityProcess 入口，独立于主进程事件循环）
          'ai-worker': resolve(__dirname, 'src/main/ai/worker.ts')
        }
        // node-llama-cpp 的加载方式见 src/main/ai/worker.ts：拼接模块名 + @vite-ignore
        // 使动态 import() 不可静态分析，从而在 CJS 输出中原样保留（rollup 4 已移除 renderDynamicImport）
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    define: {
      // 设置页版本号从 package.json 注入，避免硬编码过期
      __APP_VERSION__: JSON.stringify(pkgVersion)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          alert: resolve(__dirname, 'src/renderer/alert.html')
        }
      }
    }
  }
})
