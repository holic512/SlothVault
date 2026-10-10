import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { evaluateProjectAccess } from '@/lib/content-access'

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}))
vi.mock('./project-access-notice', () => ({ ProjectAccessNotice: () => null }))
vi.mock('./project-document-content', () => ({ ProjectDocumentContent: () => createElement('div', null, 'Protected body') }))

import { ProjectNoteView } from './project-note-view'

const policy = {
  readAccess: { mode: 'LOGIN' as const, membershipLevelIds: [], membershipLevels: [] },
  downloadAccess: { mode: 'FOLLOW_READ' as const, membershipLevelIds: [], membershipLevels: [] },
}

async function render(tags: string[], canRead: boolean) {
  const note = canRead ? {
    id: '4', noteId: '3', noteTitle: 'Guide', content: '# Guide', versionNote: null,
    updatedAt: '2026-10-10T00:00:00Z', releaseId: 'release', releaseHash: 'a'.repeat(64),
    manifestVersion: 2, publishedAt: '2026-10-10T00:00:00Z', noteEvidence: [],
  } : null
  return renderToStaticMarkup(await ProjectNoteView({
    projectId: '1', versionId: '2', noteId: '3', sidebar: [], note,
    noteTitle: 'Guide', tags, access: evaluateProjectAccess(policy, canRead, []),
  }))
}

describe('project note tags', () => {
  it.each([false, true])('shows metadata tags with read access %s', async (canRead) => {
    const html = await render(['API', '教程', '<script>'], canRead)
    expect(html).toContain('class="docs-note-tags"')
    expect(html).toContain('API')
    expect(html).toContain('教程')
    expect(html).toContain('&lt;script&gt;')
    expect(html.includes('Protected body')).toBe(canRead)
  })
  it('omits the tag container for notes without tags', async () => {
    expect(await render([], false)).not.toContain('docs-note-tags')
  })
})

it('renders draft bodies with preview directory links and without release claims', async () => {
  const html = renderToStaticMarkup(await ProjectNoteView({
    projectId: '1', versionId: '2', noteId: '3',
    sidebar: [{ id: '5', categoryName: 'Guide', weight: 0, notes: [{ id: '3', noteTitle: 'Intro', weight: 0 }, { id: '6', noteTitle: 'Next', weight: 0 }] }],
    note: { id: '4', noteId: '3', noteTitle: 'Intro', content: '# Saved', versionNote: null, updatedAt: '2026-10-10T00:00:00Z', releaseId: null, releaseHash: null, manifestVersion: null, publishedAt: null, noteEvidence: [] },
    noteTitle: 'Intro', tags: ['API'], access: evaluateProjectAccess(policy, true, [], true), previewBase: '/preview/project/1/v/2',
  }))
  expect(html).toContain('Protected body')
  expect(html).toContain('href="/preview/project/1/v/2/docs/6"')
  expect(html).not.toContain('docs-release-proof')
  expect(html).not.toContain('/manifest')
  expect(html).not.toContain('Invalid Date')
})
