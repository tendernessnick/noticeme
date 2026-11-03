// 快速添加的自然语言解析（纯函数，中英文混排）
// 支持：今天/今晚/明天/明早/明晚/后天/大后天、周X/星期X/礼拜X/下周X/下下周X、下周（裸）、周末、
//       月初/月中/月底/年底、下个月(15号)、N分钟后、N小时后/半小时后、N天后/N天内、
//       X月X日（日/号可省）、MM-DD、M/D、YYYY-MM-DD、裸X号/X日（自动选未来最近的）、
//       HH:mm、X点/X点半/X点N分（含中文数字、早/晚单字时段）、时段词默认时刻、
//       p1-p4（!1-!4）、紧急/重要→P1、高/中/低优先级、#项目、@标签
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
  if (mer === '晚上' || mer === '夜里' || mer === '晚') return h === 12 ? 24 : h < 12 ? h + 12 : h
  if (mer === '中午') return h <= 2 ? 12 + h : h
  // 凌晨/清晨/早上/早晨/上午/早
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
  let isYearEnd = false
  /** 「今晚/明晚」语境：后续裸数字时刻（如「今晚10点」）按下午/晚间理解 */
  let eveningContext = false
  let timeInfo: { h: number; min: number } | null = null

  // 1) 优先级：p1 / P2 / !3（独立词）
  text = text.replace(/(?:^|\s)[p!]([1-4])(?=\s|$)/i, (_m, g1: string) => {
    priority = Number(g1) as Priority
    return ' '
  })
  // 1.1) 中文优先级词（独立词，不覆盖已显式给出的 p 值）
  text = text.replace(/(?:^|\s)(紧急|重要|要紧)(?=\s|$)/g, () => {
    if (priority === null) priority = 1
    return ' '
  })
  text = text.replace(/(?:^|\s)高优先级(?=\s|$)/g, () => {
    if (priority === null) priority = 2
    return ' '
  })
  text = text.replace(/(?:^|\s)中优先级(?=\s|$)/g, () => {
    if (priority === null) priority = 3
    return ' '
  })
  text = text.replace(/(?:^|\s)低优先级(?=\s|$)/g, () => {
    if (priority === null) priority = 4
    return ' '
  })

  // 2) 相对时间
  const setRelMin = (n: number): void => {
    if (relativeMinutes === null) relativeMinutes = n
  }
  //    N分钟后 / N分钟之后 / N分钟内（阿拉伯与中文数字：一分钟后 / 十分钟之后 / 100分钟后）
  text = text.replace(
    new RegExp(`((?:\\d{1,4})|(?:[一二两三四五六七八九十]+))\\s*分钟\\s*(?:之|过)?\\s*(后|内)`, 'g'),
    (_m, g1: string) => {
      const n = cnNum(g1)
      if (Number.isNaN(n) || n < 1 || n > 10080) return _m // 无法解析的保留原文
      setRelMin(n)
      return ' '
    }
  )
  //    N小时后 / 半小时后 / N个小时之内 / N个钟头后
  const hoursLater = text.match(
    /(半|(?:\d{1,2}|[一二两三四五六七八九十]+))\s*个?\s*(?:小时|钟头)\s*(?:之|过)?\s*(?:后|内)/
  )
  if (hoursLater) {
    const n = hoursLater[1] === '半' ? 0.5 : cnNum(hoursLater[1])
    if (!Number.isNaN(n) && n > 0 && n <= 72) {
      setRelMin(Math.round(n * 60))
      text = text.replace(hoursLater[0], ' ')
    }
  }
  //    一刻钟 / 三刻钟 / 两刻钟内（每刻 = 15 分钟）
  const quarter = text.match(new RegExp(`(${CN_NUM})?\\s*刻钟\\s*(?:之|过)?\\s*(?:后|内)`))
  if (quarter) {
    const n = quarter[1] ? cnNum(quarter[1]) : 1
    if (!Number.isNaN(n) && n >= 1 && n <= 8) {
      setRelMin(n * 15)
      text = text.replace(quarter[0], ' ')
    }
  }

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

    // 3.1) N天后 / 三天之后 / N天内 / 三天之内（含中文数字；「内」按截止语义同样向前推 N 天）
    const daysLater = text.match(new RegExp(`(${CN_NUM})\\s*天\\s*(?:之|过)?\\s*(?:后|内)`))
    if (daysLater) {
      const n = cnNum(daysLater[1])
      if (!Number.isNaN(n) && n >= 0 && n <= 365) {
        const d = addDays(today, n)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        text = text.replace(daysLater[0], ' ')
      }
    }

    // 3.2) 今天/今早/今晚/明天/明早/明晚/后天/大后天
    if (!dateInfo) {
      const rel = text.match(/(大后天|后天|明晚|明早|今早|明天|明日|今晚|今天|今日)/)
      if (rel) {
        const w = rel[1]
        let add = 0
        let forcedHour: number | null = null
        if (w === '明天' || w === '明日') add = 1
        else if (w === '后天') add = 2
        else if (w === '大后天') add = 3
        else if (w === '明早') { add = 1; forcedHour = 8 }
        else if (w === '明晚') { add = 1; forcedHour = 20; eveningContext = true }
        else if (w === '今晚') eveningContext = true
        else if (w === '今早') { forcedHour = 8 }
        const d = addDays(today, add)
        dateInfo = mkInfo(d.getFullYear(), d.getMonth() + 1, d.getDate())
        // 后文没有显式时刻时，才使用词条自带默认时刻
        const hasExplicitTime = /\d{1,2}\s*[点时]|\d{1,2}:\d{2}/.test(text.replace(rel[0], ''))
        if (!hasExplicitTime) {
          if (forcedHour !== null) timeInfo = { h: forcedHour, min: 0 }
          else if (w === '今晚') timeInfo = { h: 20, min: 0 }
        }
        text = text.replace(rel[0], ' ')
      }
    }

    // 3.3) 周X / 星期X / 礼拜X / 下周X / 下礼拜X（「下」前缀必须与「周X」整体匹配，避免可选组回溯丢失前缀）
    if (!dateInfo) {
      const wm = text.match(/(下{1,2})?(?:周|星期|礼拜)([一二三四五六日天])/)
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

    // 3.6) 下个月 / 下月（可带日子：下个月15号；不带则取同日，超出月末自动钳制）
    if (!dateInfo) {
      const nm = text.match(new RegExp(`下个?月\\s*(?:(${CN_NUM})\\s*[号日]?)?`))
      if (nm) {
        let y = now.getFullYear()
        let m0 = now.getMonth() + 1
        if (m0 > 11) {
          m0 = 0
          y += 1
        }
        const day = nm[1] ? cnNum(nm[1]) : now.getDate()
        dateInfo = mkInfo(y, m0 + 1, Math.min(Math.max(1, day), daysInMonth(y, m0)))
        text = text.replace(nm[0], ' ')
      }
    }

    // 3.7) 绝对日期
    if (!dateInfo) {
      const ymd = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
      const mdCn = text.match(/(\d{1,2})月\s*(\d{1,2})[日号]?/) // 日/号可省略：11月9
      const mdSlash = text.match(/(\d{1,2})\/(\d{1,2})/)
      const bareDay = text.match(new RegExp(`(${CN_NUM})\\s*[号日]`)) // 裸几号：9号 / 十九号
      const anchor = text.match(/(年底|年末|月初|月中|月末|月底)/)
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
      } else if (anchor) {
        const a = anchor[1]
        if (a === '月底' || a === '月末') {
          dateInfo = mkInfo(now.getFullYear(), now.getMonth() + 1, daysInMonth(now.getFullYear(), now.getMonth()))
          isMonthEnd = true
        } else if (a === '年底' || a === '年末') {
          dateInfo = mkInfo(now.getFullYear(), 12, 31)
          isYearEnd = true
        } else {
          // 月初 → 1 日；月中 → 15 日（若本月已过则顺延到下个月）
          const day = a === '月初' ? 1 : 15
          let y = now.getFullYear()
          let m0 = now.getMonth()
          if (day < now.getDate()) {
            m0 += 1
            if (m0 > 11) {
              m0 = 0
              y += 1
            }
          }
          dateInfo = mkInfo(y, m0 + 1, day)
        }
        text = text.replace(anchor[0], ' ')
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
    let h = Number(colon[1])
    const min = Number(colon[2])
    if (h <= 23 && min <= 59) {
      if (eveningContext && h < 12) h += 12 // 今晚10:30 → 22:30
      timeInfo = { h, min }
      text = text.replace(colon[0], ' ')
    }
  }
  if (!timeInfo) {
    const oclock = text.match(
      new RegExp(`(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|早|晚)?\\s*(${CN_NUM})\\s*[点时](?:半|一刻|三刻|(${CN_NUM})\\s*分?|整)?`)
    )
    if (oclock) {
      const mer = oclock[1]
      let hRaw = cnNum(oclock[2])
      const mRaw = oclock[3] ? cnNum(oclock[3]) : 0
      if (!Number.isNaN(hRaw) && hRaw <= 24 && mRaw <= 59) {
        if (eveningContext && !mer && hRaw < 12) hRaw += 12 // 今晚9点 → 21:00
        // 分钟部分：半=30，一刻=15，三刻=45，N分=N，整=0
        let min = 0
        const seg = oclock[0]
        if (seg.includes('半')) min = 30
        else if (seg.includes('一刻')) min = 15
        else if (seg.includes('三刻')) min = 45
        else if (oclock[3] !== undefined) min = mRaw
        timeInfo = { h: applyMeridiem(hRaw, mer), min }
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
    // 只给了日期没给时间：若该日默认时刻已过 → 顺延（月底→下个月底，年底→明年年底，其余→明天）
    if (!timeInfo && dt.getTime() <= now.getTime()) {
      if (isMonthEnd) dt.setMonth(dt.getMonth() + 2, 0)
      else if (isYearEnd) dt.setFullYear(dt.getFullYear() + 1, 11, 31)
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
