import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { ApiClientError } from './api-client'
import {
  configDraftFitsFields, configEnumOptions, configEnumSelection, configFields,
  configFieldText, parseConfigDraft, pluginErrorKey, pluginText,
} from './plugin-presentation'

const manifest = pluginManifestSchema.parse({
  schema: 1, id: 'test.configuration', name: 'Original name', description: 'Original description', version: '1.0.0', author: 'Test',
  engines: { slothvault: '*', sdk: '*', node: '*' },
  display: {
    name: { zh: '插件名称', en: 'Localized name' },
    config: { rate: { label: { zh: '积分汇率', en: 'Point rate' }, description: { zh: '保留小数精度', en: 'Preserve decimal precision' } } },
  },
})

describe('plugin configuration presentation', () => {
  it('preserves nested unknown values, exact decimal strings and masked secrets through a draft edit', () => {
    const draft = parseConfigDraft('{"rate":"9999999999.12345678","secret":"••••••••","unknown":{"values":[1,null,"v"]},"enabled":false}')
    const edited = parseConfigDraft(JSON.stringify({ ...draft, enabled: true }))
    expect(edited).toEqual({ rate: '9999999999.12345678', secret: '••••••••', unknown: { values: [1, null, 'v'] }, enabled: true })
  })

  it.each(['null', '[]', '42', 'true', '"value"', '{broken'])('rejects %s without inventing configuration values', text => {
    expect(() => parseConfigDraft(text)).toThrow()
  })

  it('recognizes simple fields without applying defaults to the saved draft', () => {
    const fields = configFields({ type: 'object', properties: { enabled: { type: 'boolean', default: false }, rate: { type: 'string' }, amount: { type: 'integer', minimum: 1 } } })
    expect(fields?.map(([key]) => key)).toEqual(['enabled', 'rate', 'amount'])
    expect(configDraftFitsFields(fields!, { rate: '1.23456789', extra: { untouched: true } })).toBe(true)
    expect(parseConfigDraft('{}')).toEqual({})
  })

  it.each([
    { type: 'array' },
    { type: 'object', properties: { nested: { type: 'object', properties: {} } } },
    { type: 'object', properties: { list: { type: 'array' } } },
    { type: 'object', properties: { nullable: { type: ['string', 'null'] } } },
    { type: 'object', properties: {}, dependentRequired: { a: ['b'] } },
    { type: 'object', properties: {}, oneOf: [] },
    { type: 'object', properties: { invalid: 'string' } },
    { type: 'object', properties: { invalid: false } },
    { type: 'object', properties: { value: { type: 'string', enum: [null] } } },
    { type: 'object', properties: { value: { type: 'string', enum: 'invalid' } } },
    { type: 'object', properties: { value: { type: 'string', $ref: '#/$defs/value' } } },
  ])('uses advanced editing for unsupported schema %j without throwing', schema => {
    expect(configFields(schema)).toBeNull()
  })

  it('refuses visual coercion of mismatched JSON values', () => {
    const fields = configFields({ type: 'object', properties: { amount: { type: 'integer' }, label: { type: 'string' } } })!
    expect(configDraftFitsFields(fields, { amount: '42', label: 'Label' })).toBe(false)
    expect(configDraftFitsFields(fields, { amount: 42, label: { nested: 'value' } })).toBe(false)
    expect(configDraftFitsFields(fields, { amount: 42, label: 'Label' })).toBe(true)
  })

  it('round-trips mixed enum values using unique string tokens', () => {
    const values = [true, 'true', 1, '1', false]
    const options = configEnumOptions(values)
    expect(new Set(options.map(option => option.value)).size).toBe(values.length)
    for (const original of values) {
      const selection = configEnumSelection(values, original)
      expect(typeof selection).toBe('string')
      expect(values[Number(selection)]).toBe(original)
    }
    expect(configEnumSelection(values, 'missing')).toBeUndefined()
  })

  it('prefers package translations and falls back to schema labels or legacy metadata', () => {
    expect(pluginText(manifest, 'name', 'zh')).toBe('插件名称')
    expect(pluginText(manifest, 'name', 'en')).toBe('Localized name')
    expect(pluginText(manifest, 'description', 'zh')).toBe('Original description')
    expect(configFieldText(manifest, 'rate', { type: 'string', title: 'Rate' }, 'zh')).toMatchObject({ label: '积分汇率', description: '保留小数精度' })
    expect(configFieldText(manifest, 'legacy', { type: 'string', title: 'Legacy', description: 'Hint' }, 'zh')).toMatchObject({ label: 'Legacy', description: 'Hint' })
    expect(configFieldText(manifest, 'unknown', { type: 'string' }, 'en').label).toBe('unknown')
  })
})

describe('plugin error presentation', () => {
  it.each([
    ['PLUGIN_CONFIG_INVALID', 'invalidConfig'],
    ['PLUGIN_CONFIG_KEY_MISMATCH', 'configKeyMismatch'],
  ])('maps stable reason %s independently of server prose', (reason, key) => {
    expect(pluginErrorKey(new ApiClientError('Any server description', 400, 400, { reason }))).toBe(key)
  })
  it.each([
    ['GitHub rate limit exceeded', 'rateLimited'], ['Request timed out', 'timedOut'],
    ['Package requires SDK 2', 'incompatible'], ['Official package ID mismatch', 'identityMismatch'],
    ['Release package SHA-256 mismatch', 'checksum'], ['Disable dependent plugin first', 'dependency'],
    ['No upgrade snapshot is available', 'snapshot'], ['Plugin changed during compilation', 'conflict'],
    ['Use rollback snapshot to downgrade', 'downgrade'],
    ['Unrecognized potentially sensitive details', 'generic'],
  ])('maps %s to a localized key', (message, key) => { expect(pluginErrorKey(new Error(message))).toBe(key) })
  it('does not expose unknown objects', () => { expect(pluginErrorKey({ token: 'sensitive' })).toBe('generic') })
})
