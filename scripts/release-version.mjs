/**
 * @file scripts/release-version.mjs
 * @project SlothVault
 * @module Release Version Resolution
 * @description Synchronizes and validates a deterministic package release version from the manually selected major component and first-parent Git history.
 * @logic Use the commit that introduced the current major as the epoch, map later first-parent commits to patch values 1 through 20 and then unbounded minor increments, write the next version before committing, validate the committed version in GitHub Actions, and append the workflow run number as an immutable build identity.
 * @dependencies Node.js node:child_process, node:fs/promises, Git
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
  runNumber = process.env.GITHUB_RUN_NUMBER,
} = {}) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const packageVersion = parseSemanticVersion(packageJson.version)
  if (!/^(0|[1-9]\d*)$/.test(String(runNumber))) {
    throw new Error('GITHUB_RUN_NUMBER must be a non-negative integer')
  }

  const baseline = findMajorVersionBaseline(packageVersionHistory(), packageVersion.major)
  const commitsSinceBaseline = integerVersionPart(
    git(['rev-list', '--first-parent', '--count', `${baseline}..${commit}`]),
    'Commit count',
  )
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
    tag: `v${version}-build.${runNumber}`,
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
    ? integerVersionPart(
      git(['rev-list', '--first-parent', '--count', `${baseline}..${commit}`]),
      'Commit count',
    ) + 1
    : 0
  const version = releaseVersionForCommitCount(packageVersion.major, commitsSinceBaseline)
  packageJson.version = version
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  return { baseline: baseline || null, commitsSinceBaseline, version }
}

async function main() {
  if (process.argv.includes('--prepare')) {
    const prepared = await preparePackageVersion()
    process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`)
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
