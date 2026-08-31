import { describe, expect, it } from 'vitest'

import {
  findMajorVersionBaseline,
  parseSemanticVersion,
  releaseVersionForCommitCount,
} from './release-version.mjs'

describe('release version resolution', () => {
  it('parses only complete non-negative semantic versions', () => {
    expect(parseSemanticVersion('2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(() => parseSemanticVersion('2.0')).toThrow('M.m.p')
    expect(() => parseSemanticVersion('02.0.0')).toThrow('M.m.p')
  })

  it('increments the patch through 20 and then rolls over the minor version', () => {
    expect(releaseVersionForCommitCount(2, 0)).toBe('2.0.0')
    expect(releaseVersionForCommitCount(2, 1)).toBe('2.0.1')
    expect(releaseVersionForCommitCount(2, 20)).toBe('2.0.20')
    expect(releaseVersionForCommitCount(2, 21)).toBe('2.1.0')
    expect(releaseVersionForCommitCount(2, 42)).toBe('2.2.0')
    expect(releaseVersionForCommitCount(2, 210_021)).toBe('2.10001.0')
  })

  it('uses the commit that introduced the current major version as the reset point', () => {
    expect(findMajorVersionBaseline([
      { commit: 'v1', version: '1.0.0' },
      { commit: 'v1-dependency-update', version: '1.0.0' },
      { commit: 'v2', version: '2.0.0' },
      { commit: 'v2-dependency-update', version: '2.0.0' },
    ], 2)).toBe('v2')
  })
})
