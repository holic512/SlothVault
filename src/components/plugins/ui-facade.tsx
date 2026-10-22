'use client'
/**
 * @file ui-facade.tsx
 * @project SlothVault
 * @module Shared Plugin UI Facade
 * @description Exposes the curated design-system, existing wallet capability and application bridge to compiled plugin UI.
 * @logic Preserve host React/query/i18n contexts and load the facade only when an authorized plugin contribution is rendered.
 * @dependencies React, selected Ant Design components, shared admin primitives, API client
 * @index_tags plugins,ui,theme,facade,lazy
 * @author holic512
 */
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography } from 'antd'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { AdminPage as PluginPage, AdminPageActions as PluginPageActions, AdminTablePanel as PluginTablePanel } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError, formatAdminNumber } from '@/lib/admin-localization'
import { fetchSessionUser } from '@/lib/session-client'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { apiFetch } from '@/lib/api-client'
function usePluginAccount() {
  const { data } = useQuery({ queryKey: ['session-user'], queryFn: fetchSessionUser, staleTime: 30_000 })
  return data ? { id: data.id, username: data.username, displayName: data.displayName, role: data.role, pointsBalance: data.pointsBalance } : data
}
export function createUiFacade(queryClient: QueryClient) {
  return { React, jsx, ui: { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography, useQuery, useMutation, useQueryClient, useLocale, useTranslations, useRouter, usePluginAccount, usePluginWallet: useSolanaWallet, PluginPage, PluginPageActions, PluginTablePanel, formatAdminDate, formatAdminError, formatAdminNumber,
    api: <T,>(id: string, path: string, options?: RequestInit) => apiFetch<T>(`/api/plugins/${encodeURIComponent(id)}/${path}`, options),
    invalidateAccount: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['account-points'] }), queryClient.invalidateQueries({ queryKey: ['session-user'] })]) },
  } }
}
