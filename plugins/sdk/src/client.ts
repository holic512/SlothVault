/**
 * @file client.ts
 * @project SlothVault
 * @module Plugin Client SDK
 * @description Declares the curated host UI facade shared with separately built React plugins.
 * @logic Resolve this external module from the host, never bundle a second React or design-system context.
 * @dependencies React, Ant Design, React Query, next-intl, host plugin bridge
 * @index_tags plugins,sdk,ui,theme
 * @author holic512
 */
export { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography } from 'antd'
export { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
export { useLocale, useTranslations } from 'next-intl'
export type PluginComponentProps = { pluginId: string; componentKey: string; path?: string[] }
export type PluginAccount = { id: string; username: string; displayName: string | null; role: string; pointsBalance: number }
export type PluginUiHost = {
  usePluginAccount(): PluginAccount | null | undefined
  api<T>(pluginId: string, path: string, options?: RequestInit): Promise<T>
  invalidateAccount(): Promise<void>
  useRouter(): { push(path: string): void; refresh(): void }
}
// Values are supplied by the application's external IIFE mapping, not evaluated from this file.
export const usePluginAccount: PluginUiHost['usePluginAccount'] = () => { throw new Error('Plugin client must be loaded by SlothVault') }
export const api: PluginUiHost['api'] = () => { throw new Error('Plugin client must be loaded by SlothVault') }
export const invalidateAccount: PluginUiHost['invalidateAccount'] = () => { throw new Error('Plugin client must be loaded by SlothVault') }
export const useRouter: PluginUiHost['useRouter'] = () => { throw new Error('Plugin client must be loaded by SlothVault') }
export function PluginPage(props: import('react').HTMLAttributes<HTMLDivElement>) { return props.children }
export const PluginPageActions = PluginPage
export const PluginTablePanel = PluginPage
export function formatAdminDate(locale: string, value: string | Date | null | undefined): string { return value ? new Date(value).toLocaleString(locale) : '—' }
export function formatAdminNumber(locale: string, value: number): string { return value.toLocaleString(locale) }
export function formatAdminError(error: unknown, t: unknown): string { void t; return error instanceof Error ? error.message : 'Error' }
