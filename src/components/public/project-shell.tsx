'use client'

import { Dropdown, Flex, Layout, MenuProps, Spin, Tag } from 'antd'
import Link from 'next/link'
import { PropsWithChildren, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/http'
import { WalletConnector } from '@/components/public/wallet-connector'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { useWalletStore } from '@/store/wallet'

type Props = PropsWithChildren<{
  projectId: string
  currentVersionId?: string
}>

type Version = {
  id: string
  version: string
}

type MenuItem = {
  id: string
  label: string
  url?: string | null
  isExternal?: boolean
  children?: MenuItem[]
}

export function ProjectShell({ projectId, currentVersionId, children }: Props) {
  const wallet = useWalletStore()
  const authQuery = wallet.publicKey ? `?walletAddress=${wallet.publicKey}` : ''

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () =>
      apiFetch<{ id: string; projectName: string; avatar: string | null; accessPriceSol: string | null; purchaseEnabled: boolean }>(
        `/api/project/${projectId}`
      )
  })

  const versionsQuery = useQuery({
    queryKey: ['project-versions', projectId, wallet.publicKey],
    queryFn: () => apiFetch<Version[]>(`/api/project/${projectId}/versions${authQuery}`)
  })

  const menusQuery = useQuery({
    queryKey: ['project-menus', projectId, wallet.publicKey],
    queryFn: () => apiFetch<MenuItem[]>(`/api/project/${projectId}/menu${authQuery}`)
  })

  const selectedVersion = useMemo(
    () =>
      versionsQuery.data?.find((item) => item.id === currentVersionId) ||
      versionsQuery.data?.[0] || null,
    [currentVersionId, versionsQuery.data]
  )

  const versionItems: MenuProps['items'] =
    versionsQuery.data?.map((version) => ({
      key: version.id,
      label: (
        <Link href={`/project/${projectId}/v/${version.id}/docs`}>
          {version.version}
        </Link>
      )
    })) || []

  if (projectQuery.isLoading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: '100vh' }}>
        <Spin size="large" />
      </Flex>
    )
  }

  const project = projectQuery.data

  return (
    <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}
      >
        <Flex gap={24} align="center">
          <Link href={`/project/${projectId}/home`} style={{ fontWeight: 700 }}>
            {project?.projectName || 'Project'}
          </Link>
          {project?.purchaseEnabled && project.accessPriceSol ? <Tag color="green">{project.accessPriceSol} SOL</Tag> : null}
          <Flex gap={16}>
            <Link href={`/project/${projectId}/home`}>Home</Link>
            <Link href={`/project/${projectId}/docs`}>Docs</Link>
            {(menusQuery.data || []).map((item) => (
              <Link
                key={item.id}
                href={item.url?.startsWith('/') ? `/project/${projectId}${item.url}` : item.url || '#'}
                target={item.isExternal ? '_blank' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </Flex>
          {selectedVersion ? (
            <Dropdown menu={{ items: versionItems }}>
              <a>{selectedVersion.version}</a>
            </Dropdown>
          ) : null}
        </Flex>
        <Flex gap={12}>
          <WalletConnector />
          <ThemeToggle />
        </Flex>
      </Layout.Header>
      <Layout.Content>{children}</Layout.Content>
    </Layout>
  )
}
