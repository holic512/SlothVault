'use client'

import { useEffect } from 'react'

import { Result, Skeleton } from 'antd'
import { useRouter } from 'next/navigation'

import { useProjectContext } from '@/components/project/project-context'

export function DocsRedirect() {
  const { projectId, versions } = useProjectContext()
  const router = useRouter()

  useEffect(() => {
    if (versions[0]) router.replace(`/project/${projectId}/v/${versions[0].id}/docs`)
  }, [projectId, router, versions])

  return versions.length ? (
    <div className="project-route-loading"><Skeleton active /></div>
  ) : (
    <Result status="info" title="No published version" subTitle="Publish a project version before opening docs." />
  )
}
