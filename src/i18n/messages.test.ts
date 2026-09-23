import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTranslator } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

function leafKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [path]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, path ? `${path}.${key}` : key))
}

describe('message catalogs', () => {
  it.each([
    ['en', 'Standard'],
    ['zh', '标准'],
  ])('resolves the standard theme label in %s without missing messages', (locale, label) => {
    const messages = JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'))
    const onError = vi.fn()
    const t = createTranslator({ locale, messages, namespace: 'ThemeToggle', onError })

    expect(t('style.standard')).toBe(label)
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps the English and Chinese catalogs structurally aligned', () => {
    const root = process.cwd()
    const zh = JSON.parse(readFileSync(join(root, 'messages', 'zh.json'), 'utf8'))
    const en = JSON.parse(readFileSync(join(root, 'messages', 'en.json'), 'utf8'))

    expect(leafKeys(zh).sort()).toEqual(leafKeys(en).sort())
  })
})
