import { describe, expect, it } from 'vitest'

import { backupStatusTagColors, contentTagColors, getContentTagColor } from '@/theme/tag-colors'

describe('content tag identity', () => {
  it('keeps normalized names stable across order changes and supports Unicode and escaped display text', () => {
    const names = ['API', '教程', '部署指南', '<script>', '文档'.repeat(15), '']
    const colors = new Map(names.map((name) => [name, getContentTagColor(name)]))
    for (const name of names.toReversed()) {
      expect(getContentTagColor(name)).toBe(colors.get(name))
      expect(getContentTagColor(` ${name} `)).toBe(colors.get(name))
      expect(contentTagColors).toContain(colors.get(name))
    }
    expect(new Set(Array.from({ length: 50 }, (_, index) => getContentTagColor(`标签${index}`))).size).toBe(5)
  })
})

describe('backup tag semantics', () => {
  it('distinguishes queued, running and failed backups', () => {
    expect(backupStatusTagColors.queued).toBe('warning')
    expect(backupStatusTagColors.running).toBe('processing')
    expect(backupStatusTagColors.failed).toBe('error')
  })
})
