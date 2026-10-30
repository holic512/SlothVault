import { resolveProjectPageParams } from '@/server/services/public-content-ids'
import { redirect } from 'next/navigation'

export default async function ProjectEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await resolveProjectPageParams({ id })
  redirect(`/project/${id}/home`)
}
