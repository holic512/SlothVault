/**
 * @file plugin-bundler.mjs
 * @project SlothVault
 * @module Host Controlled Plugin Compiler
 * @description Compiles validated source entries with a fixed resolver and host-owned TypeScript options.
 * @logic Restrict plugin imports before resolving, share browser contexts, and never load package build scripts or tsconfig hooks.
 * @dependencies Rollup, TypeScript, host SDK
 * @index_tags plugins,compiler,source,imports
 * @author holic512
 */
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import ts from 'typescript'
const require = createRequire(import.meta.url)
export const typescriptPlugin = {
  name: 'host-typescript',
  transform(source, id) {
    if (id.endsWith('.json') && !id.includes('/node_modules/')) return { code: `export default ${JSON.stringify(JSON.parse(source))};`, map: null }
    if (!/\.[cm]?[jt]sx?$/.test(id) || id.includes('/node_modules/')) return null
    const result = ts.transpileModule(source, { fileName: id, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true } })
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []
    if (errors.length) throw new Error(ts.formatDiagnostics(errors, { getCurrentDirectory: () => '.', getCanonicalFileName: name => name, getNewLine: () => '\n' }))
    return { code: result.outputText, map: null }
  },
}
export async function bundle(input, output, extra = {}) {
  const build = await rollup({ input, external: extra.external ?? (name => name.startsWith('node:')), onwarn(warning, warn) { if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.every(id => id.includes('/node_modules/'))) return; if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message); warn(warning) }, plugins: [typescriptPlugin, nodeResolve({ extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'] }), commonjs()], ...extra.input })
  try { await build.write({ file: output, format: 'esm', sourcemap: false, ...extra.output }) } finally { await build.close() }
}
export async function compilePlugin(directory, output, manifest, sdk) {
  const root = await realpath(directory)
  const mapping = JSON.parse(await readFile(resolve(root, 'plugin.build.json'), 'utf8'))
  const source = path => resolve(root, path)
  const hostUi = ['react', 'react/jsx-runtime', '@slothvault/plugin-sdk/client']
  const guard = browser => ({
    name: 'plugin-import-boundary',
    async resolveId(name, importer) {
      if (!importer || !importer.startsWith(root + sep)) return null
      if (name.startsWith('.')) {
        const path = resolve(dirname(importer), name)
        if (!path.startsWith(root + sep + 'src' + sep)) throw new Error('Plugin imports must stay inside src/')
        // ZIP validation already excludes links; also check the resolved file when it exists.
        for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js']) {
          try { const actual = await realpath(path + suffix); if (!actual.startsWith(root + sep + 'src' + sep)) throw new Error('Plugin source escaped src/'); return actual } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
        }
        throw new Error(`Unresolved source import: ${name}`)
      }
      if (browser && hostUi.includes(name)) return { id: name, external: true }
      if (!browser && name === '@slothvault/plugin-sdk/server') return resolve(sdk, 'server.mjs')
      if (!browser && name === '@slothvault/plugin-sdk/protocol') return resolve(sdk, 'protocol.mjs')
      if (!browser && ['zod', 'kysely'].includes(name)) return require.resolve(name)
      if (!browser && name.startsWith('node:') && builtinModules.includes(name.slice(5))) return { id: name, external: true }
      throw new Error(`Unsupported plugin dependency: ${name}; use the host SDK or package-local source`)
    },
  })
  await mkdir(output, { recursive: true, mode: 0o700 })
  if (manifest.server) await bundle(source(mapping.server), resolve(output, manifest.server), { external: () => false, input: { plugins: [guard(false), typescriptPlugin, nodeResolve(), commonjs()] } })
  for (const ui of manifest.ui) {
    const global = 'SlothVaultPlugin_' + createHash('sha256').update(manifest.id + ui.key).digest('hex').slice(0, 16)
    await bundle(source(mapping.client[ui.key]), resolve(output, ui.asset), {
      external: () => false,
      input: { plugins: [guard(true), typescriptPlugin, nodeResolve(), commonjs()] },
      output: { format: 'iife', name: global, exports: 'default', globals: { react: 'SlothVaultPluginHost.React', 'react/jsx-runtime': 'SlothVaultPluginHost.jsx', '@slothvault/plugin-sdk/client': 'SlothVaultPluginHost.ui' }, footer: `globalThis.SlothVaultPluginHost.register(${JSON.stringify(manifest.id)},${JSON.stringify(ui.key)},${global});` },
    })
    if (ui.css) { const path = resolve(output, ui.css); await mkdir(dirname(path), { recursive: true }); await writeFile(path, await readFile(source(mapping.css[ui.key])), { mode: 0o600 }) }
  }
}
