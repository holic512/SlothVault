#!/usr/bin/env node
/**
 * @file cli.mjs
 * @project SlothVault
 * @module Plugin Source Packaging
 * @description Packages source files without compiling or executing plugin-supplied code.
 * @logic Include only manifest, entry mapping and source assets; hash every file and emit a reproducible ZIP.
 * @dependencies archiver, Node filesystem/crypto
 * @index_tags plugins,source,package,release
 * @author holic512
 */
import { readFile, mkdir, readdir, lstat, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import archiver from 'archiver'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function packPlugin(directory, outdir) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'plugin.json'), 'utf8'))
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid plugin ID/version')
  if (manifest.tables?.some(table => table.legacyName)) throw new Error('Legacy table adoption is retired; use ordinary plugin tables')
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (metadata.version !== manifest.version) throw new Error('package.json and plugin.json versions must match')
  const files = new Map()
  for (const name of ['plugin.json', 'plugin.build.json']) files.set(name, await readFile(resolve(directory, name)))
  const visit = async path => {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Source packages cannot contain symbolic links')
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name), name = relative(directory, child).replaceAll('\\', '/')
      if (entry.isSymbolicLink()) throw new Error('Source packages cannot contain symbolic links')
      if (entry.isDirectory()) { if (entry.name.startsWith('.') || entry.name === 'node_modules') throw new Error('Hidden/dependency directories are not source assets'); await visit(child) }
      else {
        if (!/^[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|json|css)$/.test(name) || name.split('/').some(part => part.startsWith('.'))) throw new Error(`Unsupported source asset: ${name}`)
        files.set(name, await readFile(child))
      }
    }
  }
  await visit(resolve(directory, 'src'))
  const mapping = JSON.parse(files.get('plugin.build.json').toString())
  for (const entry of [mapping.server, ...Object.values(mapping.client ?? {}), ...Object.values(mapping.css ?? {})].filter(Boolean)) if (!files.has(entry)) throw new Error(`Missing source entry: ${entry}`)
  files.set('hashmanifest.json', Buffer.from(JSON.stringify({ algorithm: 'sha256', files: Object.fromEntries([...files].map(([name, value]) => [name, hash(value)])) }, null, 2)))
  await mkdir(outdir, { recursive: true })
  const name = `slothvault-plugin-${manifest.id}-${manifest.version}.zip`, target = resolve(outdir, name)
  await new Promise((done, fail) => {
    const output = createWriteStream(target), zip = archiver('zip', { zlib: { level: 9 } })
    output.on('close', done); output.on('error', fail); zip.on('error', fail); zip.pipe(output)
    for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) zip.append(bytes, { name: path, date: new Date('2020-01-01T00:00:00Z'), mode: 0o600 })
    void zip.finalize().catch(fail)
  })
  const checksum = hash(await readFile(target))
  await writeFile(resolve(outdir, 'checksums.sha256'), `${checksum}  ${name}\n`)
  return { manifest, path: target, checksum }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'pack', directory = '.', outdir = './dist'] = process.argv.slice(2)
  if (command !== 'pack') throw new Error('Usage: slothvault-plugin pack [plugin-directory] [output-directory]')
  const result = await packPlugin(resolve(directory), resolve(outdir))
  console.info(`${result.path}\nSHA-256 ${result.checksum}`)
}
