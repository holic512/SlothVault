/**
 * @file page.tsx
 * @project SlothVault
 * @module Preview Document Entry
 * @description Opens the first readable primary document in an administrator's version preview.
 * @logic Authenticate the target version, resolve its enabled directory, and redirect or render an empty state.
 * @dependencies project-preview, Next navigation, next-intl
 * @index_tags preview,docs,entry
 * @author holic512
 */
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getPreviewSidebar } from '@/server/services/project-preview'

export default async function PreviewDocsPage({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params
  const sidebar = await getPreviewSidebar(Number(id), Number(versionId))
  const firstNote = sidebar.flatMap(category => category.notes)[0]
  if (firstNote) redirect(`/preview/project/${id}/v/${versionId}/docs/${firstNote.id}`)
  const t = await getTranslations('ProjectPreview')
  return <main className="project-reading-main"><div className="content-container content-container--reading"><h1>{t('emptyTitle')}</h1><p>{t('emptyDescription')}</p></div></main>
}
