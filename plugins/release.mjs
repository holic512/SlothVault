/**
 * @file plugins/release.mjs
 * @project SlothVault
 * @module Independent Plugin Release Identity
 * @description Verifies immutable plugin/SDK tags and prepares their own versioned artifacts.
 * @logic Match the selected tag to committed package metadata and reject changed content at an already released version; never change application versions or Git history.
 * @dependencies Git, Node crypto/fs, npm pack, source packer and built SDK runtime
 * @index_tags plugins,release,versions,github-actions
 * @author holic512
 */
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, copyFile, appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import semver from 'semver'
import { packPlugin } from './sdk/cli.mjs'

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
const match = /^plugin-(sdk|gift-cards|example)-v(\d+\.\d+\.\d+)$/.exec(tag ?? '')
if (!match || !semver.valid(match[2])) throw new Error('Use plugin-{sdk|gift-cards|example}-vM.m.p')
const [, module, version] = match
const directory = `plugins/${module}`
const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'))
if (version !== pkg.version) throw new Error('Tag and committed package version differ')
if (module !== 'sdk' && JSON.parse(await readFile(`${directory}/plugin.json`, 'utf8')).version !== version) throw new Error('Manifest version differs')
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
if (git(['rev-list', '-n', '1', tag]) !== git(['rev-parse', 'HEAD'])) throw new Error('Tag must point at checked out HEAD')
const previous = git(['tag', '--list', `plugin-${module}-v*`]).split('\n').filter(value => value !== tag && semver.valid(value.slice(`plugin-${module}-v`.length))).sort((a, b) => semver.compare(a.slice(`plugin-${module}-v`.length), b.slice(`plugin-${module}-v`.length))).at(-1)
if (previous && !semver.gt(version, previous.slice(`plugin-${module}-v`.length))) throw new Error('Plugin/SDK version must exceed previous release')
let output = `dist/plugins/${module}`
if (module !== 'sdk') await packPlugin(directory, output)
if (module === 'sdk') {
  output = 'dist/plugin-sdk'
  await mkdir(output, { recursive: true })
  await copyFile('LICENSE', `${directory}/LICENSE`)
  execFileSync('npm', ['pack', `./${directory}`, '--pack-destination', output], { stdio: 'inherit' })
  const filename = `slothvault-plugin-sdk-${version}.tgz`
  const bytes = await readFile(`${output}/${filename}`)
  await appendFile(`${output}/checksums.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`)
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `directory=${output}\nmodule=${module}\nversion=${version}\n`)
console.info(`Validated ${tag}; artifacts: ${output}`)
