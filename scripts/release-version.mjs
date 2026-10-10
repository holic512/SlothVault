/**
 * @file scripts/release-version.mjs
 * @project SlothVault
 * @module Release Version Resolution
 * @description Synchronizes application and independent Skill versions before commits.
 * @logic Advance changed Skill packages against published tags, synchronize metadata and notes, then map application commits to the patch/minor cycle; Actions only validate committed versions.
 * @dependencies Node.js node:child_process, node:fs/promises, Git, Skill module metadata
 * @index_tags release,version,semver,github-actions,git-history,docker
 * @author holic512
 */
import { execFileSync } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const MAX_PATCH_VERSION = 20
const PATCH_CYCLE_SIZE = MAX_PATCH_VERSION + 1
const SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function integerVersionPart(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`${label} must be a safe integer`)
  return number
}

export function parseSemanticVersion(value) {
  if (typeof value !== 'string') throw new Error('Version must be a string')
  const match = SEMANTIC_VERSION_PATTERN.exec(value.trim())
  if (!match) throw new Error(`Version must use M.m.p format: ${value}`)
  const [, major, minor, patch] = match
  return {
    major: integerVersionPart(major, 'Major version'),
    minor: integerVersionPart(minor, 'Minor version'),
    patch: integerVersionPart(patch, 'Patch version'),
  }
}

export function releaseVersionForCommitCount(major, commitsSinceBaseline) {
  if (!Number.isSafeInteger(major) || major < 0) throw new Error('Major version must be a non-negative safe integer')
  if (!Number.isSafeInteger(commitsSinceBaseline) || commitsSinceBaseline < 0) {
    throw new Error('Commit count must be a non-negative safe integer')
  }
  const minor = Math.floor(commitsSinceBaseline / PATCH_CYCLE_SIZE)
  const patch = commitsSinceBaseline % PATCH_CYCLE_SIZE
  return `${major}.${minor}.${patch}`
}

export function releaseTagForVersion(version) {
  parseSemanticVersion(version)
  return `v${version}`
}

