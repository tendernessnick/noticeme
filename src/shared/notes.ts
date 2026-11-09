// 笔记文件夹纯函数（主进程级联删除 / 渲染端视图回退共用，不依赖 Electron）
import type { NoteFolder } from './types'

/**
 * 收集以 rootId 为根的整个子树文件夹 id 集合（含 rootId 自身）。
 * 用于删除文件夹时级联删除全部后代，防止悬空 parentId。
 */
export function collectFolderSubtree(folders: NoteFolder[], rootId: string): Set<string> {
  const doomed = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
        doomed.add(f.id)
        grew = true
      }
    }
  }
  return doomed
}
