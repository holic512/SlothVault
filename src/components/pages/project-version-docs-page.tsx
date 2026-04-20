'use client'

import { Spin } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/http'
import { useWalletStore } from '@/store/wallet'

type Props = {
  projectId: string
  versionId: string
}

export function ProjectVersionDocsPage({ projectId, versionId }: Props) {
  const router = useRouter()
  const wallet = useWalletStore()
  const query = useQuery({
    queryKey: ['project-sidebar-entry', projectId, versionId, wallet.publicKey],
    queryFn: () =>
      apiFetch<Array<{ notes: Array<{ id: string }> }>>(
        `/api/project/${projectId}/v/${versionId}/sidebar${wallet.publicKey ? `?walletAddress=${wallet.publicKey}` : ''}`
      )
  })

  useEffect(() => {
    const noteId = query.data?.flatMap((item) => item.notes)[0]?.id
    if (noteId) {
      router.replace(`/project/${projectId}/v/${versionId}/docs/${noteId}`)
    }
  }, [projectId, query.data, router, versionId])

  return <Spin size="large" />
}
