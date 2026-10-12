import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ReleaseDelivery, releaseVersion, verifyAsset, verifyImageConfig } from './release-delivery.mjs'

const temporary = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'slothvault-delivery-'))
  temporary.push(directory)
  const root = join(directory, 'source')
  mkdirSync(root)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const write = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data) }
  git(['init', '-q', '-b', 'master'])
  git(['config', 'user.email', 'release-test@example.invalid'])
  git(['config', 'user.name', 'Release Test'])
  git(['config', 'commit.gpgsign', 'false'])
  execFileSync('git', ['init', '--bare', '-q', join(directory, 'origin')])
  git(['remote', 'add', 'origin', join(directory, 'origin')])
  write('package.json', JSON.stringify({ version: '1.0.0' }))
  write('package-lock.json', JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }))
  for (const moduleName of ['skill', 'deployment']) {
    write(`integrations/${moduleName}/module.json`, JSON.stringify({ schema: 1, module: moduleName, version: '1.0.0', bridgeApiMajor: 1 }))
    write(`integrations/${moduleName}/CHANGELOG.md`, '# Changes\n\n## 1.0.0\n\n- Initial release.\n')
    write(`integrations/${moduleName}/README.md`, 'Documentation\n')
  }
  write('integrations/skill/slothvault-mcp/SKILL.md', '---\nmetadata:\n  version: "1.0.0"\n---\nSkill\n')
  write('integrations/deployment/install.py', 'print("deployment")\n')
  write('app.js', 'initial\n')
  const commit = message => { git(['add', '.']); git(['commit', '-qm', message]); git(['push', '-q', 'origin', 'master', '--tags']); return git(['rev-parse', 'HEAD']) }
  const base = commit('Initial application and modules\n\n1. Keep the initial details.\n2. Preserve newlines.')
  const releases = new Map()
  const mutations = []
  const registry = new Map()
  const aliases = new Map()
  let latest
  let uploadsBeforeFailure = Infinity
  let hideDrafts = false, invisibleIdReads = 0, idReadFailure
  const waits = [], idReads = []
  const tag = (name, sha = git(['rev-parse', 'HEAD'])) => { git(['tag', name, sha]); git(['push', '-q', 'origin', name]) }
  const addRelease = (name, { draft = false, prerelease = false, assets = [], body = '', target = git(['rev-parse', 'HEAD']) } = {}) => {
    if (!draft && !git(['tag', '--list', name])) tag(name)
    const value = { id: releases.size + 1, tag_name: name, draft, prerelease, assets, body, target_commitish: target }
    releases.set(name, value)
    return value
  }
  const run = (binary, args, options) => {
    if (binary === 'git') return execFileSync(binary, args, { ...options, stdio: 'pipe' })
    if (binary === 'gh') {
      if (args[0] === 'api') {
        const flag = key => args[args.indexOf(key) + 1]
        if (args.includes('--method')) {
          mutations.push(args)
          if (args[1].endsWith('/git/refs')) {tag(flag('-f').slice('ref=refs/tags/'.length), args.at(-1).slice(4)); return '{}'}
          if (args[1] === 'repos/example/vault/releases' && flag('--method') === 'POST') {
            const request = JSON.parse(readFileSync(flag('--input'), 'utf8'))
            return JSON.stringify(addRelease(request.tag_name, {draft: request.draft, prerelease: request.prerelease,
              target: request.target_commitish, body: request.body}))
          }
          const upload = args[1].match(/releases\/(\d+)\/assets\?name=(.+)$/)
          const release = [...releases.values()].find(item => item.id === Number(upload?.[1] ?? args[1].split('/').at(-1)))
          if (upload) {
            if (uploadsBeforeFailure-- === 0) throw new Error('simulated upload interruption')
            const bytes = readFileSync(flag('--input'))
            release.assets.push({name: decodeURIComponent(upload[2]), size: bytes.length, digest: digest(bytes)})
          } else release.draft = false
          return JSON.stringify(release)
        }
        if (args.includes('--paginate')) return JSON.stringify([[...releases.values()].filter(item => !hideDrafts || !item.draft)])
        const endpoint = args[1].replace('repos/example/vault/', '')
        let result
        if (endpoint.startsWith('releases/tags/')) {
          result = releases.get(decodeURIComponent(endpoint.slice('releases/tags/'.length)))
          if (result?.draft) result = undefined
        }
        else if (/^releases\/\d+$/.test(endpoint)) {
          idReads.push(endpoint)
          if (idReadFailure) throw idReadFailure
          if (invisibleIdReads-- <= 0) result = [...releases.values()].find(item => item.id === Number(endpoint.split('/').at(-1)))
        }
        else if (endpoint === 'releases/latest') result = releases.get(latest)
        if (result) return JSON.stringify(result)
        throw Object.assign(new Error('Not found'), { status: 1, stderr: 'gh: Not Found (HTTP 404)' })
      }
      mutations.push(args)
      const name = args[2]
      const flag = key => args[args.indexOf(key) + 1]
      if (args[1] === 'create') {
        addRelease(name, { draft: true, target: flag('--target'), body: readFileSync(flag('--notes-file'), 'utf8') })
      } else if (args[1] === 'upload') {
        if (uploadsBeforeFailure-- === 0) throw new Error('simulated upload interruption')
        const bytes = readFileSync(args[3])
        releases.get(name).assets.push({ name: basename(args[3]), size: bytes.length, digest: digest(bytes) })
      } else if (args[1] === 'edit') {
        if (args.includes('--draft=false')) releases.get(name).draft = false
        if (args.includes('--latest')) latest = name
      } else throw new Error(`Unexpected gh mutation ${args}`)
      return ''
    }
    if (binary === 'docker') {
      if (args[2] === 'create') {
        mutations.push(args)
        const name = args[args.indexOf('--tag') + 1]
        const sources = args.slice(args.indexOf('--tag') + 2)
        if (sources.length === 1) aliases.set(name, sources[0].split('@')[1])
        else {
          const raw = { manifests: sources.map(source => {
            const imageDigest = source.split('@')[1]
            const config = registry.get(imageDigest).config
            return { digest: imageDigest, platform: { os: config.os, architecture: config.architecture } }
          }) }
          const indexDigest = digest(JSON.stringify(raw))
          registry.set(indexDigest, { raw })
          aliases.set(name, indexDigest)
        }
        return ''
      }
      const reference = args[3]
      const imageDigest = reference.includes('@') ? reference.split('@')[1] : aliases.get(reference)
      const object = registry.get(imageDigest)
      if (!object) throw Object.assign(new Error('manifest unknown'), { stderr: 'manifest unknown' })
      if (args.includes('--raw')) return JSON.stringify(object.raw)
      return JSON.stringify(args.at(-1) === '{{json .Image}}' ? object.config : { ...object.raw, digest: imageDigest })
    }
    throw new Error(`Unexpected process ${binary}`)
  }
  const delivery = new ReleaseDelivery({ root, repository: 'example/vault', defaultBranch: 'master', image: 'docker.io/example/vault', run,
    wait: milliseconds => waits.push(milliseconds) })
  const identity = module => ({ module, sha: git(['rev-parse', 'HEAD']), version: '1.0.1', tag: module === 'application' ? 'v1.0.1' : `${module}-v1.0.1`, publish: true })
  const outdir = join(directory, 'out')
  mkdirSync(outdir)
  const assets = id => {
    if (id.module === 'application') return [join(outdir, 'slothvault-image-manifest.json')]
    const paths = [join(outdir, `slothvault-${id.module}-${id.version}.tgz`), join(outdir, `slothvault-${id.module}-manifest.json`)]
    for (const path of paths) writeFileSync(path, `verified-${basename(path)}`)
    return paths
  }
  const native = (id, architecture) => {
    const config = { os: 'linux', architecture, config: { Labels: {
      'org.opencontainers.image.revision': id.sha, 'org.opencontainers.image.version': id.tag,
    }, Env: [`SLOTHVAULT_APP_VERSION=${id.version}`, `SLOTHVAULT_RELEASE_TAG=${id.tag}`, `SLOTHVAULT_RELEASE_COMMIT_SHA=${id.sha}`] } }
    const raw = { config: { digest: digest(JSON.stringify(config)) }, layers: [{ size: architecture === 'amd64' ? 10 : 20 }] }
    const imageDigest = digest(JSON.stringify(raw))
    registry.set(imageDigest, { raw, config })
    return imageDigest
  }
  return { root, git, write, commit, base, tag, releases, addRelease, mutations, delivery, identity, outdir, assets, native, aliases, registry,
    interruptAfterUploads: count => { uploadsBeforeFailure = count }, setLatest: name => { latest = name }, waits, idReads,
    hideDrafts: () => {hideDrafts = true}, hideIdReads: count => {invisibleIdReads = count}, failIdReads: error => {idReadFailure = error} }
}

