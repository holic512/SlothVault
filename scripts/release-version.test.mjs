import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  findMajorVersionBaseline,
  isApplicationChange,
  parseSemanticVersion,
  prepareSkillVersion,
  releaseTagForVersion,
  releaseVersionForCommitCount,
} from './release-version.mjs'

describe('release version resolution', () => {
  it('parses only complete non-negative semantic versions', () => {
    expect(parseSemanticVersion('2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(() => parseSemanticVersion('2.0')).toThrow('M.m.p')
    expect(() => parseSemanticVersion('02.0.0')).toThrow('M.m.p')
  })

  it('increments the patch through 20 and then rolls over the minor version', () => {
    expect(releaseVersionForCommitCount(2, 0)).toBe('2.0.0')
    expect(releaseVersionForCommitCount(2, 1)).toBe('2.0.1')
    expect(releaseVersionForCommitCount(2, 20)).toBe('2.0.20')
    expect(releaseVersionForCommitCount(2, 21)).toBe('2.1.0')
    expect(releaseVersionForCommitCount(2, 42)).toBe('2.2.0')
    expect(releaseVersionForCommitCount(2, 210_021)).toBe('2.10001.0')
  })

  it('uses only a plain semantic version in the release tag', () => {
    expect(releaseTagForVersion('2.2.13')).toBe('v2.2.13')
  })

  it('uses the commit that introduced the current major version as the reset point', () => {
    expect(findMajorVersionBaseline([
      { commit: 'v1', version: '1.0.0' },
      { commit: 'v1-dependency-update', version: '1.0.0' },
      { commit: 'v2', version: '2.0.0' },
      { commit: 'v2-dependency-update', version: '2.0.0' },
    ], 2)).toBe('v2')
  })

  it('does not count toolkit-only commits as application changes', () => {
    expect(isApplicationChange(['integrations/slothvault-runtime/lib/service.js'])).toBe(false)
    expect(isApplicationChange(['.github/workflows/release-toolkit.yml'])).toBe(false)
    expect(isApplicationChange(['integrations/slothvault-runtime/package.json', 'src/server/mcp/server.ts'])).toBe(true)
  })
})

describe('independent Skill version preparation', () => {
  const directories = []
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

  function fixture(version = '1.2.0') {
    const directory = mkdtempSync(join(tmpdir(), 'slothvault-skill-version-'))
    directories.push(directory)
    const root = pathToFileURL(`${directory}/`)
    const git = args => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().trim()
    const write = (path, content) => {
      const target = join(directory, 'integrations/skill', path)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content)
    }
    const read = path => readFileSync(join(directory, 'integrations/skill', path), 'utf8')
    write('module.json', JSON.stringify({ schema: 1, module: 'skill', version, bridgeApiMajor: 1 }) + '\n')
    write('slothvault-mcp/SKILL.md', `---\nname: slothvault-mcp\nmetadata:\n  version: "${version}"\n---\n\nUse uploaded files.\n`)
    write('slothvault-mcp/references/workflow.md', 'Upload before saving.\n')
    write('CHANGELOG.md', `# Skill changes\n\n## ${version}\n\n- Initial release.\n`)
    write('README.md', `当前版本 **${version}**，发布标签 skill-v${version}。\n`)
    git(['init', '-q'])
    git(['config', 'user.name', 'Version Test'])
    git(['config', 'user.email', 'version-test@example.invalid'])
    git(['add', '.'])
    git(['commit', '-qm', 'Initial release'])
    git(['tag', `skill-v${version}`])
    return { root, git, write, read }
  }

  it('advances changed instructions and synchronizes package metadata once', async () => {
    const f = fixture()
    f.write('slothvault-mcp/references/workflow.md', 'Upload images and ZIP attachments before saving.\n')
    await expect(prepareSkillVersion({ root: f.root, check: true })).rejects.toThrow('without advancing')
    expect(JSON.parse(f.read('module.json')).version).toBe('1.2.0')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.1')
    expect(f.read('slothvault-mcp/SKILL.md')).toContain('version: "1.2.1"')
    expect(f.read('CHANGELOG.md')).toContain('## 1.2.1')
    expect(f.read('README.md')).toContain('skill-v1.2.1')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.1')
    await expect(prepareSkillVersion({ root: f.root, check: true })).resolves.toMatchObject({ version: '1.2.1' })
  })

  it('does not advance for documentation, tests, or excluded cache files', async () => {
    const f = fixture()
    f.write('README.md', 'Changed installation explanation.\n')
    f.write('tests/new.test.py', 'test fixture\n')
    f.write('slothvault-mcp/.DS_Store', 'ignored\n')
    f.write('slothvault-mcp/__pycache__/check.pyc', 'ignored\n')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.0')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.0')
  })

  it('detects both untracked and staged package additions', async () => {
    for (const staged of [false, true]) {
      const f = fixture()
      f.write('slothvault-mcp/references/上传说明.md', 'New upload guidance.\n')
      if (staged) f.git(['add', '.'])
      expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.1')
    }
  })

  it('uses numeric release order and advances again after publishing', async () => {
    const f = fixture('1.2.10')
    f.git(['tag', 'skill-v1.2.9'])
    f.write('slothvault-mcp/references/workflow.md', 'Updated upload guidance.\n')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.11')
    f.git(['add', '.'])
    f.git(['commit', '-qm', 'Release updated guidance'])
    f.git(['tag', 'skill-v1.2.11'])
    f.write('slothvault-mcp/references/workflow.md', 'Another upload improvement.\n')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.12')
  })

  it('preserves an explicit higher version and fails a metadata mismatch without writing', async () => {
    const f = fixture()
    f.write('module.json', JSON.stringify({ schema: 1, module: 'skill', version: '1.3.0', bridgeApiMajor: 1 }) + '\n')
    await expect(prepareSkillVersion({ root: f.root, check: true })).rejects.toThrow('metadata version')
    expect(f.read('slothvault-mcp/SKILL.md')).toContain('version: "1.2.0"')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.3.0')
    await expect(prepareSkillVersion({ root: f.root, check: true })).resolves.toMatchObject({ version: '1.3.0' })
  })

  it('advances a subsequent content commit while the previous release is still pending', async () => {
    const f = fixture()
    f.write('slothvault-mcp/references/workflow.md', 'First improvement.\n')
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.1')
    f.git(['add', '.'])
    f.git(['commit', '-qm', 'First improvement, release pending'])
    f.write('slothvault-mcp/references/workflow.md', 'Second improvement.\n')
    await expect(prepareSkillVersion({ root: f.root, check: true })).rejects.toThrow('without advancing')
    f.git(['add', '.'])
    f.git(['commit', '-qm', 'Forgot version advancement'])
    await expect(prepareSkillVersion({ root: f.root, check: true })).rejects.toThrow('without advancing')
    // Preparation can also recover an already committed version omission without replaying content edits.
    expect((await prepareSkillVersion({ root: f.root })).version).toBe('1.2.2')
  })

  it('rejects a version lower than the latest release', async () => {
    const f = fixture()
    f.git(['tag', 'skill-v1.3.0'])
    await expect(prepareSkillVersion({ root: f.root })).rejects.toThrow('older than skill-v1.3.0')
    expect(JSON.parse(f.read('module.json')).version).toBe('1.2.0')
  })
})