export function findMajorVersionBaseline(history, major) {
  let previousMajor = null
  let baseline = null

  for (const entry of history) {
    if (!entry || typeof entry.commit !== 'string') throw new Error('Invalid package version history entry')
    const version = parseSemanticVersion(entry.version)
    if (version.major === major && previousMajor !== major) baseline = entry.commit
    previousMajor = version.major
  }

  if (!baseline) throw new Error(`No package.json commit introduced major version ${major}`)
  return baseline
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function compareVersions(left, right) {
  const a = parseSemanticVersion(left)
  const b = parseSemanticVersion(right)
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

export function isSkillPackageFile(file) {
  if (!file.startsWith('integrations/skill/')) return false
  const relative = file.slice('integrations/skill/'.length)
  return !['README.md', 'CHANGELOG.md'].includes(relative)
    && !relative.split('/').some(part => ['tests', '__pycache__', '.venv', '.DS_Store'].includes(part))
    && !/\.py[co]$/.test(relative)
}

/** Repeat preparation against the same release without advancing an unpublished version again. */
export async function prepareSkillVersion({ root = new URL('../', import.meta.url), check = false } = {}) {
  const directory = new URL('integrations/skill/', root)
  const modulePath = new URL('module.json', directory)
  const entryPath = new URL('slothvault-mcp/SKILL.md', directory)
  const changelogPath = new URL('CHANGELOG.md', directory)
  const readmePath = new URL('README.md', directory)
  const metadata = JSON.parse(await readFile(modulePath, 'utf8'))
  const current = parseSemanticVersion(metadata.version)
  const runGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const tags = runGit(['tag', '--list', 'skill-v*']).split('\n')
    .filter(tag => /^skill-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    .sort((a, b) => compareVersions(a.slice(7), b.slice(7)))
  const latestTag = tags.at(-1)
  const releasedVersion = latestTag?.slice(7)
  if (releasedVersion && compareVersions(metadata.version, releasedVersion) < 0) {
    throw new Error(`Skill version ${metadata.version} is older than ${latestTag}`)
  }
  const untracked = runGit(['ls-files', '-z', '--others', '--exclude-standard', '--', 'integrations/skill']).split('\0')
  const changedSince = ref => [...new Set([
    ...runGit(['diff', '--name-only', '-z', ref, '--', 'integrations/skill']).split('\0'), ...untracked,
  ])].filter(isSkillPackageFile)
  const changedFiles = latestTag ? changedSince(latestTag) : untracked.filter(isSkillPackageFile)
  let needsIncrement = changedFiles.length > 0 && releasedVersion === metadata.version
  // A second content commit must advance even while its previous release is still running.
  const commits = runGit(['rev-list', '--first-parent', '--max-count=2', 'HEAD']).split('\n')
  for (const commit of commits) {
    if (!runGit(['ls-tree', '--name-only', commit, '--', 'integrations/skill/module.json'])) continue
    const committed = JSON.parse(runGit(['show', `${commit}:integrations/skill/module.json`])).version
    if (compareVersions(metadata.version, committed) < 0) throw new Error(`Skill version ${metadata.version} is older than committed version ${committed}`)
    if (committed === metadata.version && changedSince(commit).length) needsIncrement = true
  }
  let version = metadata.version
  if (needsIncrement) {
    if (check) throw new Error('Skill package changed without advancing its version; run npm run version:prepare')
    version = `${current.major}.${current.minor}.${current.patch + 1}`
    parseSemanticVersion(version)
  }
  const entry = await readFile(entryPath, 'utf8')
  const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const entryVersions = frontmatter ? [...frontmatter[1].matchAll(/^  version: ["']?(\d+\.\d+\.\d+)["']?[ \t]*\r?$/gm)] : []
  if (!frontmatter || entryVersions.length !== 1 || [...frontmatter[1].matchAll(/^  version:.*$/gm)].length !== 1) {
    throw new Error('Skill frontmatter must contain exactly one metadata version')
  }
  const synchronizedEntry = entryVersions[0][1] === version ? entry
    : entry.replace(frontmatter[0], frontmatter[0].replace(/^  version:.*$/m, `  version: "${version}"`))
  if (check && entryVersions[0][1] !== version) throw new Error('Skill metadata version does not match module.json')
  let changelog = await readFile(changelogPath, 'utf8')
  if (!new RegExp(`^## ${version.replaceAll('.', '\\.')}\\s*$`, 'm').test(changelog)) {
    if (check) throw new Error(`Skill CHANGELOG.md is missing the ${version} section`)
    if (!/^# [^\n]+\n/.test(changelog)) throw new Error('Skill CHANGELOG.md must start with a title')
    const paths = changedFiles.map(file => `\`${file.slice('integrations/skill/'.length)}\``).join(', ')
    changelog = changelog.replace(/^(# [^\n]+\n)/, `$1\n## ${version}\n\n- Updated packaged Skill files: ${paths || '`module.json`, `slothvault-mcp/SKILL.md`'}.\n`)
  }
  const readme = await readFile(readmePath, 'utf8')
  const synchronizedReadme = readme.replace(/当前版本 \*\*\d+\.\d+\.\d+\*\*/, `当前版本 **${version}**`)
    .replace(/skill-v\d+\.\d+\.\d+/g, `skill-v${version}`)
  if (!check) {
    if (metadata.version !== version) {
      metadata.version = version
      await writeFile(modulePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    }
    if (synchronizedEntry !== entry) await writeFile(entryPath, synchronizedEntry, 'utf8')
    await writeFile(changelogPath, changelog, 'utf8')
    if (synchronizedReadme !== readme) await writeFile(readmePath, synchronizedReadme, 'utf8')
  }
  return { version, releasedVersion: releasedVersion || null, changedFiles }
}

export function isApplicationChange(paths) {
  // Retired workflow names remain here only to classify historical commits identically.
  // This list is not a packaging or publishing entry point.
  const integrationWorkflow = /^\.github\/workflows\/release-(?:toolkit|vault-module|mcp-client|skill|deployment)\.yml$/
  return paths.some(file => file && !file.startsWith('integrations/') && !integrationWorkflow.test(file))
}

function applicationCommitCount(baseline, commit) {
  if (!baseline) return 0
  const commits = git(['rev-list', '--first-parent', '--reverse', `${baseline}..${commit}`]).split('\n').filter(Boolean)
  return commits.filter(sha => isApplicationChange(
    git(['diff', '--name-only', `${sha}^1`, sha]).split('\n').filter(Boolean),
  )).length
}

function pendingApplicationChange() {
  const tracked = git(['diff', 'HEAD', '--name-only']).split('\n').filter(Boolean)
  return isApplicationChange(tracked)
}

function packageVersionAtCommit(commit) {
  try {
    const packageJson = JSON.parse(git(['show', `${commit}:package.json`]))
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
}

function packageVersionHistory() {
  const commits = git(['log', '--first-parent', '--format=%H', '--reverse', '--', 'package.json'])
    .split('\n')
    .filter(Boolean)
  return commits.flatMap((commit) => {
    const version = packageVersionAtCommit(commit)
    return version ? [{ commit, version }] : []
  })
}

export async function resolveReleaseIdentity({
  packageJsonPath = new URL('../package.json', import.meta.url),
  commit = process.env.GITHUB_SHA || 'HEAD',
} = {}) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const packageVersion = parseSemanticVersion(packageJson.version)

  const baseline = findMajorVersionBaseline(packageVersionHistory(), packageVersion.major)
  const commitsSinceBaseline = applicationCommitCount(baseline, commit)
  const version = releaseVersionForCommitCount(packageVersion.major, commitsSinceBaseline)
  if (packageJson.version !== version) {
    throw new Error(
      `package.json version ${packageJson.version} does not match the required release version ${version}; run npm run version:prepare before committing`,
    )
  }

  return {
    baseline,
    commitsSinceBaseline,
    version,
    tag: releaseTagForVersion(version),
  }
}

export async function preparePackageVersion({
  packageJsonPath = new URL('../package.json', import.meta.url),
  commit = 'HEAD',
} = {}) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const packageVersion = parseSemanticVersion(packageJson.version)
  const history = packageVersionHistory()
  let baseline

  try {
    baseline = findMajorVersionBaseline(history, packageVersion.major)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('No package.json commit introduced major version')) {
      throw error
    }
  }

  const commitsSinceBaseline = baseline
    ? applicationCommitCount(baseline, commit) + (pendingApplicationChange() ? 1 : 0)
    : 0
  const version = releaseVersionForCommitCount(packageVersion.major, commitsSinceBaseline)
  packageJson.version = version
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  return { baseline: baseline || null, commitsSinceBaseline, version }
}

async function main() {
  if (process.argv.includes('--check-skill')) {
    process.stdout.write(`${JSON.stringify(await prepareSkillVersion({ check: true }), null, 2)}\n`)
    return
  }
  if (process.argv.includes('--prepare')) {
    const skill = await prepareSkillVersion()
    const prepared = await preparePackageVersion()
    process.stdout.write(`${JSON.stringify({ ...prepared, skill }, null, 2)}\n`)
    return
  }

  const outputIndex = process.argv.indexOf('--github-output')
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  const identity = await resolveReleaseIdentity()

  if (outputPath) {
    await appendFile(outputPath, `version=${identity.version}\ntag=${identity.tag}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
