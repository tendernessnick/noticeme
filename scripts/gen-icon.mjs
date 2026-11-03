// 生成应用图标（纯 Node 实现，无第三方依赖）：resources/icon.png + icon.ico
// 图案：靛紫渐变圆角方块 + 白色铃铛
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

const S = 256
const px = new Uint8Array(S * S * 4)

function setPixel(x, y, r, g, b, a) {
  const i = (y * S + x) * 4
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
}

const R = 56
function insideRounded(x, y) {
  const cx = Math.min(Math.max(x, R), S - R)
  const cy = Math.min(Math.max(y, R), S - R)
  const dx = x - cx, dy = y - cy
  return dx * dx + dy * dy <= R * R
}

function insideBell(x, y) {
  // 铃铛主体（椭圆穹顶）
  const dx = (x - 128) / 52, dy = (y - 116) / 50
  if (dx * dx + dy * dy <= 1 && y >= 66 && y <= 148) return true
  // 顶部提钮
  const kx = x - 128, ky = y - 64
  if (kx * kx + ky * ky <= 64) return true
  // 下摆外扩
  if (y > 148 && y <= 162) {
    const hw = 52 + (y - 148) * 0.9
    return Math.abs(x - 128) <= hw
  }
  // 底部横杠
  if (y > 166 && y <= 178 && Math.abs(x - 128) <= 66) return true
  // 铃锤
  const cx = x - 128, cy = y - 190
  if (cx * cx + cy * cy <= 100) return true
  return false
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (!insideRounded(x, y)) continue
    const t = (x + y) / (2 * (S - 1))
    let r = Math.round(99 + (139 - 99) * t) // #6366f1 -> #8b5cf6
    let g = Math.round(102 + (92 - 102) * t)
    let b = Math.round(241 + (246 - 241) * t)
    if (insideBell(x, y)) { r = 255; g = 255; b = 255 }
    setPixel(x, y, r, g, b, 255)
  }
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
writeFileSync(join(outDir, 'icon.png'), png)

// ---------- ICO 容器（内嵌 PNG，Vista+ 支持） ----------
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // count
const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0) // width 256 -> 0 表示 256
entry.writeUInt8(0, 1)
entry.writeUInt8(0, 2) // palette
entry.writeUInt8(0, 3)
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12) // data offset
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, entry, png]))

console.log('✓ resources/icon.png + icon.ico 已生成')
