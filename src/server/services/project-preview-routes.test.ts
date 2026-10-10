import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scenario = vi.hoisted(() => ({
  version: { version: 'Draft 1', publishedAt: null, status: 0, project: { projectName: 'Hidden project', avatar: null, status: 0, updatedAt: new Date('2026-10-10') } },
  sidebar: [] as Array<{ notes: Array<{ id: string }> }>,
  home: null as { id: string; projectId: string; content: string; updatedAt: string } | null,
  getVersion: vi.fn(),
}))
vi.mock('./project-preview', () => ({
  getPreviewVersion: scenario.getVersion,
  getPreviewSidebar: async () => scenario.sidebar,
  getPreviewHome: async () => scenario.home,
  previewAccess: () => ({}),
}))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/components/project/project-shell', () => ({ ProjectShell: ({ children }: { children: React.ReactNode }) => createElement('div', null, children) }))
vi.mock('@/components/shell/system-filing-footer', () => ({ SystemFilingFooter: () => null }))
vi.mock('@/components/project/project-home-view', () => ({ ProjectHomeView: () => createElement('main', null, 'Home body') }))

import PreviewLayout, { generateMetadata } from '@/app/preview/project/[id]/v/[versionId]/layout'
import PreviewDocsPage from '@/app/preview/project/[id]/v/[versionId]/docs/page'
import PreviewHomePage from '@/app/preview/project/[id]/v/[versionId]/home/page'
const params = Promise.resolve({ id: '1', versionId: '2' })

beforeEach(() => {
  scenario.sidebar = []; scenario.home = null
  scenario.getVersion.mockReset().mockResolvedValue(scenario.version)
})
describe('version preview route behavior', () => {
  it('authenticates metadata generation and disables indexing', async () => {
    expect(await generateMetadata({ params })).toMatchObject({ robots: { index: false, follow: false } })
    expect(scenario.getVersion).toHaveBeenCalledWith(1, 2)
    scenario.getVersion.mockRejectedValue(new Error('unauthorized'))
    await expect(generateMetadata({ params })).rejects.toThrow('unauthorized')
  })
  it('shows the fixed version notice and returns to its editor context', async () => {
    const html = renderToStaticMarkup(await PreviewLayout({ params, children: null }))
    expect(html).toContain('project-preview-notice')
    expect(html).toContain('Draft 1 · draft · hidden')
    expect(html).toContain('/admin/mm/notes?projectId=1&amp;versionId=2')
  })
  it('opens the first readable note in the same preview version', async () => {
    scenario.sidebar = [{ notes: [{ id: '3' }, { id: '4' }] }]
    await expect(PreviewDocsPage({ params })).rejects.toThrow('redirect:/preview/project/1/v/2/docs/3')
  })
  it('explains how to make an empty version readable', async () => {
    const html = renderToStaticMarkup(await PreviewDocsPage({ params }))
    expect(html).toContain('emptyTitle')
    expect(html).toContain('emptyDescription')
  })
  it('falls back to the same version documents when the homepage is unavailable', async () => {
    await expect(PreviewHomePage({ params })).rejects.toThrow('redirect:/preview/project/1/v/2/docs')
    scenario.home = { id: '4', projectId: '1', content: '# Home', updatedAt: '' }
    expect(renderToStaticMarkup(await PreviewHomePage({ params }))).toContain('Home body')
  })
})
