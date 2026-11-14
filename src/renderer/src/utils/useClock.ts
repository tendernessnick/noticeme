import { useEffect, useState } from 'react'

/** 常驻托盘、跨日及休眠恢复后刷新日期相关视图，无需修改任何记录。 */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = (): void => setNow(new Date())
    const timer = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return now
}
