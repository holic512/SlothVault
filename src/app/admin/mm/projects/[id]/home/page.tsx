import { HomepageEditor } from '@/components/admin/homepage-editor'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminProjectHome')
}

export default async function ProjectHomepagePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <HomepageEditor key={id} projectId={id} />
}