describe('commit-derived independent release notes', () => {
  it('keeps complete multiline messages and ignores unrelated, draft and orphan tags', () => {
    const f = fixture()
    f.tag('v1.0.0', f.base)
    f.addRelease('v1.0.0')
    f.write('app.js', 'first application change\n')
    const first = f.commit('[feat] Application\n\n1. Exact text.\n2. **Keep Markdown**.\n\nA separate paragraph.')
    f.tag('v1.0.1', first) // Orphan tags are not release baselines.
    f.write('integrations/skill/slothvault-mcp/SKILL.md', 'skill-only')
    f.commit('Skill only\n\nMust not appear in application notes.')
    f.addRelease('skill-v1.0.1') // A different family must not truncate application notes.
    f.write('app.js', 'second application change\n')
    f.commit('Second application change\n\nUnreleased detail.')
    f.addRelease('v1.0.2', { draft: true })
    f.write('app.js', 'mixed\n')
    f.write('integrations/deployment/install.py', 'mixed\n')
    f.commit('Mixed change\n\n1. Application detail.\n2. Deployment detail.')
    const notes = f.delivery.notes({ ...f.identity('application'), tag: 'v1.0.3' })
    expect(notes).toContain('[feat] Application\n\n1. Exact text.\n2. **Keep Markdown**.\n\nA separate paragraph.\n')
    expect(notes).toContain('Unreleased detail.')
    expect(notes).toContain('Mixed change\n\n1. Application detail.\n2. Deployment detail.')
    expect(notes).not.toContain('Skill only')
    expect(notes.indexOf('[feat] Application')).toBeLessThan(notes.indexOf('Second application change'))
    expect(notes).not.toContain('Initial application')
  })

  it('uses relevant initial history and keeps the full message for both sides of a mixed commit', () => {
    const f = fixture()
    f.write('integrations/skill/new.txt', 'skill')
    f.write('integrations/deployment/install.py', 'deployment')
    f.commit('Mixed module delivery\n\nSkill and deployment details stay together.')
    for (const moduleName of ['skill', 'deployment']) {
      const notes = f.delivery.notes(f.identity(moduleName))
      expect(notes).toContain('Initial application and modules\n\n1. Keep the initial details.\n2. Preserve newlines.')
      expect(notes).toContain('Mixed module delivery\n\nSkill and deployment details stay together.')
    }
    expect(releaseVersion('application', 'deployment-v1.0.0')).toBeNull()
    expect(releaseVersion('application', 'v2.2.13-build.81')).toBe('2.2.13')
  })
})

