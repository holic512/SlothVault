import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SETTINGS_SECTIONS,
  SettingsReadbackError,
  createSettingsDraftState,
  getSettingsChangedKeys,
  getSettingsDirtySections,
  getSettingsSectionConfigs,
  getSettingsSectionPath,
  saveSettingsDraft,
  settingsDraftReducer,
  type SettingsConfigData,
  type SettingsConfigItem,
} from './admin-settings-draft'
import { apiFetch } from './api-client'

vi.mock('./api-client', () => ({ apiFetch: vi.fn() }))

function configuration(overrides: Record<string, Partial<SettingsConfigItem>> = {}): SettingsConfigData {
  const definitions = [
    { key: 'SYSTEM_LOGO_FILE_PATH', group: 'branding', value: '', kind: 'image' },
    { key: 'SYSTEM_FAVICON_FILE_PATH', group: 'branding', value: '', kind: 'icon' },
    { key: 'SYSTEM_ICP_RECORD_NUMBER', group: 'filing', value: '', kind: 'text' },
    { key: 'SYSTEM_ICP_RECORD_URL', group: 'filing', value: '', kind: 'url' },
    { key: 'SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER', group: 'filing', value: '', kind: 'text' },
    { key: 'SYSTEM_PUBLIC_SECURITY_RECORD_URL', group: 'filing', value: '', kind: 'url' },
    { key: 'SOLANA_DEFAULT_NETWORK', group: 'evidence', value: 'devnet', kind: 'network' },
    { key: 'SOLANA_MAINNET_ENABLED', group: 'evidence', value: 'false', kind: 'boolean' },
    { key: 'SOLANA_DEVNET_ENABLED', group: 'evidence', value: 'true', kind: 'boolean' },
    { key: 'SOLANA_MAINNET_RPC_PRIMARY', group: 'evidence', value: '', kind: 'url', sensitive: true, configured: true },
    { key: 'SOLANA_MAINNET_RPC_FALLBACK', group: 'evidence', value: '', kind: 'url', sensitive: true },
    { key: 'SOLANA_DEVNET_RPC_PRIMARY', group: 'evidence', value: '', kind: 'url', sensitive: true },
    { key: 'SOLANA_DEVNET_RPC_FALLBACK', group: 'evidence', value: '', kind: 'url', sensitive: true },
  ] as const
  const configs: SettingsConfigItem[] = definitions.map((item) => ({
    key: item.key, value: item.value, kind: item.kind, description: '', defaultValue: '',
    sensitive: 'sensitive' in item ? item.sensitive : false,
    configured: 'configured' in item ? item.configured : false,
    ...overrides[item.key],
  }))
  return {
    configs,
    groups: ['branding', 'filing', 'evidence'].map((key) => ({
      key,
      label: key,
      configs: configs.filter((config) => definitions.find((item) => item.key === config.key)?.group === key),
    })),
  }
}

