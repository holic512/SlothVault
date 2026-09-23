import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it, vi } from 'vitest'

import { NoteContentEditor } from './note-content-editor'

const scenario = vi.hoisted(() => ({ published: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/admin/markdown-content-editor', () => ({
  MarkdownContentEditor: () => null,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const version = { id: '2', projectId: '2', version: '1.0', publishedAt: scenario.published ? '2026-09-23' : null }
    const category = { id: '2', categoryName: 'Documents', projectVersionId: '2', projectVersion: version }
    const note = { id: '2', categoryId: '2', noteTitle: 'Example note', category }
    const revision = { id: '1', noteInfoId: '2', content: '# Example', versionNote: 'First revision', status: 1, updatedAt: '2026-09-23', isPrimary: true, isDeleted: false }
    const data: Record<string, unknown> = {
      'admin-note-workspace-projects': { list: [{ id: '2', projectName: 'Example project' }] },
      'admin-note': note,
      'admin-note-workspace-versions': { list: [version] },
      'admin-note-workspace-categories': { list: [category] },
      'admin-note-workspace-notes': [note],
      'admin-note-contents': { list: [revision, { ...revision, id: '2', isPrimary: false, versionNote: 'Second revision' }] },
    }
    return { data: data[queryKey[0]], isLoading: false, isError: false }
  },
}))

describe('note workspace revision controls', () => {
  it.each([false, true])('renders valid, independent selection and action buttons (published: %s)', (published) => {
    scenario.published = published
    const html = renderToStaticMarkup(createElement(NoteContentEditor, { noteId: '2' }))
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []

    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.match(/<button\b/g)).toHaveLength(1)
    }
    expect(buttons.find((button) => button.includes('First revision'))).toContain('aria-pressed="true"')
    expect(buttons.find((button) => button.includes('Second revision'))).toContain('aria-pressed="false"')
    const editButtons = buttons.filter((button) => button.includes('aria-label="revisionDialog.edit"'))
    expect(editButtons).toHaveLength(2)
    for (const button of editButtons) {
      expect(button.includes('disabled=""')).toBe(published)
    }
  })
})
