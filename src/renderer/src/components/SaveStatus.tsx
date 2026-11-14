interface Props {
  state: 'saved' | 'pending' | 'saving' | 'error'
  error: string
  retry: () => Promise<boolean>
}

export default function SaveStatus({ state, error, retry }: Props): JSX.Element {
  return (
    <span role="status" aria-live="polite" className={state === 'error' ? 'text-red-500' : ''}>
      {state === 'error' ? (
        <>
          <span title={error}>保存失败，修改仍在当前会话保留。</span>
          <button onClick={() => void retry()} className="ml-1 underline underline-offset-2">重试保存</button>
        </>
      ) : state === 'saving' ? '正在保存…' : state === 'pending' ? '等待保存…' : '已保存'}
    </span>
  )
}
