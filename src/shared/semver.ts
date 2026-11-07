// 版本号比较（纯函数）：支持 x.y.z 主流 semver 形态，忽略 v 前缀与预发布后缀差异从简处理
// 用于 macOS 未签名场景的「仅检查新版」路径（Windows 走 electron-updater 自带比较）

/** 提取数字序列："v0.3.10-beta.2" → [0, 3, 10, 0, 2]（补齐 5 位避免越界比较） */
function parseVersion(v: string): number[] {
  const nums = v
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map(s => Number.parseInt(s, 10) || 0)
  while (nums.length < 5) nums.push(0)
  return nums.slice(0, 5)
}

/** a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 5; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}
