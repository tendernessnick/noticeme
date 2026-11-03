// 生成提示音 resources/chime.wav（纯 Node 合成，无第三方依赖）
// 「叮-咚」双音：B5 -> E6，带柔和包络
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

const SR = 44100
const DUR = 1.2
const N = Math.round(SR * DUR)
const data = new Float32Array(N)

const notes = [
  { f: 987.77, start: 0.0, dur: 0.5, amp: 0.3 }, // B5
  { f: 1318.51, start: 0.16, dur: 0.9, amp: 0.26 } // E6
]

for (const n of notes) {
  const s0 = Math.round(n.start * SR)
  const s1 = Math.min(N, Math.round((n.start + n.dur) * SR))
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR
    const env = Math.min(1, t / 0.01) * Math.exp(-t * 4.5)
    data[i] += n.amp * env * Math.sin(2 * Math.PI * n.f * t)
    data[i] += n.amp * 0.25 * env * Math.sin(2 * Math.PI * n.f * 2 * t)
  }
}

let peak = 0
for (const v of data) peak = Math.max(peak, Math.abs(v))
const gain = peak > 0 ? 0.9 / peak : 1

const pcm = Buffer.alloc(N * 2)
for (let i = 0; i < N; i++) {
  let v = Math.max(-1, Math.min(1, data[i] * gain))
  const tail = (N - i) / SR
  if (tail < 0.05) v *= tail / 0.05
  pcm.writeInt16LE(Math.round(v * 32767), i * 2)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // mono
header.writeUInt32LE(SR, 24)
header.writeUInt32LE(SR * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)

writeFileSync(join(outDir, 'chime.wav'), Buffer.concat([header, pcm]))
console.log('✓ resources/chime.wav 已生成')
