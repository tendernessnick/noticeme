// 自然语言快速添加解析测试
import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../src/shared/parse'

// 固定“当前时间”：2026-11-03（周二）14:30
const NOW = new Date(2026, 10, 3, 14, 30, 0, 0)

function localISO(y: number, m: number, d: number, h: number, min: number): string {
  return new Date(y, m - 1, d, h, min).toISOString()
}

describe('parseQuickAdd · 标题抽取', () => {
  it('移除日期时间词后保留纯标题', () => {
    const r = parseQuickAdd('明天 9 点 写周报', NOW)
    expect(r.title).toBe('写周报')
    expect(r.dueAt).toBe(localISO(2026, 11, 4, 9, 0))
  })

  it('无任何标记时标题原样保留', () => {
    const r = parseQuickAdd('买一杯咖啡', NOW)
    expect(r.title).toBe('买一杯咖啡')
    expect(r.dueAt).toBeNull()
    expect(r.priority).toBeNull()
  })

  it('全部被解析词吃掉时回退为原文本', () => {
    const r = parseQuickAdd('p1', NOW)
    expect(r.title).toBe('p1')
    expect(r.priority).toBe(1)
  })
})

describe('parseQuickAdd · 优先级', () => {
  it('p1 / P2 / !3 / p4 独立词解析', () => {
    expect(parseQuickAdd('写周报 p1', NOW).priority).toBe(1)
    expect(parseQuickAdd('写周报 P2', NOW).priority).toBe(2)
    expect(parseQuickAdd('写周报 !3', NOW).priority).toBe(3)
    expect(parseQuickAdd('写周报 p4', NOW).priority).toBe(4)
  })

  it('词中出现的字母数字不算优先级', () => {
    expect(parseQuickAdd('读p1报告', NOW).priority).toBeNull()
    expect(parseQuickAdd('读p1报告', NOW).title).toBe('读p1报告')
  })
})

describe('parseQuickAdd · 日期', () => {
  it('今天', () => {
    const r = parseQuickAdd('今天 20 点 开会', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 3, 20, 0))
  })

  it('后天', () => {
    const r = parseQuickAdd('后天 下午2点 大扫除', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 5, 14, 0))
    expect(r.title).toBe('大扫除')
  })

  it('周五 → 本周内最近的周五', () => {
    const r = parseQuickAdd('周五 交报告', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 6, 9, 0))
  })

  it('下周一 → 下周一（非本周）', () => {
    const r = parseQuickAdd('下周一 晨会', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 16, 9, 0))
  })

  it('X月X日（今年未过则今年）', () => {
    const r = parseQuickAdd('11月5日 14:00 体检', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 5, 14, 0))
  })

  it('X月X日（已过则明年）', () => {
    const r = parseQuickAdd('1月10日 体检', NOW)
    expect(r.dueAt).toBe(localISO(2027, 1, 10, 9, 0))
  })

  it('YYYY-MM-DD', () => {
    const r = parseQuickAdd('2026-11-05 体检', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 5, 9, 0))
  })
})

describe('parseQuickAdd · 时间', () => {
  it('N分钟后', () => {
    const r = parseQuickAdd('30分钟后 取快递', NOW)
    expect(r.dueAt).toBe(new Date(NOW.getTime() + 30 * 60000).toISOString())
    expect(r.title).toBe('取快递')
  })

  it('下午3点半', () => {
    const r = parseQuickAdd('下午3点半 讨论', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 3, 15, 30))
  })

  it('中文数字：晚上八点', () => {
    const r = parseQuickAdd('晚上八点 泡脚', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 3, 20, 0))
  })

  it('只给时间且已过 → 明天同一时间', () => {
    const r = parseQuickAdd('9点 散步', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 4, 9, 0))
  })

  it('只给日期没给时间且默认时刻已过 → 明天', () => {
    const r = parseQuickAdd('今天 写日志', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 4, 9, 0))
  })

  it('HH:mm 24 小时制', () => {
    const r = parseQuickAdd('23:45 收桌面', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 3, 23, 45))
  })
})

