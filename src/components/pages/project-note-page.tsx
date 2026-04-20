'use client'

import { Alert, Layout, Menu, Spin } from 'antd'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { ProjectAuthGuard } from '@/components/public/project-auth-guard'
import { ProjectShell } from '@/components/public/project-shell'
import { MarkdownPreview } from '@/components/shared/markdown-preview'
import { apiFetch } from '@/lib/http'
import { useWalletStore } from '@/store/wallet'

type Props = {
  projectId: string
  versionId: string
  noteId: string
}

type Category = {
  id: string
  categoryName: string
  notes: Array<{ id: string; noteTitle: string }>
}

type Note = {
  id: string
  noteTitle: string
  content: string
}

export function ProjectNotePage({ projectId, versionId, noteId }: Props) {
  const wallet = useWalletStore()
  const querySuffix = wallet.publicKey ? `?walletAddress=${wallet.publicKey}` : ''

  const sidebarQuery = useQuery({
    queryKey: ['project-sidebar', projectId, versionId, wallet.publicKey],
    queryFn: () => apiFetch<Category[]>(`/api/project/${projectId}/v/${versionId}/sidebar${querySuffix}`)
  })

  const noteQuery = useQuery({
    queryKey: ['project-note', projectId, versionId, noteId, wallet.publicKey],
    queryFn: () => apiFetch<Note>(`/api/project/${projectId}/v/${versionId}/note/${noteId}${querySuffix}`)
  })

  const toc = useMemo(() => {
    return (noteQuery.data?.content || '')
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .map((line) => line.replace(/^#{1,6}\s/, ''))
  }, [noteQuery.data?.content])

  return (
    <ProjectShell projectId={projectId} currentVersionId={versionId}>
      <ProjectAuthGuard projectId={projectId}>
        <Layout style={{ minHeight: 'calc(100vh - 64px)' }}>
          <Layout.Sider width={260} theme="light">
            {sidebarQuery.isLoading ? <Spin /> : null}
            <Menu
              mode="inline"
              selectedKeys={[noteId]}
              items={(sidebarQuery.data || []).map((category) => ({
                key: category.id,
                label: category.categoryName,
                children: category.notes.map((note) => ({
                  key: note.id,
                  label: (
                    <Link href={`/project/${projectId}/v/${versionId}/docs/${note.id}`}>
                      {note.noteTitle}
                    </Link>
                  )
                }))
              }))}
            />
          </Layout.Sider>
          <Layout.Content style={{ padding: '40px 48px', background: 'transparent' }}>
            {noteQuery.isLoading ? <Spin size="large" /> : null}
            {noteQuery.error ? <Alert type="error" message={(noteQuery.error as Error).message} /> : null}
            {noteQuery.data ? <MarkdownPreview content={noteQuery.data.content} /> : null}
          </Layout.Content>
          <Layout.Sider width={240} theme="light" style={{ padding: 24 }}>
            <strong>目录</strong>
            <ul>
              {toc.map((heading) => (
                <li key={heading}>{heading}</li>
              ))}
            </ul>
          </Layout.Sider>
        </Layout>
      </ProjectAuthGuard>
    </ProjectShell>
  )
}
