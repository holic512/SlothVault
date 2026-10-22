/**
 * @file plugin-presentation.ts
 * @project SlothVault
 * @module Plugin Presentation
 * @description Resolves optional bilingual metadata and lossless configuration drafts.
 * @logic Prefer package locale metadata, preserve unknown JSON fields, and reserve complex schema types for advanced editing.
 * @dependencies plugin protocol, API errors
 * @index_tags plugins,config,i18n
 * @author holic512
 */
import type { PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { ApiClientError } from './api-client'
export function pluginText(manifest: PluginManifest, key: 'name' | 'description', locale: string) {
  return manifest.display?.[key]?.[locale === 'zh' ? 'zh' : 'en'] || manifest[key]
}
export function parseConfigDraft(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('objectRequired')
  return value as Record<string, unknown>
}
export type ConfigField = { type: 'string' | 'boolean' | 'number' | 'integer'; enum?: (string | number | boolean)[]; title?: string; description?: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; default?: unknown }
const advancedSchemaKeys = ['anyOf', 'oneOf', 'allOf', '$ref', 'if', 'then', 'else', 'not', 'patternProperties', 'dependentSchemas', 'dependentRequired']
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
export function configFields(schema: Record<string, unknown>): [string, ConfigField][] | null {
  if (schema.type !== 'object' || !object(schema.properties)) return null
  if (advancedSchemaKeys.some(key => key in schema)) return null
  const fields = Object.entries(schema.properties)
  if (fields.some(([, field]) => !object(field)
    || !['string', 'boolean', 'number', 'integer'].includes(String(field.type))
    || advancedSchemaKeys.some(key => key in field)
    || (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || field.enum.some(item => !['string', 'number', 'boolean'].includes(typeof item)))))) return null
  return fields as [string, ConfigField][]
}
/** Never coerce a draft merely because a visual control cannot display its value. */
export function configDraftFitsFields(fields: [string, ConfigField][], value: Record<string, unknown>) {
  return fields.every(([key, field]) => {
    const current = value[key]
    if (current === undefined) return true
    if (field.enum) return field.enum.some(item => Object.is(item, current))
    return typeof current === (field.type === 'integer' ? 'number' : field.type)
  })
}
export function configFieldText(manifest: PluginManifest, key: string, field: ConfigField, locale: string) {
  const copy = manifest.display?.config?.[key], language = locale === 'zh' ? 'zh' : 'en'
  return {
    label: copy?.label[language] || field.title || key,
    description: copy?.description?.[language] || field.description,
    placeholder: copy?.placeholder?.[language],
  }
}
/** Index tokens keep boolean/number values distinct from their string equivalents. */
export function configEnumOptions(values: NonNullable<ConfigField['enum']>) {
  return values.map((item, index) => ({ value: String(index), label: String(item) }))
}
export function configEnumSelection(values: NonNullable<ConfigField['enum']>, value: unknown) {
  const index = values.findIndex(item => Object.is(item, value))
  return index < 0 ? undefined : String(index)
}
export function pluginErrorKey(error: unknown): string {
  const reason = error instanceof ApiClientError && error.data && typeof error.data === 'object' && 'reason' in error.data ? String(error.data.reason) : ''
  if (reason === 'PLUGIN_CONFIG_INVALID') return 'invalidConfig'
  if (reason === 'PLUGIN_CONFIG_KEY_MISMATCH') return 'configKeyMismatch'
  const message = error instanceof Error ? error.message : ''
  if (/rate limit/i.test(message)) return 'rateLimited'
  if (/timed out/i.test(message)) return 'timedOut'
  if (/incompatible|requires SlothVault|requires SDK|requires Node|version range/i.test(message)) return 'incompatible'
  if (/identity|ID mismatch/i.test(message)) return 'identityMismatch'
  if (/checksum|SHA-256/i.test(message)) return 'checksum'
  if (/dependency|dependent/i.test(message)) return 'dependency'
  if (/downgrade/i.test(message)) return 'downgrade'
  if (/snapshot/i.test(message)) return 'snapshot'
  if (/changed during/i.test(message)) return 'conflict'
  return 'generic'
}
