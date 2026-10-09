/**
 * @file admin-settings-draft.ts
 * @project SlothVault
 * @module Shared Administrator Settings Draft
 * @description Defines settings destinations and keeps configuration drafts and branding previews across their child routes.
 * @logic Compare fields with the latest server baseline, retain edited fields during reloads, and accept a save only after configuration readback succeeds.
 * @dependencies api-client, administrator configuration API
 * @index_tags admin,settings,routing,draft,branding,secrets,readback
 * @author holic512
 */
import { apiFetch } from '@/lib/api-client'

export type SettingsConfigItem = {
  key: string
  value: string
  description: string
  defaultValue: string
  sensitive?: boolean
  configured?: boolean
  previewUrl?: string
  isCustom?: boolean
  kind?: 'boolean' | 'network' | 'url' | 'image' | 'icon' | 'text'
}
export type SettingsConfigData = {
  configs: SettingsConfigItem[]
  groups: { key: string; label: string; configs: SettingsConfigItem[] }[]
}

export const SETTINGS_SECTIONS = ['branding', 'filing', 'policy', 'rpc', 'updates'] as const
export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]
export const ADMIN_SETTINGS_QUERY_KEY = ['admin-system-config'] as const
export const ADMIN_SETTINGS_ENDPOINT = '/api/admin/mm/config'

export function getSettingsSectionPath(section: SettingsSectionKey) {
  return `/admin/mm/settings/${section}`
}

export function getSettingsSectionConfigs(data: SettingsConfigData | null, section: SettingsSectionKey) {
  if (!data || section === 'updates') return []
  const group = section === 'policy' || section === 'rpc' ? 'evidence' : section
  const configs = data.groups.find((item) => item.key === group)?.configs || []
  if (section === 'policy') return configs.filter((config) => !config.key.includes('_RPC_'))
  if (section === 'rpc') return configs.filter((config) => config.key.includes('_RPC_'))
  return configs
}

export type SettingsDraftState = {
  data: SettingsConfigData | null
  values: Record<string, string>
  previewUrls: Record<string, string>
}
export type SettingsDraftAction =
  | { type: 'received' | 'saved'; data: SettingsConfigData }
  | { type: 'edit'; values: Record<string, string>; previewUrls?: Record<string, string> }
  | { type: 'reset' }

export function createSettingsDraftState(data: SettingsConfigData | null): SettingsDraftState {
  return {
    data,
    values: Object.fromEntries((data?.configs || []).map((config) => [config.key, config.value])),
    previewUrls: Object.fromEntries((data?.configs || [])
      .filter((config) => config.kind === 'image' || config.kind === 'icon')
      .map((config) => [config.key, config.previewUrl || (config.kind === 'icon' ? '/favicon.ico' : '/logo.png')])),
  }
}

export function getSettingsChangedKeys(state: SettingsDraftState) {
  return (state.data?.configs || [])
    .filter((config) => state.values[config.key] !== config.value)
    .map((config) => config.key)
}

export function getSettingsDirtySections(state: SettingsDraftState) {
  const changed = new Set(getSettingsChangedKeys(state))
  return SETTINGS_SECTIONS.filter((section) =>
    getSettingsSectionConfigs(state.data, section).some((config) => changed.has(config.key)),
  )
}

export function settingsDraftReducer(state: SettingsDraftState, action: SettingsDraftAction): SettingsDraftState {
  if (action.type === 'edit') {
    return {
      ...state,
      values: { ...state.values, ...action.values },
      previewUrls: { ...state.previewUrls, ...action.previewUrls },
    }
  }
  if (action.type === 'reset') return createSettingsDraftState(state.data)
  if (action.type === 'saved') return createSettingsDraftState(action.data)

  const next = createSettingsDraftState(action.data)
  for (const key of getSettingsChangedKeys(state)) {
    if (!(key in next.values) || next.values[key] === state.values[key]) continue
    next.values[key] = state.values[key]
    if (key in state.previewUrls) next.previewUrls[key] = state.previewUrls[key]
  }
  return next
}

export class SettingsReadbackError extends Error {
  constructor(cause: unknown) {
    super('Saved settings could not be reloaded', { cause })
    this.name = 'SettingsReadbackError'
  }
}

export async function saveSettingsDraft(configs: { key: string; value: string }[]) {
  await apiFetch<{ updated: number }>(ADMIN_SETTINGS_ENDPOINT, {
    method: 'PUT',
    body: JSON.stringify({ configs }),
  })
  try {
    return await apiFetch<SettingsConfigData>(ADMIN_SETTINGS_ENDPOINT, { cache: 'no-store' })
  } catch (error) {
    throw new SettingsReadbackError(error)
  }
}
