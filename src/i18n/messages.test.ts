import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function leafKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [path]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, path ? `${path}.${key}` : key))
}

describe('message catalogs', () => {
  it('keeps the English and Chinese catalogs structurally aligned', () => {
    const root = process.cwd()
    const zh = JSON.parse(readFileSync(join(root, 'messages', 'zh.json'), 'utf8'))
    const en = JSON.parse(readFileSync(join(root, 'messages', 'en.json'), 'utf8'))

    expect(leafKeys(zh).sort()).toEqual(leafKeys(en).sort())
  })
})
