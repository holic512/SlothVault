'use client'

/* eslint-disable @next/next/no-img-element -- Wallet adapters supply small inline icon URIs, which use the native wallet UI renderer. */

/**
 * @file admin-wallet-tool.tsx
 * @project SlothVault
 * @module Administrator Wallet Tool
 * @description Renders the route-scoped wallet connection control shared by administrator evidence workflows.
 * @logic Render wallet selection and connection state from the Wallet Adapter, delegate selection to the shared connection boundary without coupling it to administrator authentication.
 * @dependencies React, @solana/wallet-adapter-react, next-intl
 * @index_tags admin,layout,solana,wallet,connection,header
 * @author holic512
 */
import { App } from 'antd'
import { accountSecurityErrorReason } from '@/lib/account-security-error'
import { useWallet } from '@solana/wallet-adapter-react'
import { useTranslations } from 'next-intl'
import { useWalletConnection } from '@/components/wallet/wallet-connection-provider'
export function AdminWalletTool() {
  const t = useTranslations('WalletConnection')
  const { message } = App.useApp()
  const { connected, connecting, publicKey, wallet } = useWallet()
  const { pickerOpen, openWalletSelector, requestConnection } = useWalletConnection()
  const state = connected ? 'is-connected' : connecting ? 'is-connecting' : 'is-idle'
  const label = connecting ? t('actions.connecting') : connected && publicKey ? `${publicKey.toBase58().slice(0, 4)}..${publicKey.toBase58().slice(-4)}` : wallet ? t('actions.connect') : t('actions.select')
  return <span className={`admin-wallet-tool ${state}`}><span className="wallet-adapter-dropdown"><button aria-haspopup="dialog" aria-expanded={pickerOpen} className="wallet-adapter-button" disabled={connecting} onClick={() => { if (connected) openWalletSelector(); else void requestConnection().catch(error => { const reason = accountSecurityErrorReason(error); if (reason !== 'WALLET_CANCELLED') message.error(t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t('errors.WALLET_OPERATION_FAILED')) }) }} type="button">
    {wallet?.adapter.icon ? <i className="wallet-adapter-button-start-icon"><img alt="" src={wallet.adapter.icon} /></i> : null}{label}
  </button></span></span>
}
