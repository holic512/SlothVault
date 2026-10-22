'use client'
/**
 * @file ui-facade.tsx
 * @project SlothVault
 * @module Shared Plugin UI Facade
 * @description Exposes host UI, account cards, local plugin translations, wallet capability and application APIs to compiled plugin UI.
 * @logic Merge plugin dictionaries with inherited locale messages, preserve shared React/query contexts, and load only authorized contributions.
 * @dependencies React, Ant Design, next-intl, account cards, shared admin primitives, API client
 * @index_tags plugins,ui,theme,facade,lazy
 * @author holic512
 */
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography } from 'antd'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { NextIntlClientProvider, useMessages, useLocale, useTranslations, type AbstractIntlMessages } from 'next-intl'
import { useRouter } from 'next/navigation'
import { AdminPage as PluginPage, AdminPageActions as PluginPageActions, AdminTablePanel as PluginTablePanel, AdminToolbar as PluginToolbar } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError, formatAdminNumber } from '@/lib/admin-localization'
import { fetchSessionUser } from '@/lib/session-client'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { apiFetch } from '@/lib/api-client'
import { AccountCard as PluginAccountCard } from '@/components/account/account-card'
function mergeMessages(base: AbstractIntlMessages, local: AbstractIntlMessages): AbstractIntlMessages {
  const merged = { ...base }
  for (const [key, value] of Object.entries(local)) {
    merged[key] = typeof value === 'object' && typeof base[key] === 'object' ? mergeMessages(base[key] as AbstractIntlMessages, value) : value
  }
  return merged
}
function PluginI18nProvider({ messages, children }: { messages: Record<'zh' | 'en', AbstractIntlMessages>; children: React.ReactNode }) {
  const locale = useLocale(), inherited = useMessages()
  return <NextIntlClientProvider locale={locale} messages={mergeMessages(inherited, messages[locale === 'zh' ? 'zh' : 'en'])}>{children}</NextIntlClientProvider>
}
function usePluginAccount() {
  const { data } = useQuery({ queryKey: ['session-user'], queryFn: fetchSessionUser, staleTime: 30_000 })
  return data ? { id: data.id, username: data.username, displayName: data.displayName, role: data.role, pointsBalance: data.pointsBalance } : data
}
export function createUiFacade(queryClient: QueryClient) {
  return { React, jsx, ui: { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography, useQuery, useMutation, useQueryClient, useLocale, useTranslations, useRouter, usePluginAccount, usePluginWallet: useSolanaWallet, PluginPage, PluginPageActions, PluginTablePanel, PluginToolbar, PluginAccountCard, PluginI18nProvider, formatAdminDate, formatAdminError, formatAdminNumber,
    api: <T,>(id: string, path: string, options?: RequestInit) => apiFetch<T>(`/api/plugins/${encodeURIComponent(id)}/${path}`, options),
    invalidateAccount: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['account-points'] }), queryClient.invalidateQueries({ queryKey: ['session-user'] })]) },
  } }
}
