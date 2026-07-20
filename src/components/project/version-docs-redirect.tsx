'use client'

import { useEffect } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Alert, Result, Skeleton } from 'antd'
import { useRouter } from 'next/navigation'

import { useProjectContext } from '@/components/project/project-context'
import { apiFetch } from '@/lib/api-client'

export type SidebarCategory = {
  id: string
  categoryName: string
  weight: number
  notes: Array<{ id: string; noteTitle: string; weight: number }>
}

export function VersionDocsRedirect({ versionId }: { versionId: string }) {
  const { projectId } = useProjectContext()
  const router = useRouter()
  const query = useQuery({
    queryKey: ['project-sidebar', projectId, versionId],
    queryFn: () =>
      apiFetch<SidebarCategory[]>(`/api/project/${projectId}/v/${versionId}/sidebar`),
  })
  const firstNote = query.data?.flatMap((category) => category.notes)[0]

  useEffect(() => {
    if (firstNote) router.replace(`/project/${projectId}/v/${versionId}/docs/${firstNote.id}`)
  }, [firstNote, projectId, router, versionId])

  if (query.isError) return <Alert type="error" showIcon message={query.error.message} />
  if (query.isLoading || firstNote) return <div className="project-route-loading"><Skeleton active /></div>
  return <Result status="info" title="No published notes" />
}
