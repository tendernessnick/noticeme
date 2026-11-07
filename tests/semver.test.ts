import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/shared/semver'

describe('compareVersions', () => {
  it('基础三段比较', () => {
    expect(compareVersions('0.3.2', '0.3.1')).toBe(1)
    expect(compareVersions('0.3.1', '0.3.2')).toBe(-1)
    expect(compareVersions('0.3.2', '0.3.2')).toBe(0)
  })

  it('逐段比较而非字符串比较（10 > 9）', () => {
    expect(compareVersions('0.3.10', '0.3.9')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
  })

  it('容忍 v 前缀', () => {
    expect(compareVersions('v0.4.0', '0.3.9')).toBe(1)
    expect(compareVersions('0.4.0', 'v0.4.0')).toBe(0)
  })

  it('忽略预发布/构建后缀中的非数字部分（简化语义：同基础版本视为相等）', () => {
    expect(compareVersions('0.4.0-beta.1', '0.4.0')).toBe(0)
    expect(compareVersions('0.4.0+build.5', '0.4.0')).toBe(0)
  })

  it('位数不齐补零比较', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.4', '0.3.9')).toBe(1)
  })
})
