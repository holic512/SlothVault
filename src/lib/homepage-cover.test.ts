import { describe, expect, it } from 'vitest'
import { DEFAULT_HOMEPAGE_COVER, homepageCoverUrl, parseHomepageCover, readHomepageCover } from './homepage-cover'

const cover = { enabled: true, filePath: 'uploads/markdown/cover.webp', positionX: 0, positionY: 100 }

describe('homepage cover contract', () => {
  it('preserves focal positions and previews a disabled cover', () => {
    expect(parseHomepageCover(cover)).toEqual(cover)
    expect(readHomepageCover(JSON.stringify(cover))).toEqual(cover)
    expect(homepageCoverUrl({ ...cover, enabled: false })).toBe('/uploads/markdown/cover.webp')
    expect(homepageCoverUrl(DEFAULT_HOMEPAGE_COVER)).toBeNull()
  })

  it.each([
    '/uploads/cover.png', 'https://example.com/uploads/cover.png', '//example.com/cover.png',
    'uploads/../cover.png', 'uploads/./cover.png', 'uploads/.private/cover.png',
    'uploads//cover.png', 'uploads/%2e%2e/cover.png', 'uploads/a%20b.png',
    'uploads/a\\b.png', 'uploads/cover.png?x=1', 'uploads/cover.png#x',
    'uploads/cover.svg', 'uploads/cover.gif', 'uploads/cover.ico', 'uploads/cover.png\0',
  ])('rejects noncanonical or unsupported image paths: %s', filePath => {
    expect(parseHomepageCover({ ...cover, filePath })).toBeNull()
    expect(homepageCoverUrl({ ...cover, filePath })).toBeNull()
  })

  it.each([
    null, [], {}, { ...cover, extra: true }, { ...cover, enabled: 'true' },
    { ...cover, filePath: '' }, { ...cover, positionX: -1 }, { ...cover, positionY: 101 },
    { ...cover, positionX: NaN }, { ...cover, positionY: Infinity },
    { ...cover, positionX: '50' }, { ...cover, filePath: `uploads/${'a'.repeat(500)}.png` },
  ])('rejects malformed settings: %j', input => {
    expect(parseHomepageCover(input)).toBeNull()
  })

  it.each([undefined, null, '', '{', 'null', '[]', '{}', ' '.repeat(501)])('defaults invalid persisted JSON safely: %j', value => {
    expect(readHomepageCover(value)).toEqual(DEFAULT_HOMEPAGE_COVER)
  })

  it('keeps absent legacy configuration disabled and returns independent defaults', () => {
    const settings = readHomepageCover(undefined)
    settings.positionX = 20
    expect(readHomepageCover(undefined)).toEqual(DEFAULT_HOMEPAGE_COVER)
  })
})