describe('shared settings draft', () => {
  it('registers all five destinations and partitions policy and RPC fields', () => {
    const data = configuration()
    expect(SETTINGS_SECTIONS.map(getSettingsSectionPath)).toEqual([
      '/admin/mm/settings/branding', '/admin/mm/settings/filing', '/admin/mm/settings/policy',
      '/admin/mm/settings/rpc', '/admin/mm/settings/updates',
    ])
    expect(SETTINGS_SECTIONS.map((section) => getSettingsSectionConfigs(data, section).length)).toEqual([2, 4, 3, 4, 0])
    expect(getSettingsSectionConfigs(data, 'rpc').every((item) => item.sensitive)).toBe(true)
    expect(getSettingsSectionConfigs(data, 'policy').map((item) => item.key)).toEqual([
      'SOLANA_DEFAULT_NETWORK', 'SOLANA_MAINNET_ENABLED', 'SOLANA_DEVNET_ENABLED',
    ])
    expect(getSettingsSectionConfigs(null, 'branding')).toEqual([])
  })

  it('does not mark configured but masked RPC addresses as edits', () => {
    const state = createSettingsDraftState(configuration())
    expect(state.values.SOLANA_MAINNET_RPC_PRIMARY).toBe('')
    expect(getSettingsChangedKeys(state)).toEqual([])
    expect(getSettingsDirtySections(state)).toEqual([])
    expect(getSettingsDirtySections(createSettingsDraftState(null))).toEqual([])
  })

  it('marks only edited pages and clears their dots when values are restored', () => {
    const original = createSettingsDraftState(configuration())
    const edited = settingsDraftReducer(original, {
      type: 'edit',
      values: { SYSTEM_ICP_RECORD_NUMBER: 'Example filing', SOLANA_MAINNET_RPC_PRIMARY: 'https://rpc.example.test' },
    })
    expect(getSettingsDirtySections(edited)).toEqual(['filing', 'rpc'])
    expect(original.values.SYSTEM_ICP_RECORD_NUMBER).toBe('')
    const reverted = settingsDraftReducer(edited, { type: 'edit', values: { SYSTEM_ICP_RECORD_NUMBER: '' } })
    expect(getSettingsDirtySections(reverted)).toEqual(['rpc'])
    const unchanged = settingsDraftReducer(reverted, { type: 'edit', values: { SOLANA_MAINNET_RPC_PRIMARY: '' } })
    expect(getSettingsDirtySections(unchanged)).toEqual([])
  })

  it('keeps synchronized logo and icon uploads in one branding draft', () => {
    const state = settingsDraftReducer(createSettingsDraftState(configuration()), {
      type: 'edit',
      values: { SYSTEM_LOGO_FILE_PATH: 'draft/logo.png', SYSTEM_FAVICON_FILE_PATH: 'draft/favicon.ico' },
      previewUrls: { SYSTEM_LOGO_FILE_PATH: '/uploads/draft/logo.png', SYSTEM_FAVICON_FILE_PATH: '/uploads/draft/favicon.ico' },
    })
    expect(getSettingsDirtySections(state)).toEqual(['branding'])
    expect(getSettingsChangedKeys(state)).toEqual(['SYSTEM_LOGO_FILE_PATH', 'SYSTEM_FAVICON_FILE_PATH'])
    expect(state.previewUrls.SYSTEM_FAVICON_FILE_PATH).toBe('/uploads/draft/favicon.ico')
  })

  it('retains edited fields and upload previews while refreshing untouched fields', () => {
    const edited = settingsDraftReducer(createSettingsDraftState(configuration()), {
      type: 'edit',
      values: {
        SYSTEM_LOGO_FILE_PATH: 'draft/logo.png', SYSTEM_ICP_RECORD_NUMBER: 'Draft filing',
        SOLANA_MAINNET_RPC_PRIMARY: 'https://rpc.example.test',
      },
      previewUrls: { SYSTEM_LOGO_FILE_PATH: '/uploads/draft/logo.png' },
    })
    const reloaded = configuration({
      SYSTEM_LOGO_FILE_PATH: { value: 'server/logo.png', previewUrl: '/uploads/server/logo.png' },
      SYSTEM_FAVICON_FILE_PATH: { value: 'server/favicon.ico', previewUrl: '/uploads/server/favicon.ico' },
      SYSTEM_ICP_RECORD_NUMBER: { value: 'Server filing' },
      SOLANA_DEFAULT_NETWORK: { value: 'mainnet' },
    })
    const state = settingsDraftReducer(edited, { type: 'received', data: reloaded })
    expect(state.values.SYSTEM_ICP_RECORD_NUMBER).toBe('Draft filing')
    expect(state.values.SOLANA_MAINNET_RPC_PRIMARY).toBe('https://rpc.example.test')
    expect(state.values.SYSTEM_LOGO_FILE_PATH).toBe('draft/logo.png')
    expect(state.previewUrls.SYSTEM_LOGO_FILE_PATH).toBe('/uploads/draft/logo.png')
    expect(state.values.SOLANA_DEFAULT_NETWORK).toBe('mainnet')
    expect(state.previewUrls.SYSTEM_FAVICON_FILE_PATH).toBe('/uploads/server/favicon.ico')
    expect(getSettingsDirtySections(state)).toEqual(['branding', 'filing', 'rpc'])

    const reset = settingsDraftReducer(state, { type: 'reset' })
    expect(reset.values.SYSTEM_ICP_RECORD_NUMBER).toBe('Server filing')
    expect(reset.previewUrls.SYSTEM_LOGO_FILE_PATH).toBe('/uploads/server/logo.png')
    expect(getSettingsDirtySections(reset)).toEqual([])
  })

  it('clears a draft that now matches the server and adopts its refreshed preview', () => {
    const edited = settingsDraftReducer(createSettingsDraftState(configuration()), {
      type: 'edit', values: { SYSTEM_LOGO_FILE_PATH: 'draft/logo.png' },
      previewUrls: { SYSTEM_LOGO_FILE_PATH: '/uploads/draft/logo.png' },
    })
    const state = settingsDraftReducer(edited, {
      type: 'received',
      data: configuration({ SYSTEM_LOGO_FILE_PATH: { value: 'draft/logo.png', previewUrl: '/uploads/draft/logo.png?v=2' } }),
    })
    expect(getSettingsDirtySections(state)).toEqual([])
    expect(state.previewUrls.SYSTEM_LOGO_FILE_PATH).toBe('/uploads/draft/logo.png?v=2')
  })

  it('accepts confirmed saved values and clears sensitive input drafts', () => {
    const edited = settingsDraftReducer(createSettingsDraftState(configuration()), {
      type: 'edit', values: { SYSTEM_ICP_RECORD_NUMBER: '  Example filing  ', SOLANA_MAINNET_RPC_PRIMARY: 'https://rpc.example.test' },
    })
    const state = settingsDraftReducer(edited, {
      type: 'saved', data: configuration({ SYSTEM_ICP_RECORD_NUMBER: { value: 'Example filing' } }),
    })
    expect(state.values.SYSTEM_ICP_RECORD_NUMBER).toBe('Example filing')
    expect(state.values.SOLANA_MAINNET_RPC_PRIMARY).toBe('')
    expect(getSettingsDirtySections(state)).toEqual([])
  })
})

