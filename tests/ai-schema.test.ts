// AI 草稿校验与合并策略单测（纯函数，不依赖模型运行时）
import { describe, expect, it } from 'vitest'
import { mergeQuickAdd, validateDrafts, type TaskDraft } from '../src/shared/ai-schema'
import type { ParsedQuickAdd } from '../src/shared/parse'

const NOW = new Date('2026-11-04T10:00:00')

const regexResult = (p: Partial<ParsedQuickAdd> = {}): ParsedQuickAdd => ({
  title: '原始标题',
  dueAt: null,
  priority: null,
  tags: [],
  projectName: null,
  ...p
})

const draft = (p: Partial<TaskDraft>): TaskDraft => ({
  title: '任务',
  dueAt: null,
  priority: null,
  tags: [],
  projectName: null,
  ...p
})

describe('validateDrafts', () => {
  it('解析标准输出（本地时间字符串转 ISO）', () => {
    const raw = JSON.stringify({
      tasks: [{ title: '交房租', dueAt: '2026-11-09T09:00:00', priority: '1', tags: ['生活'], projectName: '' }]
    })
    expect(validateDrafts(raw, NOW)).toEqual([
      { title: '交房租', dueAt: new Date('2026-11-09T09:00:00').toISOString(), priority: 1, tags: ['生活'], projectName: null }
    ])
  })

  it('空字符串字段归一为 null / 空数组', () => {
    const raw = JSON.stringify({
      tasks: [{ title: '取快递', dueAt: '', priority: '', tags: [], projectName: '' }]
    })
    expect(validateDrafts(raw, NOW)).toEqual([
      { title: '取快递', dueAt: null, priority: null, tags: [], projectName: null }
    ])
  })

  it('幻觉的过去日期归 null（草稿保留），容忍窗内的近过去保留原值', () => {
    const raw = JSON.stringify({
      tasks: [
        { title: 'A', dueAt: '2020-01-01T09:00:00', priority: '', tags: [], projectName: '' },
        { title: 'B', dueAt: '2026-11-04T08:00:00', priority: '', tags: [], projectName: '' }
      ]
    })
    const out = validateDrafts(raw, NOW)
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('A')
    expect(out[0].dueAt).toBeNull() // 距今超过 12 小时的过去 = 模型幻觉，丢弃日期
    expect(out[1].title).toBe('B')
    expect(out[1].dueAt).not.toBeNull() // 2 小时前 = 「刚才/刚刚」类表达，容忍
  })

  it('无效 JSON 返回空数组', () => {
    expect(validateDrafts('这不是 json', NOW)).toEqual([])
    expect(validateDrafts('{"tasks": 42}', NOW)).toEqual([])
  })

  it('单条无效只丢弃该条', () => {
    const raw = JSON.stringify({
      tasks: [
        { title: '', dueAt: '', priority: '', tags: [], projectName: '' },
        { title: '有效任务', dueAt: '', priority: '3', tags: [], projectName: '' }
      ]
    })
    const out = validateDrafts(raw, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('有效任务')
    expect(out[0].priority).toBe(3)
  })

  it('非法优先级降级为 null，标签去重截断', () => {
    const raw = JSON.stringify({
      tasks: [{ title: 'X', dueAt: '', priority: '9', tags: ['a', 'a', 'b', 'c', 'd', 'e', 'f'], projectName: '很长'.repeat(20) }]
    })
    const out = validateDrafts(raw, NOW)[0]
    expect(out.priority).toBeNull()
    expect(out.tags).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(out.projectName!.length).toBeLessThanOrEqual(30)
  })

  it('最多 8 条 + 重复任务去重', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `任务${i % 10}`,
      dueAt: '',
      priority: '',
      tags: [],
      projectName: ''
    }))
    const out = validateDrafts(JSON.stringify({ tasks: items }), NOW)
    expect(out).toHaveLength(8)
  })

  it('接受带前后杂音的 JSON 文本', () => {
    const raw = '  前缀 {"tasks":[{"title":"M","dueAt":"","priority":"","tags":[],"projectName":""}]} 后缀 '
    expect(validateDrafts(raw, NOW)[0].title).toBe('M')
  })
})

describe('mergeQuickAdd', () => {
  it('AI 兜底路径：AI 的标题与截止时间生效，正则字段优先', () => {
    const regex = regexResult({ title: '周五之前交报告', priority: 2, tags: ['工作'] })
    const ai = draft({ title: '交报告', dueAt: '2026-11-06T09:00:00.000Z', projectName: '项目A' })
    const merged = mergeQuickAdd(regex, ai)
    expect(merged.title).toBe('交报告')
    expect(merged.dueAt).toBe('2026-11-06T09:00:00.000Z')
    expect(merged.priority).toBe(2)
    expect(merged.tags).toEqual(['工作'])
    expect(merged.projectName).toBe('项目A')
  })

  it('AI 无截止时间时保留正则结果（正则也可能给出非 due 语义的 null）', () => {
    const regex = regexResult({ title: '买咖啡豆', tags: [] })
    const ai = draft({ title: '买咖啡豆', dueAt: null })
    expect(mergeQuickAdd(regex, ai).dueAt).toBeNull()
  })

  it('标签取并集且上限 5', () => {
    const regex = regexResult({ tags: ['a', 'b'] })
    const ai = draft({ tags: ['b', 'c', 'd', 'e', 'f', 'g'] })
    expect(mergeQuickAdd(regex, ai).tags).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('AI 标题为空时回退正则标题', () => {
    const merged = mergeQuickAdd(regexResult({ title: '原始标题' }), draft({ title: '' }))
    expect(merged.title).toBe('原始标题')
  })
})
