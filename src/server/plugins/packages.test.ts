import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ path: '' }))
vi.mock('@/server/config/app-data', () => ({ appDataPath: () => storage.path }))
vi.mock('@/server/config/master-key', () => ({ getMasterKey: () => 'test-plugin-key' }))
import { verifyPluginPackage, stagePluginPackage, verifyInstalledPackage, packageAsset } from './packages'
import { editTestPackage } from './test-package'
import { assertPortableTableGraph, pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { githubRepository } from './sources'
import { encryptPluginConfig, decryptPluginConfig, validatePluginConfig, maskedPluginConfig } from './config'

const bytes = () => readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip')
describe('static plugin package trust boundary', () => {
  beforeEach(() => { storage.path = mkdtempSync(resolve(tmpdir(), 'sv-plugin-package-')) })
  afterEach(() => rmSync(storage.path, { recursive: true, force: true }))
  it('verifies the independently built ZIP without executing code', async () => {
    const result = await verifyPluginPackage(bytes())
    expect(result.manifest.id).toBe('slothvault.gift-cards')
    expect(result.files.has('src/server.ts')).toBe(true)
  })
  it('rejects extra files, corrupt hashes, missing entry points and incompatible hosts', async () => {
    const changedPayload = await editTestPackage(bytes(), files => files.set('src/server.ts', Buffer.from('throw new Error("TAMPERED")')), false)
    await expect(verifyPluginPackage(changedPayload)).rejects.toThrow('SHA-256')
    const corruptHash = await editTestPackage(bytes(), files => files.set('hashmanifest.json', Buffer.from('{}')))
    // editTestPackage rewrites hashes; an extra self-referential hash is still invalid.
    await expect(verifyPluginPackage(corruptHash)).rejects.toThrow()
    for (const edit of [
      (files: Map<string, Buffer>) => files.delete('src/server.ts'),
      (files: Map<string, Buffer>) => { const manifest = JSON.parse(files.get('plugin.json')!.toString()); manifest.engines.sdk = '>=99'; files.set('plugin.json', Buffer.from(JSON.stringify(manifest))) },
      (files: Map<string, Buffer>) => files.set('../escape.mjs', Buffer.from('throw new Error("NOT_EXECUTED")')),
    ]) await expect(verifyPluginPackage(await editTestPackage(bytes(), edit))).rejects.toThrow()
  })
  it('anchors installed file verification to the original ZIP, not a replaceable local hash file', async () => {
    const result = await stagePluginPackage(bytes())
    await verifyInstalledPackage(result.digest, result.manifest)
    await Promise.all([stagePluginPackage(bytes()), verifyInstalledPackage(result.digest, result.manifest), stagePluginPackage(bytes())])
    writeFileSync(packageAsset(result.digest, 'src/server.ts', result.manifest.id), 'throw new Error("TAMPERED")')
    await expect(verifyInstalledPackage(result.digest, result.manifest)).rejects.toThrow()
    await stagePluginPackage(bytes())
    await expect(verifyInstalledPackage(result.digest, result.manifest)).resolves.toBeUndefined()
  })
  it('rejects arbitrary download sources and malformed repository selectors', () => {
    expect(githubRepository('https://github.com/holic512/SlothVault')).toBe('holic512/SlothVault')
    for (const input of ['http://127.0.0.1/a/b', 'https://github.com.evil.test/a/b', '../../etc', 'https://github.com/a/b/tree/main']) expect(() => githubRepository(input)).toThrow()
  })
  it('validates config and encrypts even non-secret fields at rest', async () => {
    const { manifest } = await verifyPluginPackage(bytes())
    expect(() => validatePluginConfig(manifest, { maxBatchQuantity: -1 })).toThrow()
    const config = { maxBatchQuantity: 123, credential: 'not-a-real-secret' }
    const ciphertext = encryptPluginConfig(config)
    expect(ciphertext).not.toContain('not-a-real-secret')
    expect(decryptPluginConfig(ciphertext)).toEqual(config)
    expect(maskedPluginConfig({ ...manifest, secretFields: ['credential'] }, config).credential).not.toBe(config.credential)
    expect(() => decryptPluginConfig(ciphertext.slice(0, -5) + 'AAAAA')).toThrow()
  })
  it('rejects duplicate task and service declarations', async () => {
    const { manifest } = await verifyPluginPackage(bytes())
    expect(pluginManifestSchema.safeParse({ ...manifest, jobs: [{ key: 'tick', intervalSeconds: 60 }, { key: 'tick', intervalSeconds: 120 }] }).success).toBe(false)
    expect(pluginManifestSchema.safeParse({ ...manifest, services: ['issue', 'issue'] }).success).toBe(false)
    expect(pluginManifestSchema.safeParse({ ...manifest, capabilities: [...manifest.capabilities, 'events'], events: ['core.article.published', 'core.article.published'] }).success).toBe(false)
  })

  it('requires table ownership, portable references and acyclic schema graphs', async () => {
    const { manifest } = await verifyPluginPackage(bytes())
    expect(() => assertPortableTableGraph(manifest.tables)).not.toThrow()
    const exposed = structuredClone(manifest); exposed.ui[0].asset = exposed.server!
    expect(pluginManifestSchema.safeParse(exposed).success).toBe(false)
    const bad = structuredClone(manifest); Object.assign(bad.tables[0], { legacyName: 'points_gift_card_batch' })
    expect(pluginManifestSchema.safeParse(bad).success).toBe(false)
    const cycle = [{ name: 'loop', columns: [{ name: 'id', type: 'integer' as const, primary: true, nullable: false, generated: false, references: { table: 'loop', column: 'id', onDelete: 'CASCADE' as const } }], indexes: [] }]
    expect(() => assertPortableTableGraph(cycle)).toThrow('Cyclic')
  })
})
