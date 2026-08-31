/**
 * @file admin-localization.ts
 * @project SlothVault
 * @module Admin Localization Utilities
 * @description Centralizes locale-aware value formatting and safe display text for administrative API failures.
 * @logic Format values through the active application locale, map known server failures to stable translation keys, and fall back to a localized generic message without exposing raw error text.
 * @dependencies next-intl, api-client
 * @index_tags admin,i18n,formatting,error-handling,privacy
 * @author holic512
 */
import type { useTranslations } from 'next-intl'

import { ApiClientError } from '@/lib/api-client'

type AdminErrorTranslator = ReturnType<typeof useTranslations<'AdminMM.errors'>>

const KNOWN_ERROR_KEYS: Record<string, Parameters<AdminErrorTranslator>[0]> = {
  Unauthorized: 'unauthorized',
  'Invalid request data': 'invalidRequest',
  'Invalid JSON body': 'invalidRequest',
  'Request body is too large': 'requestTooLarge',
  'Invalid dashboard range': 'invalidRequest',
  'System configuration requires maintenance': 'maintenance',
  'Installed database is unavailable': 'maintenance',
  'System is not installed': 'maintenance',
  'Solana RPC is unavailable; the evidence record can be reconciled later': 'rpcUnavailable',
  'Wallet balance is insufficient for the evidence fee': 'walletInsufficient',
  'Invalid signer wallet address': 'invalidWallet',
  'User not found': 'notFound',
  'Project not found': 'notFound',
  'Article not found': 'notFound',
  'Contract not found': 'notFound',
  'Not Found': 'notFound',
}

function languageTag(locale: string) {
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}

export function formatAdminNumber(locale: string, value: number | bigint) {
  return new Intl.NumberFormat(languageTag(locale)).format(value)
}

export function formatAdminDate(locale: string, value: string | Date, includeTime = true) {
  return new Intl.DateTimeFormat(languageTag(locale), includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' },
  ).format(new Date(value))
}

export function formatAdminBytes(locale: string, value: number | string | bigint) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 B`
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const amount = bytes / 1024 ** index
  return `${new Intl.NumberFormat(languageTag(locale), { maximumFractionDigits: index === 0 ? 0 : 1 }).format(amount)} ${units[index]}`
}

export function formatAdminError(error: unknown, t: AdminErrorTranslator) {
  if (error instanceof ApiClientError) {
    const key = KNOWN_ERROR_KEYS[error.message]
    if (key) return t(key)
    if (error.status === 401 || error.status === 403) return t('unauthorized')
    if (error.status === 404) return t('notFound')
    if (error.status === 409) return t('conflict')
    if (error.status === 413) return t('requestTooLarge')
    if (error.status >= 500) return t('serviceUnavailable')
  }

  return t('generic')
}
