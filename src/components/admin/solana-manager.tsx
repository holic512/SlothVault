'use client'

/**
 * @file solana-manager.tsx
 * @project SlothVault
 * @module Solana Administration
 * @description Orchestrates the authenticated Solana tree console and optional article copyright cNFT workflow.
 * @logic Select the configured network, confirm protected network changes, and render the tree or cNFT responsibility panel for that network.
 * @dependencies Ant Design, React Query, next-intl, api-client, Solana administration panels
 * @index_tags admin,solana,merkle-tree,cnft,network,orchestration
 * @author holic512
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Select, Space, Tabs, Typography } from 'antd'
import { useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

import { CnftsPanel } from './solana-manager/cnfts-panel'
import { TreesPanel } from './solana-manager/trees-panel'
import type { SolanaNetwork } from './solana-manager/types'

export function SolanaManager() {
  const t = useTranslations('AdminMM.solana')
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const configQuery = useQuery({
    queryKey: ['admin-solana-config'],
    queryFn: () => apiFetch<{ network: SolanaNetwork }>('/api/admin/solana/config'),
  })
  const network = configQuery.data?.network || 'devnet'

  const switchMutation = useMutation({
    mutationFn: (nextNetwork: SolanaNetwork) =>
      apiFetch<{ network: SolanaNetwork }>('/api/admin/solana/config', {
        method: 'PUT',
        body: JSON.stringify({ network: nextNetwork }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-solana'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-solana-config'] })
    },
    onError: (error) => message.error(error.message),
  })

  const switchNetwork = (nextNetwork: SolanaNetwork) => {
    if (nextNetwork === network) return
    if (nextNetwork === 'mainnet') {
      modal.confirm({
        title: t('network.switchToMainnet'),
        content: t('network.switchWarning'),
        okText: t('network.confirmSwitch'),
        cancelText: t('network.cancel'),
        okButtonProps: { danger: true },
        onOk: () => switchMutation.mutate('mainnet'),
      })
    } else {
      switchMutation.mutate('devnet')
    }
  }

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Typography.Text type="secondary">{t('network.label')}</Typography.Text>
          <Select
            value={network}
            loading={configQuery.isLoading || switchMutation.isPending}
            options={[
              { value: 'devnet', label: t('network.devnet') },
              { value: 'mainnet', label: t('network.mainnet') },
            ]}
            onChange={switchNetwork}
          />
        </Space>
      </AdminPageActions>
      {network === 'mainnet' ? <Alert showIcon type="warning" message={t('network.switchWarning')} /> : null}
      <Tabs
        className="solana-tabs"
        items={[
          {
            key: 'trees',
            label: t('tabs.trees'),
            children: <TreesPanel network={network} />,
          },
          {
            key: 'cnfts',
            label: t('tabs.cnfts'),
            children: <CnftsPanel network={network} />,
          },
        ]}
      />
    </AdminPage>
  )
}
