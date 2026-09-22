/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Project Homepage Route
 * @description Renders a published project homepage or falls back to its published documentation when no homepage exists.
 * @logic Read the optional public homepage and redirect to the documents route only for a published project without active homepage content.
 * @dependencies next/navigation, public-project-cache, project-home-view
 * @index_tags project,public-reader,homepage,fallback,redirect
 * @author holic512
 */
import { redirect } from 'next/navigation'

import { ProjectHomeView } from '@/components/project/project-home-view'
import { getCachedProjectHome } from '@/server/services/public-project-cache'

export default async function ProjectHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const home = await getCachedProjectHome(Number(id))
  if (!home) redirect(`/project/${id}/docs`)
  return <ProjectHomeView home={home} />
}
