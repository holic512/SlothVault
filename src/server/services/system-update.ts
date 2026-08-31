/**
 * @file system-update.ts
 * @project SlothVault
 * @module System Release Update Service
 * @description Resolves the running application's release identity and compares it with published SlothVault GitHub Releases.
 * @logic Parse release tags deterministically, fetch and cache only successful public release listings, retain the ordered upgrade path when known, and convert remote failures into a stable display state.
 * @dependencies Node.js fetch, package.json runtime metadata, GitHub Releases REST API
 * @index_tags system-update,release,github,version,cache,admin
 * @author holic512
 */
import 'server-only'

import packageJson from '../../../package.json'

const OFFICIAL_REPOSITORY = 'holic512/SlothVault'
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-build\.(0|[1-9]\d*))?$/
const RELEASES_PER_PAGE = 100
const MAX_RELEASE_PAGES = 10
const CACHE_TTL_MS = 15 * 60 * 1000

export type ReleaseVersion = {
  major: number
  minor: number
  patch: number
  build: number | null
  tag: string
}

export type SystemUpdateStatus =
  | 'UP_TO_DATE'
  | 'UPDATE_AVAILABLE'
  | 'LOCAL_NEWER'
  | 'UNVERSIONED'
  | 'HISTORY_INCOMPLETE'
  | 'CHECK_FAILED'

export type SystemRelease = {
  tag: string
  title: string
  commitSha: string | null
  publishedAt: string | null
  htmlUrl: string
  notes: string
}

export type SystemUpdateInfo = {
  checkedAt: string
  status: SystemUpdateStatus
  repository: string
  installed: {
    packageVersion: string
    tag: string | null
    commitSha: string | null
  }
  latest: SystemRelease | null
  missingReleases: SystemRelease[]
  historyComplete: boolean
  error: 'RELEASE_SOURCE_NOT_FOUND' | 'RELEASE_RATE_LIMITED' | 'RELEASE_REQUEST_TIMEOUT' | 'RELEASE_CHECK_FAILED' | null
}

type GitHubReleasePayload = {
  tag_name?: unknown
  name?: unknown
  target_commitish?: unknown
  published_at?: unknown
  html_url?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}

type CachedReleaseList = {
  repository: string
  expiresAt: number
  releases: SystemRelease[]
}

let cachedReleaseList: CachedReleaseList | null = null

class ReleaseCheckError extends Error {
  constructor(readonly code: NonNullable<SystemUpdateInfo['error']>) {
    super(code)
    this.name = 'ReleaseCheckError'
  }
}

function releaseRepository() {
  return OFFICIAL_REPOSITORY
}

function releaseTag() {
  return process.env.SLOTHVAULT_RELEASE_TAG?.trim() || null
}

function releaseCommitSha() {
  return process.env.SLOTHVAULT_RELEASE_COMMIT_SHA?.trim() || null
}

export function parseReleaseTag(value: string | null | undefined): ReleaseVersion | null {
  if (!value) return null
  const match = RELEASE_TAG_PATTERN.exec(value.trim())
  if (!match) return null
  const [, major, minor, patch, build] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    build: build === undefined ? null : Number(build),
    tag: value.trim(),
  }
}

export function compareReleaseVersions(left: ReleaseVersion, right: ReleaseVersion) {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.build === right.build) return 0
  if (left.build === null) return 1
  if (right.build === null) return -1
  return left.build > right.build ? 1 : -1
}

function validGitHubRelease(value: unknown): SystemRelease | null {
  if (!value || typeof value !== 'object') return null
  const release = value as GitHubReleasePayload
  if (release.draft === true || release.prerelease === true || typeof release.tag_name !== 'string') return null
  const version = parseReleaseTag(release.tag_name)
  if (!version || typeof release.html_url !== 'string') return null
  return {
    tag: version.tag,
    title: typeof release.name === 'string' && release.name.trim() ? release.name.trim() : version.tag,
    commitSha: typeof release.target_commitish === 'string' && release.target_commitish.trim()
      ? release.target_commitish.trim()
      : null,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    htmlUrl: release.html_url,
    notes: typeof release.body === 'string' ? release.body : '',
  }
}

function sortReleasesNewestFirst(releases: SystemRelease[]) {
  return [...releases].sort((left, right) => {
    const leftVersion = parseReleaseTag(left.tag)
    const rightVersion = parseReleaseTag(right.tag)
    if (!leftVersion || !rightVersion) return 0
    return compareReleaseVersions(rightVersion, leftVersion)
  })
}

