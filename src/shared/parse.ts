// 快速添加的自然语言解析（纯函数，中英文混排）
// 支持：今天/今晚/明天/后天/大后天、周X/下周X/下下周X、X月X日、MM-DD、M/D、YYYY-MM-DD、
//       HH:mm、X点/X点半/X点N分、凌晨/早上/上午/中午/下午/晚上、N分钟后、p1-p4（!1-!4）、#项目、@标签
import type { Priority } from './types'
import { addDays, startOfDay } from './datetime'

export interface ParsedQuickAdd {
  title: string
  dueAt: string | null
  priority: Priority | null
  tags: string[]
  projectName: string | null
}

const WEEKDAY_CN: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}

/** 中文数字 → 阿拉伯数字（支持 一~九十九：八 / 十二 / 二十 / 二十三） */
function cnNum(s: string): number {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const tenIdx = s.indexOf('十')
  if (tenIdx === -1) return CN_DIGITS[s] ?? NaN
  const before = s.slice(0, tenIdx)
  const after = s.slice(tenIdx + 1)
  const b = before ? CN_DIGITS[before] : 1
  const a = after ? CN_DIGITS[after] : 0
  if (Number.isNaN(b) || Number.isNaN(a)) return NaN
  return b * 10 + a
}

const DEFAULT_HOUR = 9

interface DateInfo {
  y: number
  m: number
  d: number
  /** 是否由「无年份的绝对日期」解析而来（用于过去日期推进下一年） */
  yearless: boolean
}

function applyMeridiem(h: number, mer: string | undefined): number {
  if (!mer) return h
  if (mer === '下午' || mer === '傍晚') return h < 12 ? h + 12 : h
  if (mer === '晚上' || mer === '夜里') return h === 12 ? 24 : h < 12 ? h + 12 : h
  if (mer === '中午') return h <= 2 ? 12 + h : h
  // 凌晨/清晨/早上/早晨/上午
  return h === 12 ? 0 : h
}

