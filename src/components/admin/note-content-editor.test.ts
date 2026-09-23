import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { App } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getProjectVersionActions, loadProjectVersions, NoteContentEditor } from './note-content-editor'

const scenario = vi.hoisted(() => ({
  published: false,
  hidden: false,
  selectedId: '',
  menu: [] as Array<{ key: string; onClick?: () => void }>,
  confirmation: null as { onOk: () => Promise<void> } | null,
  push: vi.fn(),
  invalidate: vi.fn(async () => {}),
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    Dropdown: ({ children, menu }: { children: ReactNode; menu: { items: typeof scenario.menu } }) => {
      scenario.menu = menu.items
      return children
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: scenario.push }),
  useSearchParams: () => new URLSearchParams(scenario.selectedId ? `projectId=2&versionId=${scenario.selectedId}` : ''),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/admin/markdown-content-editor', () => ({
  MarkdownContentEditor: () => null,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: scenario.invalidate }),
  useQuery: ({ queryKey }: { queryKey: Array<string | undefined> }) => {
    const version = { id: '2', projectId: '2', version: '1.0', description: null, weight: 0, status: scenario.hidden ? 0 : 1, releaseId: scenario.published ? 'release-id' : null, releaseHash: scenario.published ? 'a'.repeat(64) : null, publishedAt: scenario.published ? '2026-09-23' : null, isDeleted: false }
    const category = { id: '2', categoryName: 'Documents', projectVersionId: '2', projectVersion: version }
    const note = { id: '2', categoryId: '2', noteTitle: 'Example note', category }
    const revision = { id: '1', noteInfoId: '2', content: '# Example', versionNote: 'First revision', status: 1, updatedAt: '2026-09-23', isPrimary: true, isDeleted: false }
    const data: Record<string, unknown> = {
      'admin-note-workspace-projects': { list: [{ id: '2', projectName: 'Example project' }] },
      'admin-note': note,
      'admin-note-workspace-versions': { list: [version, { ...version, id: '3', version: '2.0', publishedAt: null, status: 0 }] },
      'admin-note-workspace-categories': { list: [category] },
      'admin-note-workspace-notes': [note],
      'admin-note-contents': { list: [revision, { ...revision, id: '2', isPrimary: false, versionNote: 'Second revision' }] },
    }
    return { data: queryKey[0] === 'admin-note' && !queryKey[1] ? undefined : data[queryKey[0] || ''], isLoading: false, isError: false }
  },
}))

