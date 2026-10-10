import { describe, expect, it } from 'vitest'
import { noteTagsSchema, readNoteTags } from './note-tags'

describe('note tags', () => {
  it('normalizes whitespace, removes empty values, and retains case-sensitive order', () => {
    expect(noteTagsSchema.parse([' API ', '', 'API', 'api', ' 中文 ', '  '])).toEqual(['API', 'api', '中文'])
  })
  it('enforces limits after normalization', () => {
    expect(noteTagsSchema.parse(Array(20).fill('same'))).toEqual(['same'])
    expect(noteTagsSchema.safeParse(Array.from({ length: 11 }, (_, i) => String(i))).success).toBe(false)
    expect(noteTagsSchema.safeParse(['x'.repeat(31)]).success).toBe(false)
    expect(noteTagsSchema.parse(['x'.repeat(30)])).toEqual(['x'.repeat(30)])
  })
  it.each([null, 'tag', [1], {}])('rejects non-string arrays: %j', (value) => {
    expect(noteTagsSchema.safeParse(value).success).toBe(false)
  })
  it('decodes legacy storage and refuses malformed persisted data', () => {
    expect(readNoteTags(null)).toEqual([])
    expect(readNoteTags(undefined)).toEqual([])
    expect(readNoteTags('["API", "中文"]')).toEqual(['API', '中文'])
    expect(() => readNoteTags('bad JSON')).toThrow()
  })
})
