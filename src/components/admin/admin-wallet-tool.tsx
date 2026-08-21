'use client'

/**
 * @file admin-wallet-tool.tsx
 * @project SlothVault
 * @module Administrator Wallet Tool
 * @description Renders the route-scoped wallet connection control shared by administrator evidence workflows.
 * @logic Render wallet selection and connection state from the Wallet Adapter, mount the picker through a browser portal, and handle keyboard dismissal without coupling it to administrator authentication.
 * @dependencies React, @solana/wallet-adapter-react, next-intl
 * @index_tags admin,layout,solana,wallet,connection,header
 * @author holic512
 */
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { WalletReadyState } from '@solana/wallet-adapter-base'
import { useTranslations } from 'next-intl'

export function AdminWalletTool() {
  const t = useTranslations('AdminMM.walletTool')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { connected, connecting, publicKey, wallet, wallets, connect, disconnect, select } = useWallet()
  const state = connected ? 'is-connected' : connecting ? 'is-connecting' : 'is-idle'
  const availableWallets = wallets.filter(({ readyState }) => readyState === WalletReadyState.Installed)
  const pickerWallets = availableWallets.length ? availableWallets : wallets

  useEffect(() => {
    if (!pickerOpen) return

    const closePicker = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }

    window.addEventListener('keydown', closePicker)
    return () => window.removeEventListener('keydown', closePicker)
  }, [pickerOpen])

  const copyAddress = async () => {
    if (!publicKey) return
    try {
      await navigator.clipboard.writeText(publicKey.toBase58())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1000)
    } catch {
      setCopied(false)
    }
  }

  const selectWallet = (name: typeof wallets[number]['adapter']['name']) => {
    select(name)
    setPickerOpen(false)
  }

  const primaryLabel = connecting
    ? t('actions.connecting')
    : connected && publicKey
      ? `${publicKey.toBase58().slice(0, 4)}..${publicKey.toBase58().slice(-4)}`
      : wallet
        ? t('actions.connect')
        : t('actions.select')

  const handlePrimaryAction = () => {
    if (connecting) return
    if (connected) {
      setPickerOpen(true)
      return
    }
    if (wallet) {
      void connect().catch(() => undefined)
      return
    }
    setPickerOpen(true)
  }

  return (
    <>
      <span className={`admin-wallet-tool ${state}`}>
        <span className="wallet-adapter-dropdown">
          <button
            aria-expanded={pickerOpen}
            className="wallet-adapter-button"
            disabled={connecting}
            onClick={handlePrimaryAction}
            type="button"
          >
            {wallet?.adapter.icon ? <i className="wallet-adapter-button-start-icon"><img alt="" src={wallet.adapter.icon} /></i> : null}
            {primaryLabel}
          </button>
        </span>
      </span>

      {pickerOpen
        ? createPortal(
            <div
              aria-labelledby="admin-wallet-picker-title"
              aria-modal="true"
              className="admin-wallet-picker"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setPickerOpen(false)
              }}
              role="dialog"
            >
              <div className="admin-wallet-picker-surface">
                <button aria-label={t('dialog.close')} className="admin-wallet-picker-close" onClick={() => setPickerOpen(false)} type="button">
                  <span aria-hidden="true">×</span>
                </button>
                <div className="admin-wallet-picker-heading">
                  <span>Solana</span>
                  <h2 id="admin-wallet-picker-title">{t('dialog.title')}</h2>
                  <p>{t('dialog.description')}</p>
                </div>
                {pickerWallets.length ? (
                  <ul className="admin-wallet-picker-list">
                    {pickerWallets.map(({ adapter, readyState }) => (
                      <li key={adapter.name}>
                        <button onClick={() => selectWallet(adapter.name)} type="button">
                          <img alt="" src={adapter.icon} />
                          <span>{adapter.name}</span>
                          {readyState === WalletReadyState.Installed ? <small>{t('dialog.detected')}</small> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-wallet-picker-empty">{t('dialog.empty')}</p>
                )}
                {connected ? (
                  <div className="admin-wallet-picker-actions">
                    <button onClick={() => void copyAddress()} type="button">{copied ? t('actions.copied') : t('actions.copyAddress')}</button>
                    <button onClick={() => { disconnect(); setPickerOpen(false) }} type="button">{t('actions.disconnect')}</button>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