describe('settings save and readback', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset())

  const changes = [
    { key: 'SYSTEM_ICP_RECORD_NUMBER', value: 'Example filing' },
    { key: 'SOLANA_MAINNET_RPC_PRIMARY', value: 'https://rpc.example.test' },
  ]

  it('submits edits from multiple pages in one batch and returns fresh masked configuration', async () => {
    const data = configuration({ SYSTEM_ICP_RECORD_NUMBER: { value: 'Example filing' } })
    vi.mocked(apiFetch).mockResolvedValueOnce({ updated: 2 }).mockResolvedValueOnce(data)
    expect(await saveSettingsDraft(changes)).toBe(data)
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/admin/mm/config', {
      method: 'PUT', body: JSON.stringify({ configs: changes }),
    })
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/admin/mm/config', { cache: 'no-store' })
    expect(data.configs.find((item) => item.key === 'SOLANA_MAINNET_RPC_PRIMARY')?.value).toBe('')
  })

  it('rejects failed writes without performing readback or clearing the draft', async () => {
    const state = settingsDraftReducer(createSettingsDraftState(configuration()), {
      type: 'edit', values: Object.fromEntries(changes.map((item) => [item.key, item.value])),
    })
    const error = new Error('Write failed')
    vi.mocked(apiFetch).mockRejectedValueOnce(error)
    await expect(saveSettingsDraft(changes)).rejects.toBe(error)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(getSettingsDirtySections(state)).toEqual(['filing', 'rpc'])
  })

  it('distinguishes readback failures and retains every submitted draft', async () => {
    const state = settingsDraftReducer(createSettingsDraftState(configuration()), {
      type: 'edit', values: Object.fromEntries(changes.map((item) => [item.key, item.value])),
    })
    const error = new Error('Read failed')
    vi.mocked(apiFetch).mockResolvedValueOnce({ updated: 2 }).mockRejectedValueOnce(error)
    const result = saveSettingsDraft(changes)
    await expect(result).rejects.toBeInstanceOf(SettingsReadbackError)
    await expect(result).rejects.toMatchObject({ cause: error })
    expect(getSettingsDirtySections(state)).toEqual(['filing', 'rpc'])
    expect(state.values.SOLANA_MAINNET_RPC_PRIMARY).toBe(changes[1].value)
  })
})
