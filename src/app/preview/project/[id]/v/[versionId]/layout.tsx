/**
 * @file layout.tsx
 * @project SlothVault
 * @module Administrator Preview Layout
 * @description Composes the project reading shell around a single saved version with an authenticated preview notice.
 * @logic Authenticate metadata and rendering independently, avoid public caches, and pin navigation to the target version.
 * @dependencies project-preview, ProjectShell, next-intl
 * @index_tags preview,layout,admin,project
 * @author holic512
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ProjectShell } from '@/components/project/project-shell'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
import { getPreviewVersion } from '@/server/services/project-preview'

type Props = { params: Promise<{ id: string; versionId: string }> }
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, versionId } = await params
  const version = await getPreviewVersion(Number(id), Number(versionId))
  const t = await getTranslations('ProjectPreview')
  return { title: `${t('title')} · ${version.project.projectName} · ${version.version}`, robots: { index: false, follow: false } }
}

export default async function PreviewLayout({ params, children }: Props & { children: React.ReactNode }) {
  const { id, versionId } = await params
  const version = await getPreviewVersion(Number(id), Number(versionId))
  const t = await getTranslations('ProjectPreview')
  const base = `/preview/project/${id}/v/${versionId}`
  const project = { id, projectName: version.project.projectName, avatar: version.project.avatar, status: version.project.status, updatedAt: version.project.updatedAt.toISOString() }
  return <ProjectShell projectId={id} project={project} versions={[]} menus={[]} previewBase={base} footer={<SystemFilingFooter />}>
    <aside className="project-preview-notice" aria-label={t('title')}>
      <div><strong>{t('title')}</strong><span>{version.version} · {t(version.publishedAt ? 'published' : 'draft')}{version.status !== 1 || version.project.status !== 1 ? ` · ${t('hidden')}` : ''}</span><small>{t('savedOnly')}</small></div>
      <Link href={`/admin/mm/notes?projectId=${id}&versionId=${versionId}`}>{t('backToEditor')}</Link>
    </aside>
    {children}
  </ProjectShell>
}
