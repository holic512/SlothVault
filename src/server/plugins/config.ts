/**
 * @file config.ts
 * @project SlothVault
 * @module Plugin Configuration
 * @description Validates portable JSON Schema configuration and encrypts it with the persistent application key.
 * @logic Reject unsupported schema features, preserve masked secrets on edit, and never return plaintext credentials.
 * @dependencies Zod, node crypto, master-key, plugin protocol
 * @index_tags plugins,configuration,encryption,validation
 * @author holic512
 */
import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { getMasterKey } from '@/server/config/master-key'
import { HttpError } from '@/server/http/errors'
export const MASKED_PLUGIN_SECRET = '••••••••'
function key() { return createHash('sha256').update(`slothvault:plugins:v1:${getMasterKey()}`).digest() }
export function validatePluginConfig(manifest: PluginManifest, values: Record<string, unknown>) {
  try {
    const parsed = z.fromJSONSchema(manifest.configSchema).parse(values) as Record<string, unknown>
    if (Buffer.byteLength(JSON.stringify(parsed)) > 64 * 1024) throw new HttpError('Plugin configuration exceeds 64 KiB', 413)
    return parsed
  }
  catch (error) { if (error instanceof z.ZodError) throw new HttpError('Invalid plugin configuration', 400, 400, { reason: 'PLUGIN_CONFIG_INVALID', issues: error.issues.map(issue => ({ path: issue.path, code: issue.code })) }); if (error instanceof HttpError) throw error; throw new HttpError('Unsupported plugin configuration schema', 400) }
}
export function encryptPluginConfig(value: Record<string, unknown>) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), bytes].map(v => v.toString('base64url')).join('.')
}
export function decryptPluginConfig(value: string): Record<string, unknown> {
  if (!value) return {}
  try {
    const [iv, tag, bytes] = value.split('.').map(v => Buffer.from(v, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', key(), iv); decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString())
  } catch { throw new HttpError('Plugin configuration requires the original master key or reconfiguration', 409, 409, { reason: 'PLUGIN_CONFIG_KEY_MISMATCH' }) }
}
export function maskedPluginConfig(manifest: PluginManifest, values: Record<string, unknown>) { return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, manifest.secretFields.includes(key) && value ? MASKED_PLUGIN_SECRET : value])) }
