import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ path: '' }))
vi.mock('@/server/config/app-data', () => ({ appDataPath: () => storage.path }))
vi.mock('@/server/config/master-key', () => ({ getMasterKey: () => 'isolated-source-compiler-test-key' }))
import { ensureCompiledPlugin, compiledAsset } from './compiler'
import { stagePluginPackage, readVerifiedPluginAsset } from './packages'
import { editTestPackage, readTestPackage } from './test-package'
const bytes = () => readTestPackage('gift-cards')
beforeEach(() => { storage.path = mkdtempSync(resolve(tmpdir(), 'sv-source-compiler-')) })
afterEach(() => rmSync(storage.path, { recursive: true, force: true }))
describe('source-only installation compiler', () => {
  it('compiles source TS/TSX without loading plugin code and rebuilds missing cache', async () => {
    const source = await stagePluginPackage(bytes())
    await ensureCompiledPlugin(source.digest, source.manifest)
    expect(readFileSync(compiledAsset(source.digest, source.manifest.id, source.manifest.server!), 'utf8')).toContain('Gift card')
    expect((await readVerifiedPluginAsset(source.digest, source.manifest, 'client/manage.js')).toString()).toContain('SlothVaultPluginHost')
    await ensureCompiledPlugin(source.digest, source.manifest)
    rmSync(resolve(storage.path, 'plugins', source.manifest.id, 'compiled'), { recursive: true })
    await ensureCompiledPlugin(source.digest, source.manifest)
  }, 30000)
  it('bundles package-local JSON through the fixed compiler', async () => {
    const changed = await editTestPackage(bytes(), files => {
      files.set('src/settings.json', Buffer.from('{"message":"package-local-json"}'))
      files.set('src/server.ts', Buffer.from("import settings from './settings.json'; export default () => settings.message"))
    })
    const source = await stagePluginPackage(changed)
    await ensureCompiledPlugin(source.digest, source.manifest)
    expect(readFileSync(compiledAsset(source.digest, source.manifest.id, source.manifest.server!), 'utf8')).toContain('package-local-json')
  }, 30000)
  it('rejects undeclared dependencies and imports escaping source before executing code', async () => {
    for (const path of ['../../outside.ts', 'some-uninstalled-library', '/etc/passwd']) {
      const changed = await editTestPackage(bytes(), files => files.set('src/server.ts', Buffer.from(`import x from ${JSON.stringify(path)}; export default () => x`)))
      const source = await stagePluginPackage(changed)
      await expect(ensureCompiledPlugin(source.digest, source.manifest)).rejects.toThrow('compilation failed')
    }
  }, 30000)
})
