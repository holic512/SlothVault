'use client'

/**
 * @file admin-wallet-tool.tsx
 * @project SlothVault
 * @module Administrator Wallet Tool
 * @description Renders the route-scoped wallet connection control shared by administrator evidence workflows.
 * @logic Surface the current signing-wallet state in the admin header, delegate selection and connection to Wallet Adapter, and keep the control explicitly separate from administrator authentication.
 * @dependencies @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, next-intl, antd
 * @index_tags admin,layout,solana,wallet,connection,header
 * @author holic512
 */
import { useWallet } from '@solana/wallet-adapter-react'
import { BaseWalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Tooltip } from 'antd'
import { useTranslations } from 'next-intl'

export function AdminWalletTool() {
  const t = useTranslations('AdminMM.walletTool')
  const { connected, connecting } = useWallet()
  const state = connected ? 'is-connected' : connecting ? 'is-connecting' : 'is-idle'

  return (
    <Tooltip title={t('hint')} placement="bottomRight">
      <span className={`admin-wallet-tool ${state}`}>
        <BaseWalletMultiButton
          labels={{
            'change-wallet': t('actions.change'),
            connecting: t('actions.connecting'),
            'copy-address': t('actions.copyAddress'),
            copied: t('actions.copied'),
            disconnect: t('actions.disconnect'),
            'has-wallet': t('actions.connect'),
            'no-wallet': t('actions.select'),
          }}
        />
      </span>
    </Tooltip>
  )
}