describe('pinned targets and release recovery', () => {
  it('reuses the tagged module source for documentation-only pushes and rejects changed same-version payloads', async () => {
    const f = fixture()
    f.addRelease('deployment-v1.0.0')
    f.write('integrations/deployment/README.md', 'documentation-only\n')
    f.commit('Documentation')
    const id = await f.delivery.prepare('deployment', { publish: true })
    expect(id.sha).toBe(f.base)
    expect(id.state).toBe('published')
    f.write('integrations/deployment/install.py', 'changed content\n')
    f.commit('Change without version')
    await expect(f.delivery.prepare('deployment', { publish: true })).rejects.toThrow('Content conflicts')
  })

  it('rejects targets outside the default branch and branch names as retry inputs', async () => {
    const f = fixture()
    await expect(f.delivery.prepare('deployment', { sourceRef: 'master' })).rejects.toThrow('full commit SHA')
    f.git(['checkout', '-qb', 'feature'])
    f.write('new-feature.txt', 'not merged')
    f.git(['add', '.'])
    f.git(['commit', '-qm', 'Unmerged'])
    await expect(f.delivery.prepare('deployment', { publish: true })).rejects.toThrow()
    expect(f.mutations).toEqual([])
  })

  it('rejects reverting to a published older module while allowing its explicit historical retry', async () => {
    const f = fixture()
    f.addRelease('deployment-v1.0.0')
    f.write('integrations/deployment/module.json', JSON.stringify({ schema: 1, module: 'deployment', version: '1.1.0', bridgeApiMajor: 1 }))
    f.write('integrations/deployment/install.py', 'new deployment\n')
    f.write('integrations/deployment/CHANGELOG.md', '# Changes\n\n## 1.1.0\n\n- New deployment.\n')
    f.commit('Release newer deployment')
    f.addRelease('deployment-v1.1.0')
    f.git(['restore', '--source', f.base, '--', 'integrations/deployment'])
    f.commit('Attempt to revert module version')
    await expect(f.delivery.prepare('deployment', { publish: true })).rejects.toThrow('older than deployment-v1.1.0')
    f.git(['checkout', '--detach', f.base])
    await expect(f.delivery.prepare('deployment', { publish: true, sourceRef: 'deployment-v1.0.0' })).resolves.toMatchObject({ sha: f.base, state: 'published' })
    expect(f.mutations).toEqual([])
  })

  it('recovers only missing assets after an interrupted upload, then verifies repeat runs without writes', () => {
    const f = fixture()
    const id = f.identity('deployment')
    f.assets(id)
    f.interruptAfterUploads(1)
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('upload interruption')
    expect(f.releases.get(id.tag).draft).toBe(true)
    expect(f.releases.get(id.tag).assets).toHaveLength(1)
    expect(f.delivery.tagCommit(id.tag)).toBeNull()
    f.interruptAfterUploads(Infinity)
    expect(f.delivery.publish(id, f.outdir)).toBe('published')
    expect(f.releases.get(id.tag).assets).toHaveLength(2)
    const before = f.mutations.length
    expect(f.delivery.publish(id, f.outdir)).toBe('verified-existing')
    expect(f.mutations).toHaveLength(before)
    expect(f.mutations.filter(args => args[1] === 'repos/example/vault/releases' && args.includes('POST'))).toHaveLength(1)
    expect(f.mutations.filter(args => args[1] === 'edit').every(args => args.includes('--latest=false'))).toBe(true)
    expect(f.releases.get(id.tag).body).not.toContain('Build result')
  })

  it.each(['application', 'skill', 'deployment'])('publishes %s through its returned ID while draft tag and list reads are stale', module => {
    const f = fixture(), id = f.identity(module)
    f.assets(id)
    if (module === 'application') writeFileSync(join(f.outdir, 'slothvault-image-manifest.json'), '{}')
    f.hideDrafts()
    f.hideIdReads(2)
    expect(f.delivery.publish(id, f.outdir)).toBe('published')
    expect(f.releases.get(id.tag).draft).toBe(false)
    expect(f.waits).toEqual([250, 500])
    expect(f.idReads).toHaveLength(3)
    const creates = f.mutations.filter(args => args[1] === 'repos/example/vault/releases' && args.includes('POST'))
    expect(creates).toHaveLength(1)
    const request = JSON.parse(readFileSync(creates[0][creates[0].indexOf('--input') + 1], 'utf8'))
    expect(request).toMatchObject({tag_name: id.tag, target_commitish: id.sha, draft: true, prerelease: false, make_latest: 'false'})
    expect(request.body).toContain('1. Keep the initial details.\n2. Preserve newlines.')
  })

  it('bounds missing ID retries, keeps the draft, and distinguishes visibility from target conflicts', () => {
    const f = fixture(), id = f.identity('deployment')
    f.assets(id)
    f.hideIdReads(Infinity)
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('not visible by ID after bounded retries')
    expect(f.waits).toEqual([250, 500])
    expect(f.releases.get(id.tag).draft).toBe(true)
    expect(f.delivery.tagCommit(id.tag)).toBeNull()
    expect(() => f.delivery.verifyReleaseTarget(null, id)).toThrow('not visible')
  })

  it('does not retry permission failures from the Release ID endpoint', () => {
    const f = fixture(), id = f.identity('deployment')
    f.assets(id)
    f.failIdReads(Object.assign(new Error('Unauthorized'), {stderr: 'gh: Unauthorized (HTTP 403)'}))
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('Unauthorized')
    expect(f.waits).toEqual([])
    expect(f.idReads).toHaveLength(1)
    expect(f.releases.get(id.tag).draft).toBe(true)
  })

  it('rejects conflicting creation responses before uploading assets or creating a tag', () => {
    const f = fixture(), id = f.identity('deployment')
    f.assets(id)
    const run = f.delivery.run
    f.delivery.run = (binary, args, options) => {
      const output = run(binary, args, options)
      if (binary === 'gh' && args[1] === 'repos/example/vault/releases' && args.includes('POST')) {
        return JSON.stringify({...JSON.parse(output), target_commitish: 'a'.repeat(40)})
      }
      return output
    }
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('target conflicts')
    expect(f.releases.get(id.tag).assets).toEqual([])
    expect(f.delivery.tagCommit(id.tag)).toBeNull()
    expect(f.mutations).toHaveLength(1)
  })

  it('never overwrites published notes, tags or mismatched assets', () => {
    const f = fixture()
    const id = f.identity('skill')
    const paths = f.assets(id)
    f.tag(id.tag)
    const release = f.addRelease(id.tag, { body: 'Original published document', assets: paths.map(path => {
      const bytes = readFileSync(path)
      return { name: basename(path), size: bytes.length, digest: digest(bytes) }
    }) })
    expect(f.delivery.publish(id, f.outdir)).toBe('verified-existing')
    expect(release.body).toBe('Original published document')
    writeFileSync(paths[0], 'different bytes')
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('asset conflicts')
    expect(f.mutations).toEqual([])
    expect(() => f.delivery.publish({ ...id, sha: 'a'.repeat(40) }, f.outdir)).toThrow()
    expect(f.git(['rev-parse', id.tag])).toBe(f.base)
  })

  it('does not treat API permission failures as a missing release', () => {
    const delivery = new ReleaseDelivery({ repository: 'example/vault', run: () => {
      throw Object.assign(new Error('Unauthorized'), { stderr: 'gh: Unauthorized (HTTP 403)' })
    } })
    expect(() => delivery.release('v1.0.0')).toThrow('Unauthorized')
    expect(() => verifyAsset({ name: 'archive', size: 3, digest: digest('bad') }, Buffer.from('new'))).toThrow('conflicts')
    expect(() => verifyAsset({ name: 'archive', size: 3 }, Buffer.from('new'), Buffer.from('new'))).not.toThrow()
  })

  it('does not rewrite an existing draft with conflicting commit notes', () => {
    const f = fixture()
    const id = f.identity('deployment')
    f.assets(id)
    f.addRelease(id.tag, { draft: true, body: 'Notes from a different source' })
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('Draft notes conflict')
    expect(f.mutations).toEqual([])
    expect(f.releases.get(id.tag).draft).toBe(true)
  })

  it('finds a tag-invisible draft without a Git tag and validates its full target before writes', () => {
    const f = fixture(), id = f.identity('application')
    writeFileSync(join(f.outdir, 'slothvault-image-manifest.json'), '{}')
    const draft = f.addRelease(id.tag, {draft: true, body: f.delivery.notes(id)})
    expect(f.delivery.release(id.tag)).toEqual(draft)
    expect(f.delivery.tagCommit(id.tag)).toBeNull()
    draft.target_commitish = 'master'
    expect(() => f.delivery.publish(id, f.outdir)).toThrow('target conflicts')
    expect(f.mutations).toEqual([])
    draft.target_commitish = id.sha
    expect(f.delivery.publish(id, f.outdir)).toBe('published')
    expect(f.delivery.tagCommit(id.tag)).toBe(id.sha)
    expect(f.mutations.filter(args => args[1]?.endsWith('/git/refs'))).toHaveLength(1)
  })
})

