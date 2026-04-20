'use client'

import { Alert, Spin } from 'antd'
import { useQuery } from '@tanstack/react-query'

import { MarkdownPreview } from '@/components/shared/markdown-preview'
import { ProjectAuthGuard } from '@/components/public/project-auth-guard'
import { ProjectShell } from '@/components/public/project-shell'
import { apiFetch } from '@/lib/http'
import { useWalletStore } from '@/store/wallet'

type Props = {
  projectId: string
}

export function ProjectHomePage({ projectId }: Props) {
  const wallet = useWalletStore()
  const query = useQuery({
    queryKey: ['project-home', projectId, wallet.publicKey],
    queryFn: () =>
      apiFetch<{ content: string }>(
        `/api/project/${projectId}/home${wallet.publicKey ? `?walletAddress=${wallet.publicKey}` : ''}`
      )
  })

  return (
    <ProjectShell projectId={projectId}>
      <ProjectAuthGuard projectId={projectId}>
        <div style={{ padding: '48px 32px' }}>
          {query.isLoading ? <Spin size="large" /> : null}
          {query.error ? <Alert type="error" message={(query.error as Error).message} /> : null}
          {query.data ? <MarkdownPreview content={query.data.content} /> : null}
        </div>
      </ProjectAuthGuard>
    </ProjectShell>
  )
}
