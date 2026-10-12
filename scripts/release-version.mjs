/**
 * @file scripts/release-version.mjs
 * @project SlothVault
 * @module Release Version Resolution
 * @description Synchronizes application and independent integration versions before commits.
 * @logic Advance changed integration packages against tags and committed versions, synchronize metadata and CHANGELOG, then map application commits to the patch/minor cycle; Actions only validate committed versions.
 * @dependencies Node.js node:child_process, node:fs/promises, Git, integration module metadata
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

function git(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

export function compareVersions(left, right) {
  const a = parseSemanticVersion(left)
  const b = parseSemanticVersion(right)
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

export function isModulePackageFile(module, file) {
  if (!['skill', 'deployment'].includes(module)) throw new Error(`Unknown module: ${module}`)
  const prefix = `integrations/${module}/`
  if (!file.startsWith(prefix)) return false
  const relative = file.slice(prefix.length)
  return !['README.md', 'CHANGELOG.md'].includes(relative)
    && !relative.split('/').some(part => ['tests', '__pycache__', '.venv', '.DS_Store'].includes(part))
    && !/\.py[co]$/.test(relative)
}

export const isSkillPackageFile = file => isModulePackageFile('skill', file)

export const prepareSkillVersion = options => prepareModuleVersion('skill', options)

/** Repeat preparation against the same release without advancing an unpublished version again. */
export async function prepareModuleVersion(module, { root = new URL('../', import.meta.url), check = false, ancestorOnly = false } = {}) {
  if (!['skill', 'deployment'].includes(module)) throw new Error(`Unknown module: ${module}`)
  const label = module === 'skill' ? 'Skill' : 'Deployment'
  const directory = new URL(`integrations/${module}/`, root)
  const modulePath = new URL('module.json', directory)
  const entryPath = new URL('slothvault-mcp/SKILL.md', directory)
  const changelogPath = new URL('CHANGELOG.md', directory)
  const readmePath = new URL('README.md', directory)
  const metadata = JSON.parse(await readFile(modulePath, 'utf8'))
  const current = parseSemanticVersion(metadata.version)
  const runGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const tags = runGit(['tag', '--list', `${module}-v*`]).split('\n')
    .filter(tag => new RegExp(`^${module}-v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$`).test(tag))
    .filter(tag => !ancestorOnly || (() => {
      try { runGit(['merge-base', '--is-ancestor', tag, 'HEAD']); return true } catch (error) {
        if (error.status === 1) return false
        throw error
      }
    })())
    .sort((a, b) => compareVersions(a.slice(module.length + 2), b.slice(module.length + 2)))
  const latestTag = tags.at(-1)
  const releasedVersion = latestTag?.slice(module.length + 2)
  if (releasedVersion && compareVersions(metadata.version, releasedVersion) < 0) {
    throw new Error(`${label} version ${metadata.version} is older than ${latestTag}`)
  }
  const untracked = runGit(['ls-files', '-z', '--others', '--exclude-standard', '--', `integrations/${module}`]).split('\0')
  const changedSince = ref => [...new Set([
    ...runGit(['diff', '--name-only', '-z', ref, '--', `integrations/${module}`]).split('\0'), ...untracked,
  ])].filter(file => isModulePackageFile(module, file))
  const changedFiles = latestTag ? changedSince(latestTag) : untracked.filter(file => isModulePackageFile(module, file))
  let needsIncrement = changedFiles.length > 0 && releasedVersion === metadata.version
  // A second content commit must advance even while its previous release is still running.
  const commits = runGit(['rev-list', '--first-parent', '--max-count=2', 'HEAD']).split('\n')
  for (const commit of commits) {
    if (!runGit(['ls-tree', '--name-only', commit, '--', `integrations/${module}/module.json`])) continue
    const committed = JSON.parse(runGit(['show', `${commit}:integrations/${module}/module.json`])).version
    if (compareVersions(metadata.version, committed) < 0) throw new Error(`${label} version ${metadata.version} is older than committed version ${committed}`)
    if (committed === metadata.version && changedSince(commit).length) needsIncrement = true
  }
  let version = metadata.version
  if (needsIncrement) {
    if (check) throw new Error(`${label} package changed without advancing its version; run npm run version:prepare`)
    version = `${current.major}.${current.minor}.${current.patch + 1}`
    parseSemanticVersion(version)
  }
  const entry = module === 'skill' ? await readFile(entryPath, 'utf8') : ''
  const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const entryVersions = frontmatter ? [...frontmatter[1].matchAll(/^  version: ["']?(\d+\.\d+\.\d+)["']?[ \t]*\r?$/gm)] : []
  if (module === 'skill' && (!frontmatter || entryVersions.length !== 1 || [...frontmatter[1].matchAll(/^  version:.*$/gm)].length !== 1)) {
    throw new Error('Skill frontmatter must contain exactly one metadata version')
  }
  const synchronizedEntry = module !== 'skill' || entryVersions[0][1] === version ? entry
    : entry.replace(frontmatter[0], frontmatter[0].replace(/^  version:.*$/m, `  version: "${version}"`))
  if (module === 'skill' && check && entryVersions[0][1] !== version) throw new Error('Skill metadata version does not match module.json')
  let changelog = await readFile(changelogPath, 'utf8')
  if (!new RegExp(`^## ${version.replaceAll('.', '\\.')}\\s*$`, 'm').test(changelog)) {
    if (check) throw new Error(`${label} CHANGELOG.md is missing the ${version} section`)
    if (!/^# [^\n]+\n/.test(changelog)) throw new Error(`${label} CHANGELOG.md must start with a title`)
    const paths = changedFiles.map(file => `\`${file.slice(`integrations/${module}/`.length)}\``).join(', ')
    changelog = changelog.replace(/^(# [^\n]+\n)/, `$1\n## ${version}\n\n- Updated packaged ${label} files: ${paths || '`module.json`'}.\n`)
  }
  const readme = await readFile(readmePath, 'utf8')
  const synchronizedReadme = readme.replace(/当前版本 \*\*\d+\.\d+\.\d+\*\*/, `当前版本 **${version}**`)
    .replace(new RegExp(`${module}-v\\d+\\.\\d+\\.\\d+`, 'g'), `${module}-v${version}`)
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

function applicationCommitCount(baseline, commit, root) {
  if (!baseline) return 0
  const commits = git(['rev-list', '--first-parent', '--reverse', `${baseline}..${commit}`], root).split('\n').filter(Boolean)
  return commits.filter(sha => isApplicationChange(
    git(['diff', '--name-only', `${sha}^1`, sha], root).split('\n').filter(Boolean),
  )).length
}

function pendingApplicationChange(root) {
  const tracked = git(['diff', 'HEAD', '--name-only'], root).split('\n').filter(Boolean)
  return isApplicationChange(tracked)
}

function packageVersionAtCommit(commit, root) {
  try {
    const packageJson = JSON.parse(git(['show', `${commit}:package.json`], root))
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
}

function packageVersionHistory(root, commit = 'HEAD') {
  const commits = git(['log', '--first-parent', '--format=%H', '--reverse', commit, '--', 'package.json'], root)
    .split('\n')
    .filter(Boolean)
  return commits.flatMap((commit) => {
    const version = packageVersionAtCommit(commit, root)
    return version ? [{ commit, version }] : []
  })
}

export async function resolveReleaseIdentity({
  packageJsonPath = new URL('../package.json', import.meta.url),
  commit = process.env.GITHUB_SHA || 'HEAD',
  root,
} = {}) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const packageVersion = parseSemanticVersion(packageJson.version)

  const baseline = findMajorVersionBaseline(packageVersionHistory(root, commit), packageVersion.major)
  const commitsSinceBaseline = applicationCommitCount(baseline, commit, root)
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
  packageLockPath = new URL('./package-lock.json', packageJsonPath),
  commit = 'HEAD',
  root,
} = {}) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const packageVersion = parseSemanticVersion(packageJson.version)
  const history = packageVersionHistory(root, commit)
  let baseline

  try {
    baseline = findMajorVersionBaseline(history, packageVersion.major)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('No package.json commit introduced major version')) {
      throw error
    }
  }

  const commitsSinceBaseline = baseline
    ? applicationCommitCount(baseline, commit, root) + (pendingApplicationChange(root) ? 1 : 0)
    : 0
  const version = releaseVersionForCommitCount(packageVersion.major, commitsSinceBaseline)
  packageJson.version = version
  const lock = JSON.parse(await readFile(packageLockPath, 'utf8'))
  lock.version = version
  if (!lock.packages?.['']) throw new Error('package-lock.json is missing its root package')
  lock.packages[''].version = version
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  await writeFile(packageLockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')

  return { baseline: baseline || null, commitsSinceBaseline, version }
}

async function main() {
  if (process.argv.includes('--check-deployment')) {
    process.stdout.write(`${JSON.stringify(await prepareModuleVersion('deployment', { check: true }), null, 2)}\n`)
    return
  }
  if (process.argv.includes('--check-skill')) {
    process.stdout.write(`${JSON.stringify(await prepareSkillVersion({ check: true }), null, 2)}\n`)
    return
  }
  if (process.argv.includes('--prepare')) {
    const skill = await prepareSkillVersion()
    const deployment = await prepareModuleVersion('deployment')
    const prepared = await preparePackageVersion()
    process.stdout.write(`${JSON.stringify({ ...prepared, skill, deployment }, null, 2)}\n`)
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
