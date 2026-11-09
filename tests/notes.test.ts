// 笔记文件夹纯函数测试：子树收集（级联删除依据）
import { describe, expect, it } from 'vitest'
import { collectFolderSubtree } from '../src/shared/notes'
import type { NoteFolder } from '../src/shared/types'

function folder(id: string, parentId: string | null): NoteFolder {
  return { id, name: id, color: '#64748b', parentId, createdAt: '2026-01-01T00:00:00.000Z' }
}

describe('collectFolderSubtree', () => {
  const tree = [
    folder('default', null),
    folder('work', null),
    folder('proj-a', 'work'),
    folder('proj-a1', 'proj-a'),
    folder('proj-a2', 'proj-a'),
    folder('life', null)
  ]

  it('叶子根节点 → 只含自身', () => {
    const s = collectFolderSubtree(tree, 'life')
    expect(s.size).toBe(1)
    expect(s.has('life')).toBe(true)
  })

  it('多级父节点 → 含全部后代（孙子层级）', () => {
    const s = collectFolderSubtree(tree, 'proj-a')
    expect(s).toEqual(new Set(['proj-a', 'proj-a1', 'proj-a2']))
  })

  it('中间层父节点 → 收集整个分支且不波及兄弟分支', () => {
    const s = collectFolderSubtree(tree, 'work')
    expect(s.has('work')).toBe(true)
    expect(s.has('proj-a')).toBe(true)
    expect(s.has('proj-a1')).toBe(true)
    expect(s.has('proj-a2')).toBe(true)
    expect(s.has('default')).toBe(false)
    expect(s.has('life')).toBe(false)
  })

  it('不存在的 id → 只含自身（调用方主进程会兜底）', () => {
    expect(collectFolderSubtree(tree, 'ghost')).toEqual(new Set(['ghost']))
  })

  it('乱序数组（子在前父在后）仍能完整收集', () => {
    const scrambled = [tree[4], tree[3], tree[2], tree[1], tree[0], tree[5]]
    expect(collectFolderSubtree(scrambled, 'work').size).toBe(4)
  })
})