describe('native image merge and latest promotion', () => {
  function imageFixture() {
    const f = fixture()
    const id = f.identity('application')
    const records = ['amd64', 'arm64'].map(arch => ({ platform: `linux/${arch}`, digest: f.native(id, arch), sha: id.sha, version: id.version, tag: id.tag }))
    const directory = join(f.outdir, 'digests')
    mkdirSync(directory)
    for (const record of records) writeFileSync(join(directory, `platform-${record.platform.split('/')[1]}.json`), JSON.stringify(record))
    return { ...f, id, records, directory }
  }

  it('merges only matching complete native results and reuses immutable versions', async () => {
    const f = imageFixture()
    const manifest = await f.delivery.mergeImages(f.id, f.directory, f.outdir)
    expect(Object.keys(manifest.platforms)).toEqual(['linux/amd64', 'linux/arm64'])
    expect(manifest.platforms['linux/arm64'].bytes).toBe(20)
    const before = f.mutations.length
    expect(await f.delivery.mergeImages(f.id, f.directory, f.outdir)).toEqual(manifest)
    expect(f.mutations).toHaveLength(before)
    writeFileSync(join(f.directory, 'platform-arm64.json'), JSON.stringify({ ...f.records[1], sha: 'b'.repeat(40) }))
    await expect(f.delivery.mergeImages(f.id, f.directory, f.outdir)).rejects.toThrow('identity')
    expect(f.mutations).toHaveLength(before)
    const nativeImage = f.registry.get(f.records[1].digest)
    const raw = { ...nativeImage.raw, layers: [{ size: 999 }] }
    const differentDigest = digest(JSON.stringify(raw))
    f.registry.set(differentDigest, { raw, config: nativeImage.config })
    writeFileSync(join(f.directory, 'platform-arm64.json'), JSON.stringify({ ...f.records[1], digest: differentDigest }))
    await expect(f.delivery.mergeImages(f.id, f.directory, f.outdir)).rejects.toThrow('cannot be replaced')
    expect(f.mutations).toHaveLength(before)
  })

  it('cannot publish a one-platform version or accept incorrect embedded identity', async () => {
    const f = imageFixture()
    rmSync(join(f.directory, 'platform-arm64.json'))
    await expect(f.delivery.mergeImages(f.id, f.directory, f.outdir)).rejects.toThrow('Exactly two')
    expect(f.mutations).toEqual([])
    const config = f.registry.get(f.records[0].digest).config
    expect(() => verifyImageConfig(config, f.id, 'linux/arm64')).toThrow('architecture')
    expect(() => verifyImageConfig(config, { ...f.id, sha: '0'.repeat(40) }, 'linux/amd64')).toThrow('identity conflicts')
    config.config.Env = []
    expect(() => verifyImageConfig(config, f.id, 'linux/amd64')).toThrow('SLOTHVAULT_APP_VERSION')
  })

  it('promotes a completed application once and does not downgrade latest on an old retry', async () => {
    const f = imageFixture()
    await f.delivery.mergeImages(f.id, f.directory, f.outdir)
    f.delivery.publish(f.id, f.outdir)
    expect(await f.delivery.promote(f.id, f.outdir)).toBe('latest')
    expect(f.aliases.get('docker.io/example/vault:latest')).toBe(f.aliases.get(`docker.io/example/vault:${f.id.tag}`))
    const before = f.mutations.length
    expect(await f.delivery.promote(f.id, f.outdir)).toBe('latest')
    expect(f.mutations).toHaveLength(before)
    f.write('app.js', 'newer app')
    f.commit('Newer valid release')
    f.addRelease('v1.0.2')
    f.setLatest('v1.0.2')
    expect(await f.delivery.promote(f.id, f.outdir)).toBe('skipped-newer-release')
    expect(f.mutations).toHaveLength(before)
  })

  it('does not promote a draft or mismatched registry content', async () => {
    const f = imageFixture()
    await f.delivery.mergeImages(f.id, f.directory, f.outdir)
    f.addRelease(f.id.tag, { draft: true })
    await expect(f.delivery.promote(f.id, f.outdir)).rejects.toThrow('unpublished')
    f.releases.get(f.id.tag).draft = false
    f.tag(f.id.tag)
    f.registry.get(f.records[1].digest).config.config.Env = []
    await expect(f.delivery.promote(f.id, f.outdir)).rejects.toThrow('SLOTHVAULT_APP_VERSION')
  })
})
