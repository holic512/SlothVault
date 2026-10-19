/**
 * @file build-plugins.mjs
 * @project SlothVault
 * @module Host Plugin Runtime Build
 * @description Produces the fixed worker, compiler and SDK runtime before Next builds without compiling or installing plugins.
 * @logic Build host SDK declarations and runtime once, and keep source-plugin installation separate from application startup.
 * @dependencies Rollup, TypeScript, host SDK sources
 * @index_tags plugins,build,sdk,standalone,compiler
 * @author holic512
 */
import { mkdir, readFile, copyFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { bundle, typescriptPlugin } from './plugin-bundler.mjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
const root = process.cwd(), sdk = resolve('plugins/sdk'), output = resolve('generated/plugin-runtime')
// Remove only obsolete host-generated seeds; plugin installation is always manual.
for (const name of ['seed.json', 'gift-cards.zip']) await rm(resolve(output, name), { force: true })
await mkdir(resolve(sdk, 'dist'), { recursive: true }); await mkdir(output, { recursive: true })
for (const name of ['server', 'protocol', 'client', 'index']) await bundle(resolve(sdk, 'src', name + '.ts'), resolve(sdk, 'dist', name + '.mjs'), { external: name === 'client' ? ['antd', '@tanstack/react-query', 'next-intl'] : undefined })
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', resolve(sdk, 'tsconfig.json')], { stdio: 'inherit' }); if (result.status) process.exit(result.status)
await bundle(resolve('scripts/plugin-worker.ts'), resolve(output, 'worker.mjs'), { input: { plugins: [typescriptPlugin, nodeResolve({ extensions: ['.ts', '.tsx', '.mjs', '.js'] }), commonjs()] } })
await mkdir(resolve(output, 'sdk'), { recursive: true })
for (const name of ['server', 'protocol']) await copyFile(resolve(sdk, 'dist', name + '.mjs'), resolve(output, 'sdk', name + '.mjs'))
await bundle(resolve('scripts/plugin-compiler.mjs'), resolve(output, 'compiler.mjs'), { external: name => name.startsWith('node:') || ['rollup', 'typescript', '@rollup/plugin-node-resolve', '@rollup/plugin-commonjs'].includes(name) })
const pkg = JSON.parse(await readFile(resolve(sdk, 'package.json'), 'utf8'))
console.info(`[plugins] Host SDK ${pkg.version}, worker and source compiler ready (${root}); no plugin installed or compiled`)
