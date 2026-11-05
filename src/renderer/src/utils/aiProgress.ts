// AI 推理进度 hook：累计字符数 + 流逝秒数，让「生成中」不再像卡死
import { useEffect, useState } from 'react'

export interface AiProgressState {
  /** 本次推理已流逝秒数（active 时每秒 +1） */
  elapsed: number
  /** 本次推理已生成字符数 */
  chars: number
}

export function useAiProgress(active: boolean): AiProgressState {
  const [state, setState] = useState<AiProgressState>({ elapsed: 0, chars: 0 })

  useEffect(() => {
    if (!active) {
      setState({ elapsed: 0, chars: 0 })
      return
    }
    const t0 = Date.now()
    setState({ elapsed: 0, chars: 0 })
    const tick = setInterval(() => {
      setState(s => ({ ...s, elapsed: Math.round((Date.now() - t0) / 1000) }))
    }, 1000)
    const off = window.noticeme.onAiProgress(p => {
      setState(s => ({ ...s, chars: s.chars + p.chars }))
    })
    return () => {
      clearInterval(tick)
      off()
    }
  }, [active])

  return state
}
