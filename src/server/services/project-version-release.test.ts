import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock('@/server/services/file-references', () => ({ indexFileWrite: (_tx: unknown, _type: unknown, write: Promise<unknown>) => write, syncFileReferences: vi.fn() }))

vi.mock('@/server/prisma', () => ({
  prisma: { projectVersion: { findUnique: mocks.findUnique } },
}))

import {
  buildReleaseManifest,
  checkDraftProjectVersion,
  type ReleaseTreeSource,
} from '@/server/services/project-version-release'

const timestamp = new Date('2026-09-14T00:00:00.000Z')

function source(): ReleaseTreeSource {
  return {
    id: 1,
    version: '版本 "一"',
    description: null,
    weight: 12,
    publishedAt: null,
    isDeleted: false,
    project: { id: 99, projectName: '项目', status: 1, isDeleted: false },
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

describe('project release manifest v3', () => {
  it('emits fixed UTF-8 JSON bytes with exact quotes, CRLF, and UTF-8 ordering', () => {
    const built = buildReleaseManifest(source())
    const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
    const notes = source().categories.slice(0, 2).map(category => ({ name: category.categoryName, notes: [{ title: '文档', hash: sha(category.noteInfos[0].contents[0].content) }] })).sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify(a.notes)), Buffer.from(JSON.stringify(b.notes))))
    const expected = JSON.stringify({ schema: 3, projectName: '项目', version: '版本 "一"', contentHash: sha(JSON.stringify({ schema: 3, categories: notes })) })

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

    expect(buildReleaseManifest(remapped).hash).toBe(
      buildReleaseManifest(original).hash,
    )
  })

  it('ignores editorial metadata, retains duplicates, and detects exact body changes', () => {
    const baseline = source()
    const changed = structuredClone(baseline)
    changed.description = 'new description'
    changed.weight = 999
    changed.categories.reverse()
    for (const category of changed.categories) {
      category.weight = 500
      for (const note of category.noteInfos) {
        note.weight = 100
        note.contents[0].versionNote = 'Edited description'
      }
    }
    expect(buildReleaseManifest(changed).hash).toBe(buildReleaseManifest(baseline).hash)
    const note = baseline.categories[0].noteInfos[0]
    baseline.categories[0].noteInfos.push(structuredClone(note))
    expect(buildReleaseManifest(baseline).hash).not.toBe(buildReleaseManifest(changed).hash)
    for (const suffix of [' ', '\n', '![image](/new-link.png)']) {
      const modified = source()
      modified.categories[0].noteInfos[0].contents[0].content += suffix
      expect(buildReleaseManifest(modified).hash).not.toBe(buildReleaseManifest(source()).hash)
    }
  })

  it('binds category and note names and keeps a project name snapshot separate from the aggregate', () => {
    const original = source()
    const baseline = buildReleaseManifest(original)
    for (const mutate of [
      (tree: ReleaseTreeSource) => { tree.categories[0].categoryName += ' renamed' },
      (tree: ReleaseTreeSource) => { tree.categories[0].noteInfos[0].noteTitle += ' renamed' },
      (tree: ReleaseTreeSource) => { const moved = structuredClone(tree.categories[0].noteInfos[0]); tree.categories[0].noteInfos.push(moved); tree.categories[1].noteInfos.push(tree.categories[0].noteInfos.pop()!) },
    ]) {
      const tree = structuredClone(original); mutate(tree)
      expect(buildReleaseManifest(tree).hash).not.toBe(baseline.hash)
    }
    const renamed = structuredClone(original); renamed.project.projectName = '新名称'
    expect(buildReleaseManifest(renamed).manifest?.contentHash).toBe(baseline.manifest?.contentHash)
    expect(buildReleaseManifest(renamed).hash).not.toBe(baseline.hash)
    expect(buildReleaseManifest(renamed, '项目').hash).toBe(baseline.hash)
    renamed.version = 'next'
    expect(buildReleaseManifest(renamed).manifest?.contentHash).toBe(baseline.manifest?.contentHash)
    const hashes = ['é', 'e\u0301', '原文\r\n', '原文\n'].map(body => {
      const tree = source(); tree.categories[0].noteInfos[0].contents[0].content = body
      return buildReleaseManifest(tree).hash
    })
    expect(new Set(hashes).size).toBe(4)
  })

  it('sorts duplicate category names and note title ties by their canonical UTF-8 bytes', () => {
    const original = source()
    original.categories[0].noteInfos.push(structuredClone(original.categories[1].noteInfos[0]))
    original.categories[1].noteInfos[0].noteTitle = '另一篇'
    const expected = buildReleaseManifest(original)
    const shuffled = structuredClone(original)
    shuffled.categories.reverse()
    shuffled.categories.forEach(category => category.noteInfos.reverse())
    expect(buildReleaseManifest(shuffled).hash).toBe(expected.hash)
    original.categories.push(structuredClone(original.categories[0]))
    expect(buildReleaseManifest(original).manifest?.contentHash).not.toBe(expected.manifest?.contentHash)
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

    expect(buildReleaseManifest(changed).hash).toBe(
      buildReleaseManifest(baseline).hash,
    )
  })

  it('returns stable strict validation issues instead of partial bytes', () => {
    const invalid = source()
    invalid.categories[0].noteInfos[0].contents[0].status = 0
    invalid.categories[1].noteInfos = []

    const built = buildReleaseManifest(invalid)
    expect(built.bytes).toBeNull()
    expect(built.hash).toBeNull()
    expect(built.issues.map((item) => item.code)).toEqual([
      'CATEGORY_NO_ENABLED_NOTE',
      'NOTE_PRIMARY_DISABLED',
    ])
  })
})

describe('draft publication preflight', () => {
  it('returns ready without issuing a release write for a valid draft', async () => {
    mocks.findUnique.mockResolvedValue(source())
    await expect(checkDraftProjectVersion(1)).resolves.toEqual({
      projectVersionId: '1',
      ready: true,
      issues: [],
    })
    expect(mocks.findUnique).toHaveBeenCalledTimes(1)
  })

  it('returns the shared release issues as a normal non-ready result', async () => {
    const invalid = source()
    invalid.project.status = 0
    invalid.categories[0].noteInfos[0].contents[0].content = '   '
    mocks.findUnique.mockResolvedValue(invalid)

    const result = await checkDraftProjectVersion(1)
    expect(result.ready).toBe(false)
    expect(result.issues.map((item) => item.code)).toEqual([
      'NOTE_PRIMARY_EMPTY',
      'PROJECT_INACTIVE',
    ])
  })

  it('rejects published versions instead of checking mutable release readiness', async () => {
    const published = source()
    published.publishedAt = timestamp
    mocks.findUnique.mockResolvedValue(published)

    await expect(checkDraftProjectVersion(1)).rejects.toMatchObject({
      status: 409,
      data: { reason: 'VERSION_FROZEN', projectVersionId: '1' },
    })
  })
})
