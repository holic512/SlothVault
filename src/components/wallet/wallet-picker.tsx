'use client'

/* eslint-disable @next/next/no-img-element -- Wallet adapters supply small inline icon URIs, which use the native wallet UI renderer. */
/**
 * @file wallet-picker.tsx
 * @project SlothVault
 * @module Shared Solana Wallet Picker
 * @description Presents the same installed-first wallet selection and connection controls on admin and personal routes.
 * @logic Render one browser portal, trap and restore focus, and expose selection/copy/disconnect without performing authentication.
 * @dependencies React, wallet-adapter-react, next-intl, shared vendor styles
 * @index_tags wallet,picker,portal,accessibility,connection
 * @author holic512
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base'
import { useTranslations } from 'next-intl'
import typographyStyles from '@/styles/modules/admin-typography.module.css'
export function WalletPicker({ onSelect, onClose, error, expectedAddress }: { onSelect: (name: WalletName) => void; onClose: () => void; error: string | null; expectedAddress?: string }) {
  const t = useTranslations('WalletConnection'), id = useId(), surface = useRef<HTMLDivElement>(null)
  const { wallets, connected, publicKey, disconnect } = useWallet()
  const [copied, setCopied] = useState(false)
  const installed = wallets.filter(wallet => wallet.readyState === WalletReadyState.Installed), choices = installed.length ? installed : wallets
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    surface.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const elements = surface.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')
      if (!elements?.length) return
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [onClose])
  const copyAddress = async () => {
    if (!publicKey) return
    try { await navigator.clipboard.writeText(publicKey.toBase58()); setCopied(true) } catch { setCopied(false) }
  }
  return createPortal(<div className={`${typographyStyles.scope} solana-wallet-picker`} role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="solana-wallet-picker-surface" ref={surface}>
      <button className="solana-wallet-picker-close" aria-label={t('dialog.close')} onClick={onClose} type="button">×</button>
      <div className="solana-wallet-picker-heading"><span>Solana</span><h2 id={id}>{t('dialog.title')}</h2><p>{t('dialog.description')}</p>
        {publicKey ? <p><code>{publicKey.toBase58()}</code></p> : null}
        {expectedAddress ? <p>{t('expectedAddress', { address: expectedAddress })}</p> : null}
        {error ? <p role="alert">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.WALLET_CONNECTION_FAILED')}</p> : null}
      </div>
      {choices.length ? <ul className="solana-wallet-picker-list">{choices.map(({ adapter, readyState }) => <li key={adapter.name}><button type="button" onClick={() => onSelect(adapter.name)}><img alt="" src={adapter.icon} /><span>{adapter.name}</span>{readyState === WalletReadyState.Installed ? <small>{t('dialog.detected')}</small> : null}</button></li>)}</ul> : <p className="solana-wallet-picker-empty">{t('dialog.empty')}</p>}
      {connected && publicKey ? <div className="solana-wallet-picker-actions">
        <button type="button" onClick={() => void copyAddress()}>{copied ? t('actions.copied') : t('actions.copyAddress')}</button>
        <button type="button" onClick={() => { void disconnect().then(onClose, onClose) }}>{t('actions.disconnect')}</button>
      </div> : null}
    </div>
  </div>, document.body)
}
