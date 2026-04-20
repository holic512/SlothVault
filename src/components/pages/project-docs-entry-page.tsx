'use client'

import { Spin } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/http'
import { useWalletStore } from '@/store/wallet'

type Props = {
  projectId: string
}

export function ProjectDocsEntryPage({ projectId }: Props) {
  const router = useRouter()
  const wallet = useWalletStore()
  const query = useQuery({
    queryKey: ['project-versions-entry', projectId, wallet.publicKey],
    queryFn: () =>
      apiFetch<Array<{ id: string }>>(
        `/api/project/${projectId}/versions${wallet.publicKey ? `?walletAddress=${wallet.publicKey}` : ''}`
      )
  })

  useEffect(() => {
    if (query.data?.[0]) {
      router.replace(`/project/${projectId}/v/${query.data[0].id}/docs`)
    }
  }, [projectId, query.data, router])

  return <Spin size="large" />
}
