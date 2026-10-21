import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateZipArchive } from '../src/server/services/admin-backup/zip-validation'
import { applicationReleaseAssets, discoverReleasePlugins, packReleasePlugins } from './plugin-release-assets.mjs'

const directories = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sv-release-plugin-assets-'))
  directories.push(root)
  const write = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content) }
  write('package.json', JSON.stringify({ slothvaultRelease: { pluginAssets: true } }))
  for (const name of ['alpha', 'beta']) {
    write(`plugins/${name}/plugin.json`, JSON.stringify({ id: `test.${name}`, version: '1.0.0' }))
    write(`plugins/${name}/package.json`, JSON.stringify({ version: '1.0.0' }))
    write(`plugins/${name}/plugin.build.json`, JSON.stringify({ format: 'source-v1', server: 'src/server.ts' }))
    write(`plugins/${name}/src/server.ts`, 'throw new Error("PACKAGING_MUST_NOT_EXECUTE_PLUGIN_SOURCE")')
  }
  write('plugins/sdk/package.json', JSON.stringify({ version: '1.0.0' }))
  return { root, write }
}

describe('application source plugin attachments', () => {
  it('packages every manifest directory reproducibly, excludes SDK and only includes source assets', async () => {
    const f = fixture()
    f.write('plugins/alpha/.env', 'PRIVATE_TEST_VALUE')
    f.write('plugins/alpha/node_modules/private/index.js', 'NOT_A_SOURCE_ASSET')
    f.write('plugins/alpha/dist/server.mjs', 'NOT_A_SOURCE_ASSET')
    const packed = await packReleasePlugins(f)
    expect(packed.plugins.map(plugin => plugin.id)).toEqual(['test.alpha', 'test.beta'])
    const first = new Map(readdirSync(packed.output).map(name => [name, readFileSync(join(packed.output, name))]))
    expect([...first.keys()]).toEqual(['checksums.sha256', 'slothvault-plugin-test.alpha-1.0.0.zip', 'slothvault-plugin-test.beta-1.0.0.zip'])
    const archive = await validateZipArchive(first.get('slothvault-plugin-test.alpha-1.0.0.zip'))
    expect(archive.map(entry => entry.relativePath).sort()).toEqual(['hashmanifest.json', 'plugin.build.json', 'plugin.json', 'src/server.ts'])
    f.write('dist/application/plugins/slothvault-plugin-stale.version-0.1.0.zip', 'stale')
    await packReleasePlugins(f)
    expect(readdirSync(packed.output)).toEqual([...first.keys()])
    for (const [name, bytes] of first) expect(readFileSync(join(packed.output, name))).toEqual(bytes)
    expect(readFileSync(join(f.root, 'dist/plugins/alpha/checksums.sha256'), 'utf8')).toContain('test.alpha-1.0.0.zip')
    expect(readFileSync(join(packed.output, 'checksums.sha256'), 'utf8')).toBe(packed.plugins.map(plugin => {
      const bytes = readFileSync(join(packed.output, plugin.asset))
      return `${createHash('sha256').update(bytes).digest('hex')}  ${plugin.asset}\n`
    }).join(''))
  })

  it('requires every expected ZIP and a complete, unique, matching checksum file before publishing', async () => {
    const f = fixture(), packed = await packReleasePlugins(f)
    f.write('dist/application/plugins/slothvault-image-manifest.json', '{}')
    expect(applicationReleaseAssets(f.root, packed.output)).toHaveLength(4)
    const checksumPath = join(packed.output, 'checksums.sha256')
    const checksums = readFileSync(checksumPath, 'utf8')
    writeFileSync(checksumPath, checksums.split('\n')[0] + '\n')
    expect(() => applicationReleaseAssets(f.root, packed.output)).toThrow('every plugin')
    writeFileSync(checksumPath, checksums + checksums)
    expect(() => applicationReleaseAssets(f.root, packed.output)).toThrow('duplicate')
    writeFileSync(checksumPath, checksums)
    const zip = join(packed.output, packed.plugins[0].asset)
    writeFileSync(zip, 'CORRUPT')
    expect(() => applicationReleaseAssets(f.root, packed.output)).toThrow('checksum mismatch')
    rmSync(zip)
    expect(() => applicationReleaseAssets(f.root, packed.output)).toThrow()
  })

  it('keeps the old image-only contract for historical sources without the policy marker', () => {
    const f = fixture()
    f.write('package.json', '{}')
    f.write('dist/legacy/slothvault-image-manifest.json', '{}')
    expect(applicationReleaseAssets(f.root, join(f.root, 'dist/legacy'))).toEqual([join(f.root, 'dist/legacy/slothvault-image-manifest.json')])
  })

  it('rejects inconsistent versions, duplicate IDs and missing source entrypoints', async () => {
    const f = fixture()
    f.write('plugins/alpha/package.json', '{"version":"2.0.0"}')
    expect(() => discoverReleasePlugins(f.root)).toThrow('versions differ')
    f.write('plugins/alpha/package.json', '{"version":"1.0.0"}')
    f.write('plugins/beta/plugin.json', '{"id":"test.alpha","version":"1.0.0"}')
    expect(() => discoverReleasePlugins(f.root)).toThrow('Duplicate plugin IDs')
    f.write('plugins/beta/plugin.json', '{"id":"test.beta","version":"1.0.0"}')
    f.write('plugins/alpha/plugin.build.json', '{"format":"source-v1","server":"src/missing.ts"}')
    await expect(packReleasePlugins(f)).rejects.toThrow('Missing source entry')
  })
})