describe('note workspace revision controls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    scenario.push.mockClear()
    scenario.invalidate.mockClear()
    scenario.confirmation = null
    scenario.selectedId = ''
  })

  it.each([false, true])('renders valid, independent selection and action buttons (published: %s)', (published) => {
    scenario.published = published
    scenario.hidden = false
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
    expect(html).toContain(published ? 'status.published' : 'status.draft')
    expect(html).not.toContain('quickVersion')
  })

  it('shows the hidden badge alongside the published badge', () => {
    scenario.published = true
    scenario.hidden = true
    const html = renderToStaticMarkup(createElement(NoteContentEditor, { noteId: '2' }))
    expect(html).toContain('status.published')
    expect(html).toContain('status.hidden')
  })

  it('offers only actions valid for the selected version lifecycle', () => {
    expect(getProjectVersionActions('')).toEqual([])
    expect(getProjectVersionActions('2')).toEqual(['create'])
    expect(getProjectVersionActions('2', { publishedAt: null, status: 0 })).toEqual(['create', 'edit', 'publish', 'delete'])
    expect(getProjectVersionActions('2', { publishedAt: '2026-09-23', status: 1 })).toEqual(['create', 'clone', 'hide', 'copyHash', 'manifest', 'integrity'])
    expect(getProjectVersionActions('2', { publishedAt: '2026-09-23', status: 0 })).toEqual(['create', 'clone', 'show', 'copyHash', 'manifest', 'integrity'])
  })

  it('loads every page of active versions in a stable order', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input, 'http://localhost').searchParams.get('page'))
      const list = Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({ id: String((page - 1) * 100 + index + 1) }))
      return Response.json({ code: 0, message: 'ok', data: { list, total: 101 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadProjectVersions('2')

    expect(result.list).toHaveLength(101)
    expect(result.list[100].id).toBe('101')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('orderBy=id&order=asc')
    expect(fetchMock.mock.calls[1][0]).toContain('page=2')
  })

  it('deletes only the selected draft and clears its route context', async () => {
    scenario.published = false
    scenario.hidden = false
    vi.spyOn(App, 'useApp').mockReturnValue({
      message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
      modal: { confirm: vi.fn((config: { onOk: () => Promise<void> }) => { scenario.confirmation = config }) },
    } as unknown as ReturnType<typeof App.useApp>)
    const fetchMock = vi.fn(async () => Response.json({ code: 0, message: 'ok', data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    renderToStaticMarkup(createElement(NoteContentEditor, { noteId: '2' }))
    scenario.menu.find((item) => item.key === 'delete')?.onClick?.()
    expect(scenario.confirmation).not.toBeNull()
    await scenario.confirmation?.onOk()

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/mm/projectVersion/2', expect.objectContaining({ method: 'DELETE' }))
    expect(scenario.push).toHaveBeenCalledWith('/admin/mm/notes?projectId=2')
    expect(scenario.invalidate).toHaveBeenCalled()
  })

  it('publishes the selected draft through the confirmation and keeps it selected', async () => {
    scenario.published = false
    vi.spyOn(App, 'useApp').mockReturnValue({
      message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
      modal: { confirm: vi.fn((config: { onOk: () => Promise<void> }) => { scenario.confirmation = config }) },
    } as unknown as ReturnType<typeof App.useApp>)
    const fetchMock = vi.fn(async () => Response.json({ code: 0, message: 'ok', data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    renderToStaticMarkup(createElement(NoteContentEditor, { noteId: '2' }))
    scenario.menu.find((item) => item.key === 'publish')?.onClick?.()
    await scenario.confirmation?.onOk()

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/mm/projectVersion/2/publish', expect.objectContaining({ method: 'POST' }))
    expect(scenario.push).not.toHaveBeenCalled()
    expect(scenario.invalidate).toHaveBeenCalled()
  })

  it('targets the selected version rather than the first version in the list', async () => {
    scenario.selectedId = '3'
    scenario.published = false
    vi.spyOn(App, 'useApp').mockReturnValue({
      message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
      modal: { confirm: vi.fn((config: { onOk: () => Promise<void> }) => { scenario.confirmation = config }) },
    } as unknown as ReturnType<typeof App.useApp>)
    const fetchMock = vi.fn(async () => Response.json({ code: 0, message: 'ok', data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    renderToStaticMarkup(createElement(NoteContentEditor))
    scenario.menu.find((item) => item.key === 'delete')?.onClick?.()
    await scenario.confirmation?.onOk()

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/mm/projectVersion/3', expect.objectContaining({ method: 'DELETE' }))
    expect(scenario.push).toHaveBeenCalledWith('/admin/mm/notes?projectId=2')
  })

  it('only switches the visibility of a selected published version', async () => {
    scenario.published = true
    scenario.hidden = false
    vi.spyOn(App, 'useApp').mockReturnValue({
      message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
      modal: { confirm: vi.fn() },
    } as unknown as ReturnType<typeof App.useApp>)
    const fetchMock = vi.fn(async () => Response.json({ code: 0, message: 'ok', data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    renderToStaticMarkup(createElement(NoteContentEditor, { noteId: '2' }))
    scenario.menu.find((item) => item.key === 'hide')?.onClick?.()

    await vi.waitFor(() => expect(scenario.invalidate).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/mm/projectVersion/2', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ status: 0 }),
    }))
  })
})
