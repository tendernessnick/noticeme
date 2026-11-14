/** 编辑器只提交修改的字段，保留提醒/计划等并发更新；删除过的记录不能被延迟保存复活。 */
export function patchRecord<T extends { id: string; createdAt: string; updatedAt: string }>(
  records: T[], id: string, patch: Partial<T>, protectedKeys: (keyof T)[] = []
): void {
  const index = records.findIndex(record => record.id === id)
  if (index < 0) throw new Error('记录已被删除，无法保存。请先复制未保存的内容。')
  const current = records[index]
  const safePatch = { ...patch }
  for (const key of protectedKeys) delete safePatch[key]
  records[index] = { ...current, ...safePatch, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() }
}