export function parseQuickAdd(input: string, now: Date = new Date()): ParsedQuickAdd {
  let text = ` ${input} `
  let priority: Priority | null = null
  const tags: string[] = []
  let projectName: string | null = null
  let relativeMinutes: number | null = null
  let dateInfo: DateInfo | null = null
  let timeInfo: { h: number; min: number } | null = null

  // 1) 优先级：p1 / P2 / !3（独立词）
  text = text.replace(/(?:^|\s)[p!]([1-4])(?=\s|$)/i, (_m, g1: string) => {
    priority = Number(g1) as Priority
    return ' '
  })

  // 2) 相对时间：N分钟后（必须带「后」）
  text = text.replace(/(\d{1,4})\s*分钟后/g, (_m, g1: string) => {
    relativeMinutes = Number(g1)
    return ' '
  })

  // 3) 日期
  if (relativeMinutes === null) {
    const rel = text.match(/(大后天|后天|明天|明日|今晚|今天|今日)/)
    // 「下」前缀必须与「周X」整体匹配，避免可选组回溯丢失前缀
    const wm = text.match(/(下{1,2})?(?:周|星期)([一二三四五六日天])/)
    if (rel) {
      const w = rel[1]
      const add = w === '明天' || w === '明日' ? 1 : w === '后天' ? 2 : w === '大后天' ? 3 : 0
      const d = addDays(startOfDay(now), add)
      dateInfo = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), yearless: false }
      // 「今晚」且未显式给时间 → 默认 20:00
      if (w === '今晚' && !/\d{1,2}\s*[点时]|\d{1,2}:\d{2}/.test(text.replace(rel[0], ''))) {
        timeInfo = { h: 20, min: 0 }
      }
      text = text.replace(rel[0], ' ')
    } else if (wm) {
      const target = WEEKDAY_CN[wm[2]] ?? 1
      const weeks = wm[1] ? wm[1].length : 0 // 下=1，下下=2
      const cur = startOfDay(now)
      const diff = (target - cur.getDay() + 7) % 7
      const d = addDays(cur, diff + weeks * 7)
      dateInfo = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), yearless: false }
      text = text.replace(wm[0], ' ')
    } else {
      const ymd = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
      const mdCn = text.match(/(\d{1,2})月(\d{1,2})[日号]/)
      const mdSlash = text.match(/(\d{1,2})\/(\d{1,2})/)
      if (ymd) {
        dateInfo = { y: Number(ymd[1]), m: Number(ymd[2]), d: Number(ymd[3]), yearless: false }
        text = text.replace(ymd[0], ' ')
      } else if (mdCn) {
        dateInfo = { y: now.getFullYear(), m: Number(mdCn[1]), d: Number(mdCn[2]), yearless: true }
        text = text.replace(mdCn[0], ' ')
      } else if (mdSlash) {
        dateInfo = { y: now.getFullYear(), m: Number(mdSlash[1]), d: Number(mdSlash[2]), yearless: true }
        text = text.replace(mdSlash[0], ' ')
      }
      // 无年份的过去日期 → 明年
      if (dateInfo?.yearless) {
        const cand = new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d)
        if (cand.getTime() < startOfDay(now).getTime()) dateInfo.y += 1
      }
    }
  }

  // 4) 时间
  const colon = text.match(/(\d{1,2}):(\d{2})/)
  if (colon) {
    const h = Number(colon[1])
    const min = Number(colon[2])
    if (h <= 23 && min <= 59) {
      timeInfo = { h, min }
      text = text.replace(colon[0], ' ')
    }
  }
  if (!timeInfo) {
    const CN_NUM = '\\d{1,2}|[一二两三四五六七八九十]+'
    const oclock = text.match(
      new RegExp(`(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\\s*(${CN_NUM})\\s*[点时](?:半|(${CN_NUM})\\s*分?)?`)
    )
    if (oclock) {
      const mer = oclock[1]
      const hRaw = cnNum(oclock[2])
      const mRaw = oclock[3] ? cnNum(oclock[3]) : 0
      if (!Number.isNaN(hRaw) && hRaw <= 24 && mRaw <= 59) {
        timeInfo = { h: applyMeridiem(hRaw, mer), min: oclock[0].includes('半') ? 30 : mRaw }
        text = text.replace(oclock[0], ' ')
      }
    }
  }

  // 5) 项目与标签
  const pm = text.match(/#([^\s#@]+)/)
  if (pm) {
    projectName = pm[1]
    text = text.replace(pm[0], ' ')
  }
  text = text.replace(/@([^\s#@]+)/g, (_m, g1: string) => {
    tags.push(g1)
    return ' '
  })

  // 6) 组装
  const title = text.replace(/\s+/g, ' ').trim() || input.trim()
  let dueDate: Date | null = null
  if (relativeMinutes !== null) {
    dueDate = new Date(now.getTime() + relativeMinutes * 60000)
  } else if (dateInfo) {
    const t = timeInfo ?? { h: DEFAULT_HOUR, min: 0 }
    const dt = new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d, t.h, t.min)
    // 只给了日期没给时间：若今天默认时刻已过 → 明天
    if (!timeInfo && dt.getTime() <= now.getTime()) dt.setDate(dt.getDate() + 1)
    // 给了时间没给日期：默认今天，已过 → 明天
    if (!dateInfo && timeInfo && dt.getTime() <= now.getTime()) dt.setDate(dt.getDate() + 1)
    dueDate = dt
  } else if (timeInfo) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), timeInfo.h, timeInfo.min)
    if (dt.getTime() <= now.getTime()) dt.setDate(dt.getDate() + 1)
    dueDate = dt
  }

  return {
    title,
    dueAt: dueDate ? dueDate.toISOString() : null,
    priority,
    tags,
    projectName
  }
}