describe('parseQuickAdd · 项目与标签', () => {
  it('#项目 @标签', () => {
    const r = parseQuickAdd('#工作 @电脑 明天九点 写周报', NOW)
    expect(r.projectName).toBe('工作')
    expect(r.tags).toEqual(['电脑'])
    expect(r.dueAt).toBe(localISO(2026, 11, 4, 9, 0))
    expect(r.title).toBe('写周报')
  })

  it('多个标签', () => {
    const r = parseQuickAdd('整理房间 @家 @周末', NOW)
    expect(r.tags).toEqual(['家', '周末'])
    expect(r.title).toBe('整理房间')
  })
})

describe('parseQuickAdd · 模糊日期 v2（裸几号/天后/裸下周/周末/月底/时段默认）', () => {
  it('裸「9号」→ 本月 9 日（未过）', () => {
    const r = parseQuickAdd('9号 交房租', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 9, 9, 0))
    expect(r.title).toBe('交房租')
  })

  it('用户原始场景：「9号早上9点」→ 11月9日 09:00', () => {
    const r = parseQuickAdd('9号早上9点 交房租', NOW)
    expect(r.dueAt).toBe(localISO(2026, 11, 9, 9, 0))
    expect(r.title).toBe('交房租')
  })

  it('过去的天数自动顺延下月：「1号」→ 12月1日', () => {
    const r = parseQuickAdd('1号 发工资', NOW)
    expect(r.dueAt).toBe(localISO(2026, 12, 1, 9, 0))
  })

  it('当月不存在的日期顺延：「31号」「三十一号」→ 12月31日', () => {
    expect(parseQuickAdd('31号 跨年', NOW).dueAt).toBe(localISO(2026, 12, 31, 9, 0))
    expect(parseQuickAdd('三十一号 年终奖', NOW).dueAt).toBe(localISO(2026, 12, 31, 9, 0))
  })

  it('N天后 / N天之后', () => {
    expect(parseQuickAdd('3天后 复盘', NOW).dueAt).toBe(localISO(2026, 11, 6, 9, 0))
    expect(parseQuickAdd('三天之后 总结', NOW).dueAt).toBe(localISO(2026, 11, 6, 9, 0))
  })

  it('裸「下周」→ 下周一；「下下周」→ 下下周一', () => {
    expect(parseQuickAdd('下周 复盘', NOW).dueAt).toBe(localISO(2026, 11, 9, 9, 0))
    expect(parseQuickAdd('下下周 复盘', NOW).dueAt).toBe(localISO(2026, 11, 16, 9, 0))
  })

  it('周末 → 本周六；下周末 → 下周六', () => {
    expect(parseQuickAdd('周末 体检', NOW).dueAt).toBe(localISO(2026, 11, 7, 9, 0))
    expect(parseQuickAdd('下周末 露营', NOW).dueAt).toBe(localISO(2026, 11, 14, 9, 0))
  })

  it('月底 → 本月最后一天', () => {
    expect(parseQuickAdd('月底 盘点', NOW).dueAt).toBe(localISO(2026, 11, 30, 9, 0))
  })

  it('只有时段词 → 时段默认时刻', () => {
    expect(parseQuickAdd('明天下午 交报告', NOW).dueAt).toBe(localISO(2026, 11, 4, 14, 0))
    expect(parseQuickAdd('明天晚上 洗衣服', NOW).dueAt).toBe(localISO(2026, 11, 4, 20, 0))
    expect(parseQuickAdd('明天上午 晨读', NOW).dueAt).toBe(localISO(2026, 11, 4, 9, 0))
  })

  it('月日省略单位：「11月9」→ 11月9日', () => {
    expect(parseQuickAdd('11月9 整理', NOW).dueAt).toBe(localISO(2026, 11, 9, 9, 0))
  })

  it('回归保护：周X 不被裸日期误伤', () => {
    expect(parseQuickAdd('周日 写周报', NOW).dueAt).toBe(localISO(2026, 11, 8, 9, 0))
    expect(parseQuickAdd('周五 交报告', NOW).dueAt).toBe(localISO(2026, 11, 6, 9, 0))
  })
})