function githubErrorForStatus(status: number): ReleaseCheckError {
  if (status === 404) return new ReleaseCheckError('RELEASE_SOURCE_NOT_FOUND')
  if (status === 403 || status === 429) return new ReleaseCheckError('RELEASE_RATE_LIMITED')
  return new ReleaseCheckError('RELEASE_CHECK_FAILED')
}

async function fetchPublishedReleases(repository: string, installedTag: string | null) {
  const now = Date.now()
  if (
    cachedReleaseList &&
    cachedReleaseList.repository === repository &&
    cachedReleaseList.expiresAt > now &&
    (!installedTag || cachedReleaseList.releases.some((release) => release.tag === installedTag))
  ) {
    return cachedReleaseList.releases
  }

  const releases: SystemRelease[] = []
  let foundInstalledRelease = false
  try {
    for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
      const url = new URL(`https://api.github.com/repos/${repository}/releases`)
      url.searchParams.set('per_page', String(RELEASES_PER_PAGE))
      url.searchParams.set('page', String(page))
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'SlothVault-System-Update',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw githubErrorForStatus(response.status)
      const payload: unknown = await response.json()
      if (!Array.isArray(payload)) throw new ReleaseCheckError('RELEASE_CHECK_FAILED')
      const pageReleases = payload.map(validGitHubRelease).filter((item): item is SystemRelease => Boolean(item))
      releases.push(...pageReleases)
      foundInstalledRelease = foundInstalledRelease || pageReleases.some((release) => release.tag === installedTag)
      if (!installedTag || foundInstalledRelease || payload.length < RELEASES_PER_PAGE) break
    }
  } catch (error) {
    if (error instanceof ReleaseCheckError) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ReleaseCheckError('RELEASE_REQUEST_TIMEOUT')
    }
    throw new ReleaseCheckError('RELEASE_CHECK_FAILED')
  }

  const sorted = sortReleasesNewestFirst(releases)
  if (!sorted.length) throw new ReleaseCheckError('RELEASE_SOURCE_NOT_FOUND')
  cachedReleaseList = { repository, expiresAt: now + CACHE_TTL_MS, releases: sorted }
  return sorted
}

function installedIdentity() {
  return {
    packageVersion: process.env.SLOTHVAULT_APP_VERSION?.trim() || packageJson.version,
    tag: releaseTag(),
    commitSha: releaseCommitSha(),
  }
}

function failedCheck(identity: SystemUpdateInfo['installed'], repository: string, error: SystemUpdateInfo['error']): SystemUpdateInfo {
  return {
    checkedAt: new Date().toISOString(),
    status: 'CHECK_FAILED',
    repository,
    installed: identity,
    latest: null,
    missingReleases: [],
    historyComplete: false,
    error,
  }
}

export async function getSystemUpdateInfo(): Promise<SystemUpdateInfo> {
  const repository = releaseRepository()
  const installed = installedIdentity()
  const installedVersion = parseReleaseTag(installed.tag)

  let releases: SystemRelease[]
  try {
    releases = await fetchPublishedReleases(repository, installed.tag)
  } catch (error) {
    return failedCheck(
      installed,
      repository,
      error instanceof ReleaseCheckError ? error.code : 'RELEASE_CHECK_FAILED',
    )
  }

  const latest = releases[0] || null
  const latestVersion = latest ? parseReleaseTag(latest.tag) : null
  if (!latest || !latestVersion) return failedCheck(installed, repository, 'RELEASE_SOURCE_NOT_FOUND')
  if (!installedVersion) {
    return {
      checkedAt: new Date().toISOString(),
      status: 'UNVERSIONED',
      repository,
      installed,
      latest,
      missingReleases: [],
      historyComplete: false,
      error: null,
    }
  }

  const comparison = compareReleaseVersions(installedVersion, latestVersion)
  const installedReleaseFound = releases.some((release) => release.tag === installed.tag)
  const newerReleases = releases
    .filter((release) => {
      const version = parseReleaseTag(release.tag)
      return version ? compareReleaseVersions(version, installedVersion) > 0 : false
    })
    .sort((left, right) => compareReleaseVersions(parseReleaseTag(left.tag)!, parseReleaseTag(right.tag)!))

  return {
    checkedAt: new Date().toISOString(),
    status:
      comparison === 0
        ? 'UP_TO_DATE'
        : comparison > 0
          ? 'LOCAL_NEWER'
          : installedReleaseFound
            ? 'UPDATE_AVAILABLE'
            : 'HISTORY_INCOMPLETE',
    repository,
    installed,
    latest,
    missingReleases: newerReleases,
    historyComplete: installedReleaseFound,
    error: null,
  }
}

export function resetSystemUpdateCacheForTests() {
  cachedReleaseList = null
}
