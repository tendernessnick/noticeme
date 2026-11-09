// 今日聚焦建议校验测试：解析 / 幻觉 id 过滤 / 去重截断 / 容错
import { describe, expect, it } from 'vitest'
import { validateSuggestions } from '../src/shared/ai-schema'

const IDS = ['a', 'b', 'c']

describe('validateSuggestions', () => {
  it('正常解析 picks', () => {
    const raw = JSON.stringify({ picks: [{ id: 'a', reason: '已逾期' }, { id: 'b', reason: '明天截止' }] })
    expect(validateSuggestions(raw, IDS)).toEqual([
      { taskId: 'a', reason: '已逾期' },
      { taskId: 'b', reason: '明天截止' }
    ])
  })

  it('过滤候选集之外的 id（兜住模型幻觉）', () => {
    const raw = JSON.stringify({ picks: [{ id: 'a', reason: 'x' }, { id: 'ghost', reason: 'y' }] })
    expect(validateSuggestions(raw, IDS).map(s => s.taskId)).toEqual(['a'])
  })

  it('去重 + 截断过长理由 + 最多 8 条', () => {
    const picks: Array<{ id: string; reason: string }> = []
    for (let i = 0; i < 12; i++) picks.push({ id: 'a', reason: '重复条目' })
    picks.push({ id: 'b', reason: 'r'.repeat(100) })
    const out = validateSuggestions(JSON.stringify({ picks }), IDS)
    expect(out.map(s => s.taskId)).toEqual(['a', 'b'])
    expect(out[1].reason.length).toBeLessThanOrEqual(40)
  })

  it('非 JSON / 缺 picks / picks 非数组 → 空数组', () => {
    expect(validateSuggestions('not json', IDS)).toEqual([])
    expect(validateSuggestions(JSON.stringify({ other: 1 }), IDS)).toEqual([])
    expect(validateSuggestions('{"picks":"x"}', IDS)).toEqual([])
  })

  it('带前后噪声的 JSON（最外层花括号截取）', () => {
    const raw = '好的，以下是建议：{"picks":[{"id":"c","reason":"周五截止"}]} 请确认'
    expect(validateSuggestions(raw, IDS).map(s => s.taskId)).toEqual(['c'])
  })
})
