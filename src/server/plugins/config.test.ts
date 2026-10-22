import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { HttpError } from '@/server/http/errors'
import { validatePluginConfig } from './config'

const manifest = pluginManifestSchema.parse({
  schema: 1, id: 'test.config', name: 'Configuration test', version: '1.0.0', author: 'test',
  engines: { slothvault: '*', sdk: '*', node: '*' },
  configSchema: {
    type: 'object', additionalProperties: false, required: ['credential'],
    properties: { credential: { type: 'string', enum: ['schema-only-secret'] } },
  },
  secretFields: ['credential'],
})

describe('plugin configuration validation', () => {
  it('returns valid configuration using the declared schema', () => {
    expect(validatePluginConfig(manifest, { credential: 'schema-only-secret' })).toEqual({ credential: 'schema-only-secret' })
  })

  it('returns field paths and codes without exposing configuration values or schema secrets', () => {
    let failure: unknown
    try { validatePluginConfig(manifest, { credential: 'submitted-secret' }) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({ status: 400, code: 400, data: { reason: 'PLUGIN_CONFIG_INVALID', issues: [{ path: ['credential'], code: 'invalid_value' }] } })
    const serialized = JSON.stringify(failure)
    expect(serialized).not.toContain('submitted-secret')
    expect(serialized).not.toContain('schema-only-secret')
  })

  it('preserves the explicit size-limit response for valid oversized configuration', () => {
    const large = { ...manifest, configSchema: { type: 'object', properties: { value: { type: 'string' } } } }
    expect(() => validatePluginConfig(large, { value: 'x'.repeat(64 * 1024) })).toThrow(expect.objectContaining({ status: 413 }))
  })

  it('reports unsupported schemas as a client error without exposing their details', () => {
    const unsupported = { ...manifest, configSchema: { type: 'unknown-type', description: 'private-schema-detail' } }
    expect(() => validatePluginConfig(unsupported, {})).toThrow(expect.objectContaining({ status: 400, message: 'Unsupported plugin configuration schema' }))
  })
})
