/**
 * @file scripts/release-delivery.mjs
 * @project SlothVault
 * @module Independent release delivery
 * @description Delivers commit-derived releases without replacing published tags, assets or images.
 * @logic Pin a default-branch ancestor, validate versions, recover matching drafts, verify native image digests, then promote only the newest successful application.
 * @dependencies Git, GitHub CLI, Docker Buildx, release-version, docker-image-size
 * @index_tags release,github-actions,arm64,manifest,commit-log,recovery
 * @author holic512
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { compareVersions, isApplicationChange, isModulePackageFile, parseSemanticVersion, prepareModuleVersion, resolveReleaseIdentity } from './release-version.mjs'
import { inspectPlatformSizes, supportedPlatforms, formatMebibytes } from './docker-image-size.mjs'

const shaPattern = /^[a-f0-9]{40}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const jsonFile = path => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

export function releaseVersion(module, tag) {
  const prefix = module === 'application' ? 'v' : `${module}-v`
  const suffix = module === 'application' ? '(?:-build\\.\\d+)?' : ''
  const match = tag.match(new RegExp(`^${prefix}((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*))${suffix}$`))
  return match?.[1] ?? null
}

export function relevantChanges(module, paths) {
  return module === 'application' ? isApplicationChange(paths) : paths.some(file => isModulePackageFile(module, file))
}

export function verifyImageConfig(config, identity, platform) {
  if (`${config.os}/${config.architecture}` !== platform) throw new Error(`Wrong image architecture for ${platform}`)
  const labels = config.config?.Labels ?? {}
  if (labels['org.opencontainers.image.revision'] !== identity.sha || labels['org.opencontainers.image.version'] !== identity.tag) {
    throw new Error(`Image identity conflicts with ${identity.tag} on ${platform}`)
  }
  const environment = new Map((config.config?.Env ?? []).map(line => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
  for (const [key, value] of Object.entries({
    SLOTHVAULT_APP_VERSION: identity.version,
    SLOTHVAULT_RELEASE_TAG: identity.tag,
    SLOTHVAULT_RELEASE_COMMIT_SHA: identity.sha,
  })) {
    if (environment.get(key) !== value) throw new Error(`Image is missing matching ${key}`)
  }
}

export function verifyAsset(asset, bytes, downloadedBytes) {
  const digest = asset.digest ?? (downloadedBytes && hash(downloadedBytes))
  if (asset.size !== bytes.length || digest !== hash(bytes)) throw new Error(`Release asset conflicts: ${asset.name}`)
}

function execute(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024 * 1024, ...options })
}

/** Network and process boundaries are injectable so recovery can be tested without publishing. */
export class ReleaseDelivery {
  constructor({ root = process.cwd(), repository = process.env.GITHUB_REPOSITORY, defaultBranch = process.env.DEFAULT_BRANCH,
    image = process.env.IMAGE_REPOSITORY, run = execute } = {}) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('A valid GitHub repository is required')
    this.root = resolve(root)
    this.repository = repository
    this.defaultBranch = defaultBranch
    this.image = image
    this.run = (binary, args, options) => run(binary, args, { cwd: this.root, encoding: 'utf8', ...options })
  }

  git(args, raw = false) {
    const output = this.run('git', args)
    return raw ? output : output.trim()
  }

  tagCommit(tag) {
    try { return this.git(['rev-parse', '--quiet', '--verify', '--end-of-options', `refs/tags/${tag}^{commit}`]) } catch (error) {
      if (error.status === 1) return null
      throw error
    }
  }

  api(endpoint, { missing = false, binary = false } = {}) {
    try {
      const output = this.run('gh', ['api', `repos/${this.repository}/${endpoint}`, ...(binary ? ['-H', 'Accept: application/octet-stream'] : [])], binary ? { encoding: null } : {})
      return binary ? output : JSON.parse(output)
    } catch (error) {
      if (missing && /\(HTTP 404\)/.test(String(error.stderr))) return null
      throw error
    }
  }

  releases() {
    const pages = JSON.parse(this.run('gh', ['api', '--paginate', '--slurp', `repos/${this.repository}/releases?per_page=100`]))
    return pages.flat()
  }

  release(tag) { return this.api(`releases/tags/${encodeURIComponent(tag)}`, { missing: true }) }

  assertDefaultAncestor(sha) {
    if (!shaPattern.test(sha)) throw new Error('Release target must be a full commit SHA')
    if (!this.defaultBranch) throw new Error('Default branch is required for publishing')
    this.git(['check-ref-format', '--branch', this.defaultBranch])
    this.git(['merge-base', '--is-ancestor', sha, `refs/remotes/origin/${this.defaultBranch}`])
    if (!this.git(['rev-list', '--first-parent', `refs/remotes/origin/${this.defaultBranch}`]).split('\n').includes(sha)) {
      throw new Error('Release target must belong to the default branch first-parent history')
    }
  }

  changedFiles(sha) {
    const parents = this.git(['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1)
    return this.git(parents.length ? ['diff', '--name-only', '-z', parents[0], sha] : ['ls-tree', '-r', '--name-only', '-z', sha], true).split('\0').filter(Boolean)
  }

  async prepare(module, { publish = false, sourceRef = '' } = {}) {
    if (!['application', 'skill', 'deployment'].includes(module)) throw new Error(`Unknown module: ${module}`)
    if (sourceRef && !shaPattern.test(sourceRef) && !releaseVersion(module, sourceRef)) {
      throw new Error('Manual delivery accepts a full commit SHA or a version Tag')
    }
    const head = this.git(['rev-parse', 'HEAD'])
    if (sourceRef && this.git(['rev-parse', '--verify', '--end-of-options', `${sourceRef}^{commit}`]) !== head) throw new Error('Checkout does not match the requested target')
    if (publish) this.assertDefaultAncestor(head)
    const metadata = jsonFile(join(this.root, module === 'application' ? 'package.json' : `integrations/${module}/module.json`))
    parseSemanticVersion(metadata.version)
    const tag = `${module === 'application' ? '' : `${module}-`}v${metadata.version}`
    const existing = publish ? this.release(tag) : null
    const tagged = this.tagCommit(tag)
    if (existing && !tagged) throw new Error(`Release ${tag} is missing its Git tag`)
    if (tagged && tagged !== head) {
      const paths = this.git(['diff', '--name-only', '-z', tagged, head], true).split('\0').filter(Boolean)
      if (relevantChanges(module, paths)) throw new Error(`Content conflicts with existing ${tag}; advance the version`)
      if (publish) this.assertDefaultAncestor(tagged)
    }
    if (existing?.prerelease) throw new Error(`Cannot replace prerelease ${tag}`)
    // Historical retries use the immutable tagged source, including unchanged module-only pushes.
    if (module === 'application') {
      await resolveReleaseIdentity({ root: this.root, packageJsonPath: pathToFileURL(join(this.root, 'package.json')), commit: head })
    } else {
      await prepareModuleVersion(module, { root: pathToFileURL(`${this.root}/`), check: true, ancestorOnly: true })
    }
    if (module === 'application') {
      const lock = jsonFile(join(this.root, 'package-lock.json'))
      if (lock.version !== metadata.version || lock.packages?.['']?.version !== metadata.version) throw new Error('Application lockfile version is inconsistent')
    }
    return { module, sha: tagged ?? head, version: metadata.version, tag, publish, state: existing ? (existing.draft ? 'draft' : 'published') : 'new' }
  }

  notes(identity) {
    const lineage = this.git(['rev-list', '--first-parent', identity.sha]).split('\n')
    const positions = new Map(lineage.map((sha, index) => [sha, index]))
    const previous = this.releases().filter(item => !item.draft && !item.prerelease && item.tag_name !== identity.tag && releaseVersion(identity.module, item.tag_name))
      .map(item => ({ tag: item.tag_name, sha: this.tagCommit(item.tag_name) }))
      .filter(item => positions.has(item.sha) && positions.get(item.sha) > 0)
      .sort((a, b) => positions.get(a.sha) - positions.get(b.sha))[0]
    const commits = lineage.slice(0, previous ? positions.get(previous.sha) : undefined).reverse()
      .filter(sha => relevantChanges(identity.module, this.changedFiles(sha)))
    return commits.map(sha => {
      const object = this.git(['cat-file', 'commit', sha], true)
      const message = object.slice(object.indexOf('\n\n') + 2)
      return `[${sha.slice(0, 8)}](https://github.com/${this.repository}/commit/${sha})\n\n${message}${message.endsWith('\n') ? '' : '\n'}`
    }).join('\n---\n\n')
  }

  verifyReleaseTarget(release, identity) {
    if (!release || release.tag_name !== identity.tag || this.tagCommit(identity.tag) !== identity.sha || release.prerelease) throw new Error(`Release target conflicts with ${identity.tag}`)
  }

  checkAssets(release, assets, { allowMissing = false } = {}) {
    const missing = []
    const expected = new Set(assets.map(path => basename(path)))
    if ((release.assets ?? []).some(asset => !expected.has(asset.name))) throw new Error(`Unexpected assets in ${release.tag_name}`)
    for (const path of assets) {
      const matches = (release.assets ?? []).filter(asset => asset.name === basename(path))
      if (matches.length > 1) throw new Error(`Duplicate release asset: ${basename(path)}`)
      if (!matches.length) {
        if (!allowMissing) throw new Error(`Release asset is missing: ${basename(path)}`)
        missing.push(path)
        continue
      }
      const asset = matches[0]
      verifyAsset(asset, readFileSync(path), asset.digest ? undefined : this.api(`releases/assets/${asset.id}`, { binary: true }))
    }
    return missing
  }

  publish(identity, outdir) {
    if (!identity.publish) throw new Error('Publishing is disabled for this event')
    this.git(['fetch', '--tags', 'origin'])
    this.assertDefaultAncestor(identity.sha)
    if (this.git(['rev-parse', 'HEAD']) !== identity.sha) throw new Error('Source checkout does not match release identity')
    const assets = identity.module === 'application' ? [join(outdir, 'slothvault-image-manifest.json')] : [
      join(outdir, `slothvault-${identity.module}-${identity.version}.tgz`), join(outdir, `slothvault-${identity.module}-manifest.json`),
    ]
    let release = this.release(identity.tag)
    if (release) {
      this.verifyReleaseTarget(release, identity)
      if (!release.draft) {
        this.checkAssets(release, assets)
        return 'verified-existing'
      }
    }
    const notes = this.notes(identity)
    if (!notes) throw new Error('Release has no relevant commit messages')
    const notesPath = join(outdir, 'release-notes.md')
    writeFileSync(notesPath, notes)
    if (!release) {
      const tagged = this.tagCommit(identity.tag)
      if (tagged && tagged !== identity.sha) throw new Error('Cannot move an existing tag')
      this.run('gh', ['release', 'create', identity.tag, '--repo', this.repository, '--draft', '--latest=false', '--target', identity.sha,
        '--title', `SlothVault ${identity.module === 'application' ? '' : `${identity.module} `}${identity.version}`, '--notes-file', notesPath])
      this.git(['fetch', '--tags', 'origin'])
      release = this.release(identity.tag)
    }
    this.verifyReleaseTarget(release, identity)
    if (release.body?.trimEnd() !== notes.trimEnd()) throw new Error('Draft notes conflict with the pinned commit history')
    for (const asset of this.checkAssets(release, assets, { allowMissing: true })) {
      this.run('gh', ['release', 'upload', identity.tag, asset, '--repo', this.repository])
    }
    release = this.release(identity.tag)
    this.verifyReleaseTarget(release, identity)
    this.checkAssets(release, assets)
    this.run('gh', ['release', 'edit', identity.tag, '--repo', this.repository, '--draft=false', '--latest=false'])
    release = this.release(identity.tag)
    this.verifyReleaseTarget(release, identity)
    if (release.draft) throw new Error('Release is still a draft after publishing')
    return 'published'
  }

  dockerInspect(reference, format = '{{json .Manifest}}', { missing = false } = {}) {
    try { return JSON.parse(this.run('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', format])) } catch (error) {
      if (missing && /manifest unknown|not found|no such manifest/i.test(String(error.stderr))) return null
      throw error
    }
  }

  async inspectImage(identity, { missing = false } = {}) {
    if (!/^[a-z0-9][a-z0-9._/-]+$/.test(this.image ?? '')) throw new Error('A Docker image repository without tag is required')
    const descriptor = this.dockerInspect(`${this.image}:${identity.tag}`, undefined, { missing })
    if (!descriptor) return null
    if (!digestPattern.test(descriptor.digest)) throw new Error('Registry did not return an image digest')
    const reference = `${this.image}@${descriptor.digest}`
    const sizes = await inspectPlatformSizes(reference, ref => this.run('docker', ['buildx', 'imagetools', 'inspect', ref, '--raw']))
    for (const platform of supportedPlatforms) {
      verifyImageConfig(this.dockerInspect(`${this.image}@${sizes[platform].digest}`, '{{json .Image}}'), identity, platform)
    }
    return { schema: 1, version: identity.version, tag: identity.tag, commit: identity.sha, image: this.image, digest: descriptor.digest, platforms: sizes }
  }

  async mergeImages(identity, directory, outdir) {
    const records = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => jsonFile(join(directory, name)))
    if (records.length !== supportedPlatforms.length || new Set(records.map(record => record.platform)).size !== supportedPlatforms.length) throw new Error('Exactly two native platform results are required')
    for (const record of records) {
      if (!supportedPlatforms.includes(record.platform) || !digestPattern.test(record.digest) || record.sha !== identity.sha || record.tag !== identity.tag || record.version !== identity.version) throw new Error('Platform result does not match release identity')
      verifyImageConfig(this.dockerInspect(`${this.image}@${record.digest}`, '{{json .Image}}'), identity, record.platform)
    }
    let manifest = await this.inspectImage(identity, { missing: true })
    if (!manifest) {
      this.run('docker', ['buildx', 'imagetools', 'create', '--tag', `${this.image}:${identity.tag}`, ...records.map(record => `${this.image}@${record.digest}`)])
      manifest = await this.inspectImage(identity)
    }
    for (const record of records) {
      if (manifest.platforms[record.platform].digest !== record.digest) throw new Error('Existing version image cannot be replaced by different platform digests')
    }
    writeJson(join(outdir, 'slothvault-image-manifest.json'), manifest)
    return manifest
  }

  async promote(identity, outdir) {
    const release = this.release(identity.tag)
    this.verifyReleaseTarget(release, identity)
    if (release.draft) throw new Error('Cannot promote an unpublished release')
    this.git(['fetch', 'origin', this.defaultBranch, '--tags'])
    const newer = this.releases().filter(item => !item.draft && !item.prerelease && releaseVersion('application', item.tag_name))
      .filter(item => compareVersions(releaseVersion('application', item.tag_name), identity.version) > 0)
      .some(item => {
        const sha = this.tagCommit(item.tag_name)
        if (!sha) throw new Error(`Published release ${item.tag_name} is missing its tag`)
        this.assertDefaultAncestor(sha)
        return true
      })
    if (newer) return 'skipped-newer-release'
    const manifest = jsonFile(join(outdir, 'slothvault-image-manifest.json'))
    const actual = await this.inspectImage(identity)
    if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('Version image changed since publication')
    this.checkAssets(release, [join(outdir, 'slothvault-image-manifest.json')])
    const previous = this.dockerInspect(`${this.image}:latest`, undefined, { missing: true })
    if (previous?.digest !== manifest.digest) {
      this.run('docker', ['buildx', 'imagetools', 'create', '--tag', `${this.image}:latest`, `${this.image}@${manifest.digest}`])
      if (this.dockerInspect(`${this.image}:latest`).digest !== manifest.digest) throw new Error('Docker latest digest does not match the release')
    }
    if (this.api('releases/latest', { missing: true })?.tag_name !== identity.tag) this.run('gh', ['release', 'edit', identity.tag, '--repo', this.repository, '--latest'])
    return 'latest'
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string', default: '.' }, module: { type: 'string', default: 'application' }, outdir: { type: 'string', default: '../dist/application' },
    platform: { type: 'string' }, digest: { type: 'string' }, digests: { type: 'string' },
  } })
  const delivery = new ReleaseDelivery({ root: values.root })
  const outdir = resolve(delivery.root, values.outdir)
  mkdirSync(outdir, { recursive: true })
  const emit = result => {
    if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(result)) {
      if (/[\r\n]/.test(String(value))) throw new Error('Multiline values are not allowed in release outputs')
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  if (positionals[0] === 'prepare') {
    const identity = await delivery.prepare(values.module, { publish: process.env.PUBLISH_REQUEST === 'true', sourceRef: process.env.SOURCE_REF ?? '' })
    writeJson(join(outdir, 'identity.json'), identity)
    emit(identity)
    return
  }
  const identity = jsonFile(join(outdir, 'identity.json'))
  if (delivery.git(['rev-parse', 'HEAD']) !== identity.sha) throw new Error('Checkout does not match saved release identity')
  switch (positionals[0]) {
    case 'image-state': {
      const manifest = await delivery.inspectImage(identity, { missing: true })
      emit({ reuse: !!manifest, amd64_digest: manifest?.platforms['linux/amd64'].digest ?? '', arm64_digest: manifest?.platforms['linux/arm64'].digest ?? '' })
      break
    }
    case 'record-platform': {
      if (!supportedPlatforms.includes(values.platform) || !digestPattern.test(values.digest ?? '')) throw new Error('Invalid native platform result')
      writeJson(join(outdir, `platform-${values.platform.split('/')[1]}.json`), { platform: values.platform, digest: values.digest, sha: identity.sha, version: identity.version, tag: identity.tag })
      break
    }
    case 'merge-images':
      emit({ digest: (await delivery.mergeImages(identity, resolve(delivery.root, values.digests), outdir)).digest })
      break
    case 'publish': emit({ result: delivery.publish(identity, outdir) }); break
    case 'promote': emit({ result: await delivery.promote(identity, outdir) }); break
    case 'summary': {
      let manifest
      try { manifest = jsonFile(join(outdir, 'slothvault-image-manifest.json')) } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      let previous = {}
      try { previous = jsonFile(join(outdir, 'previous-sizes.json')) } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      let summary = `## SlothVault ${identity.version}\n\n- Source: \`${identity.sha}\`\n- Image: \`${delivery.image}:${identity.tag}\`\n`
      if (manifest) {
        summary += `- Index digest: \`${manifest.digest}\`\n\n| Platform | Compressed size | Change |\n| --- | ---: | ---: |\n`
        for (const [platform, metric] of Object.entries(manifest.platforms)) {
          const baseline = previous[platform]?.bytes
          const delta = baseline > 0 ? `${metric.bytes >= baseline ? '+' : ''}${formatMebibytes(metric.bytes - baseline)} MiB (${((metric.bytes - baseline) * 100 / baseline).toFixed(1)}%)` : 'First measurement'
          summary += `| ${platform} | ${formatMebibytes(metric.bytes)} MiB | ${delta} |\n`
        }
      } else summary += '- A complete image manifest was not produced. Check preceding job failures.\n'
      summary += '\n### Install\n\n```bash\nnpm install -g @holic512/slothtool\nslothtool install slothvault\nsudo env HOME="$HOME" "$(command -v slothtool)" slothvault deploy\n```\n'
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
      process.stdout.write(summary)
      break
    }
    default: throw new Error('Expected prepare, image-state, record-platform, merge-images, publish, promote or summary')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
