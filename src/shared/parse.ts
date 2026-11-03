// 快速添加的自然语言解析（纯函数，中英文混排）
// 支持：今天/今晚/明天/后天/大后天、周X/下周X/下下周X、下周（裸）、周末、月底、N分钟后、N天后、
//       X月X日（日/号可省）、MM-DD、M/D、YYYY-MM-DD、裸X号/X日（自动选未来最近的）、
//       HH:mm、X点/X点半/X点N分（含中文数字）、凌晨/早上/上午/中午/下午/晚上（可无具体时刻）、
//       p1-p4（!1-!4）、#项目、@标签
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

/** 中文/阿拉伯数字通配片段（正则用） */
const CN_NUM = '\\d{1,2}|[一二两三四五六七八九十]+'

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

/** 只有时段词、没有具体时刻时的默认时刻 */
const MERIDIEM_DEFAULT_HOUR: Record<string, number> = {
  凌晨: 6, 清晨: 6, 早上: 8, 早晨: 8, 上午: 9,
  中午: 12, 下午: 14, 傍晚: 18, 晚上: 20, 夜里: 21
}

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
  let isMonthEnd = false
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

  // 2.1) 项目与标签先提取（防止 @周末、#6月会 之类被日期解析误伤）
  const pm = text.match(/#([^\s#@]+)/)
  if (pm) {
    projectName = pm[1]
    text = text.replace(pm[0], ' ')
  }
  text = text.replace(/@([^\s#@]+)/g, (_m, g1: string) => {
    tags.push(g1)
    return ' '
  })

  // 3) 日期（模糊匹配，按特异性从高到低尝试）
  if (relativeMinutes === null) {
    const today = startOfDay(now)
    const daysInMonth = (y: number, m0: number): number => new Date(y, m0 + 1, 0).getDate()
    const mkInfo = (y: number, m: number, d: number, yearless = false): DateInfo => ({ y, m, d, yearless })

    // 3.1) N天后 / N天之后（含中文数字）
    const daysLater = text.match(new RegExp(`(${CN_NUM})\\s*天\\s*(?:之|过)?\\s*后`))
    if (daysLater) {
      const n = cnNum(daysLater[1])
      if (!Number.isNaN(n) && n >= 0 && n <= 365) {
        const d = addDays(today, n)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        text = text.replace(daysLater[0], ' ')
      }
    }

    // 3.2) 今天/今晚/明天/后天/大后天
    if (!dateInfo) {
      const rel = text.match(/(大后天|后天|明天|明日|今晚|今天|今日)/)
      if (rel) {
        const w = rel[1]
        const add = w === '明天' || w === '明日' ? 1 : w === '后天' ? 2 : w === '大后天' ? 3 : 0
        const d = addDays(today, add)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        // 「今晚」且未显式给时间 → 默认 20:00
        if (w === '今晚' && !/\d{1,2}\s*[点时]|\d{1,2}:\d{2}/.test(text.replace(rel[0], ''))) {
          timeInfo = { h: 20, min: 0 }
        }
        text = text.replace(rel[0], ' ')
      }
    }

    // 3.3) 周X / 星期X / 下周X（「下」前缀必须与「周X」整体匹配，避免可选组回溯丢失前缀）
    if (!dateInfo) {
      const wm = text.match(/(下{1,2})?(?:周|星期)([一二三四五六日天])/)
      if (wm) {
        const target = WEEKDAY_CN[wm[2]] ?? 1
        const weeks = wm[1] ? wm[1].length : 0 // 下=1，下下=2
        const diff = (target - today.getDay() + 7) % 7
        const d = addDays(today, diff + weeks * 7)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        text = text.replace(wm[0], ' ')
      }
    }

    // 3.4) 周末（默认本周六；「下周末」=下周六；周日输入「周末」指下周六）
    if (!dateInfo) {
      const wk = text.match(/(下下周末|下周末|本周末|周末)/)
      if (wk) {
        let diff = (6 - today.getDay() + 7) % 7
        if (wk[1] === '下周末') diff += 7
        if (wk[1] === '下下周末') diff += 14
        const d = addDays(today, diff)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        text = text.replace(wk[0], ' ')
      }
    }

    // 3.5) 裸「下周 / 下下周」→ 下周一 / 下下周一
    if (!dateInfo) {
      const bw = text.match(/下下周|下周/)
      if (bw) {
        const extra = bw[0] === '下下周' ? 7 : 0
        let diff = (1 - today.getDay() + 7) % 7
        if (diff === 0) diff = 7 // 周一输入「下周」→ 下周一
        const d = addDays(today, diff + extra)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        text = text.replace(bw[0], ' ')
      }
    }

    // 3.6) 绝对日期
    if (!dateInfo) {
      const ymd = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
      const mdCn = text.match(/(\d{1,2})月\s*(\d{1,2})[日号]?/) // 日/号可省略：11月9
      const mdSlash = text.match(/(\d{1,2})\/(\d{1,2})/)
      const bareDay = text.match(new RegExp(`(${CN_NUM})\\s*[号日]`)) // 裸几号：9号 / 十九号
      const monthEnd = text.match(/月底|月末/)
      if (ymd) {
        dateInfo = mkInfo(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
        text = text.replace(ymd[0], ' ')
      } else if (mdCn) {
        dateInfo = mkInfo(now.getFullYear(), Number(mdCn[1]), Number(mdCn[2]), true)
        text = text.replace(mdCn[0], ' ')
      } else if (mdSlash) {
        dateInfo = mkInfo(now.getFullYear(), Number(mdSlash[1]), Number(mdSlash[2]), true)
        text = text.replace(mdSlash[0], ' ')
      } else if (bareDay) {
        const day = cnNum(bareDay[1])
        if (!Number.isNaN(day) && day >= 1 && day <= 31) {
          let y = now.getFullYear()
          let m0 = now.getMonth()
          // 过了当月这一天 → 顺延一个月（只顺延一次）
          if (day < now.getDate()) {
            m0 += 1
            if (m0 > 11) {
              m0 = 0
              y += 1
            }
          }
          // 当月不存在的日期（如 11 月输入 31 号）→ 继续顺延到存在的月份
          let guard = 0
          while (day > daysInMonth(y, m0) && guard < 12) {
            m0 += 1
            if (m0 > 11) {
              m0 = 0
              y += 1
            }
            guard++
          }
          dateInfo = mkInfo(y, m0 + 1, Math.min(day, daysInMonth(y, m0)), true)
          text = text.replace(bareDay[0], ' ')
        }
      } else if (monthEnd) {
        dateInfo = mkInfo(now.getFullYear(), now.getMonth() + 1, daysInMonth(now.getFullYear(), now.getMonth()))
        isMonthEnd = true
        text = text.replace(monthEnd[0], ' ')
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
  // 4.1) 只有时段词、没有具体时刻 → 按时段给默认时刻（如「明天下午 回复邮件」→ 14:00）
  if (!timeInfo) {
    const merOnly = text.match(/凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里/)
    if (merOnly) {
      const h = MERIDIEM_DEFAULT_HOUR[merOnly[0]]
      if (h !== undefined) {
        timeInfo = { h, min: 0 }
        text = text.replace(merOnly[0], ' ')
      }
    }
  }

  // 5) 组装
  const title = text.replace(/\s+/g, ' ').trim() || input.trim()
  let dueDate: Date | null = null
  if (relativeMinutes !== null) {
    dueDate = new Date(now.getTime() + relativeMinutes * 60000)
  } else if (dateInfo) {
    const t = timeInfo ?? { h: DEFAULT_HOUR, min: 0 }
    const dt = new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d, t.h, t.min)
    // 只给了日期没给时间：若该日默认时刻已过 → 明天（月底则顺延到下个月底）
    if (!timeInfo && dt.getTime() <= now.getTime()) {
      if (isMonthEnd) dt.setMonth(dt.getMonth() + 2, 0)
      else dt.setDate(dt.getDate() + 1)
    }
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
