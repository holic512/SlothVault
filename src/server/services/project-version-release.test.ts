import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  buildReleaseManifest,
  type ReleaseTreeSource,
} from '@/server/services/project-version-release'

const releaseId = '550e8400-e29b-41d4-a716-446655440000'

function source(): ReleaseTreeSource {
  return {
    id: 1,
    version: '版本 "一"',
    description: null,
    weight: 12,
    project: { id: 99, isDeleted: false },
    categories: [
      {
        id: 8,
        categoryName: '相同',
        weight: 7,
        status: 1,
        isDeleted: false,
        noteInfos: [
          {
            id: 31,
            noteTitle: '文档',
            weight: 5,
            status: 1,
            isDeleted: false,
            contents: [{
              id: 300,
              content: '第一行\r\n第二行 "值"',
              versionNote: null,
              isPrimary: true,
              status: 1,
              isDeleted: false,
            }],
          },
        ],
      },
      {
        id: 7,
        categoryName: '相同',
        weight: 7,
        status: 1,
        isDeleted: false,
        noteInfos: [
          {
            id: 32,
            noteTitle: '文档',
            weight: 5,
            status: 1,
            isDeleted: false,
            contents: [{
              id: 301,
              content: '不同正文',
              versionNote: 'v2',
              isPrimary: true,
              status: 1,
              isDeleted: false,
            }],
          },
        ],
      },
      {
        id: 9,
        categoryName: '禁用',
        weight: 100,
        status: 0,
        isDeleted: false,
        noteInfos: [],
      },
    ],
  }
}

describe('project release manifest v1', () => {
  it('emits fixed UTF-8 JSON bytes with null, quotes, CRLF, and stable duplicate ordering', () => {
    const built = buildReleaseManifest(source(), releaseId)
    const expected = '{"schema":1,"releaseId":"550e8400-e29b-41d4-a716-446655440000","version":{"label":"版本 \\"一\\"","description":null,"weight":12},"categories":[{"name":"相同","weight":7,"status":1,"notes":[{"title":"文档","weight":5,"status":1,"content":{"versionNote":"v2","status":1,"markdown":"不同正文"}}]},{"name":"相同","weight":7,"status":1,"notes":[{"title":"文档","weight":5,"status":1,"content":{"versionNote":null,"status":1,"markdown":"第一行\\r\\n第二行 \\"值\\""}}]}]}'

    expect(Buffer.from(built.bytes!).toString('utf8')).toBe(expected)
    expect(built.hash).toBe(createHash('sha256').update(expected, 'utf8').digest('hex'))
  })

  it('is stable after every database ID is remapped', () => {
    const original = source()
    const remapped = structuredClone(original)
    remapped.id = 900
    remapped.project.id = 901
    remapped.categories.forEach((category, categoryIndex) => {
      category.id = 1_000 + categoryIndex
      category.noteInfos.forEach((note, noteIndex) => {
        note.id = 2_000 + noteIndex
        note.contents.forEach((content, contentIndex) => {
          content.id = 3_000 + contentIndex
        })
      })
    })

    expect(buildReleaseManifest(remapped, releaseId).hash).toBe(
      buildReleaseManifest(original, releaseId).hash,
    )
  })

  it('changes the hash for the same logical content under another release identity', () => {
    expect(buildReleaseManifest(source(), releaseId).hash).not.toBe(
      buildReleaseManifest(source(), '550e8400-e29b-41d4-a716-446655440001').hash,
    )
  })

  it('excludes disabled nodes and non-primary content from the digest', () => {
    const baseline = source()
    const changed = structuredClone(baseline)
    changed.categories[2].categoryName = '任意变化'
    changed.categories[0].noteInfos[0].contents.push({
      id: 999,
      content: '附件字节与非主正文不在 manifest 中',
      versionNote: 'history',
      isPrimary: false,
      status: 1,
      isDeleted: false,
    })

    expect(buildReleaseManifest(changed, releaseId).hash).toBe(
      buildReleaseManifest(baseline, releaseId).hash,
    )
  })

  it('returns stable strict validation issues instead of partial bytes', () => {
    const invalid = source()
    invalid.categories[0].noteInfos[0].contents[0].status = 0
    invalid.categories[1].noteInfos = []

    const built = buildReleaseManifest(invalid, releaseId)
    expect(built.bytes).toBeNull()
    expect(built.hash).toBeNull()
    expect(built.issues.map((item) => item.code)).toEqual([
      'CATEGORY_NO_ENABLED_NOTE',
      'NOTE_PRIMARY_DISABLED',
    ])
  })
})
