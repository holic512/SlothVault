import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { buildReleaseManifest, type ReleaseTreeSource } from '@/server/services/release-manifest'
import { RecordStore } from './record-store'
import { storedPayload } from './database-export'
import { verifyBackupPublications } from './publication-validation'

it('matches the existing publication protocol for duplicate category names, UTF-8 titles and JSON escapes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'sv-publication-test-')), store = new RecordStore(resolve(root,'index.sqlite'))
  const source: ReleaseTreeSource = {
    id: 1, version: 'v1', description: null, weight: 0, publishedAt: new Date(), isDeleted: false,
    project: { id: 1, projectName: 'Current name', status: 1, isDeleted: false },
    categories: ['重复', '重复', 'a', 'Å'].map((categoryName, category) => ({
      id: category + 1, categoryName, weight: 0, status: 1, isDeleted: false,
      noteInfos: ['"quoted"', '教程', 'newline\n', 'same', 'same'].map((noteTitle, note) => ({
        id: category * 100 + note + 1, noteTitle, weight: 0, status: 1, isDeleted: false,
        contents: [{ id: category * 100 + note + 1, content: `Body ${category}:${note}`, versionNote: null, isPrimary: true, status: 1, isDeleted: false }],
      })),
    })),
  }
  try {
    const built = buildReleaseManifest(source, 'Frozen project name')
    expect(built.issues).toEqual([])
    store.put('projectVersions', { id: '1', version: source.version, publishedAt: new Date().toISOString(), releaseHash: built.hash, releaseManifestJson: Buffer.from(built.bytes!).toString() })
    for (const category of source.categories) {
      store.put('categories', { ...category, id: String(category.id), projectVersionId: '1', noteInfos: undefined })
      for (const note of category.noteInfos) {
        store.put('noteInfos', { ...note, id: String(note.id), categoryId: String(category.id), contents: undefined })
        for (const content of note.contents) store.put('noteContents', { ...content, id: String(content.id), noteInfoId: String(note.id) })
      }
    }
    const data = storedPayload(store).data
    expect(() => verifyBackupPublications(data)).not.toThrow()
    store.db.prepare("UPDATE records SET json=json_set(json,'$.content','tampered') WHERE collection='noteContents' AND id='1'").run()
    expect(() => verifyBackupPublications(data)).toThrow(/release integrity/)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})
