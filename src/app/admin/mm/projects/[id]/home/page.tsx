import type { Metadata } from 'next'

import { HomepageEditor } from '@/components/admin/homepage-editor'

export const metadata: Metadata = { title: 'Project Home Editor' }

export default async function ProjectHomepagePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <HomepageEditor key={id} projectId={id} />
}
