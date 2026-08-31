import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  compareReleaseVersions,
  getSystemUpdateInfo,
  parseReleaseTag,
  resetSystemUpdateCacheForTests,
} from '@/server/services/system-update'

const originalEnvironment = {
  repository: process.env.SLOTHVAULT_RELEASE_REPOSITORY,
  tag: process.env.SLOTHVAULT_RELEASE_TAG,
  commitSha: process.env.SLOTHVAULT_RELEASE_COMMIT_SHA,
  appVersion: process.env.SLOTHVAULT_APP_VERSION,
}

function release(tag: string, body = '') {
  return {
    tag_name: tag,
    name: `SlothVault ${tag}`,
    target_commitish: `${tag}-sha`,
    published_at: '2026-08-31T00:00:00.000Z',
    html_url: `https://github.com/holic512/SlothVault/releases/tag/${tag}`,
    body,
    draft: false,
    prerelease: false,
  }
}

function mockReleaseResponse(payload: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }))
}

describe('system update release metadata', () => {
  beforeEach(() => {
    resetSystemUpdateCacheForTests()
    process.env.SLOTHVAULT_RELEASE_REPOSITORY = 'holic512/SlothVault'
    process.env.SLOTHVAULT_RELEASE_TAG = 'v2.0.0-build.75'
    process.env.SLOTHVAULT_RELEASE_COMMIT_SHA = 'installed-sha'
    delete process.env.SLOTHVAULT_APP_VERSION
  })

  afterEach(() => {
    resetSystemUpdateCacheForTests()
    vi.unstubAllGlobals()
    if (originalEnvironment.repository === undefined) delete process.env.SLOTHVAULT_RELEASE_REPOSITORY
    else process.env.SLOTHVAULT_RELEASE_REPOSITORY = originalEnvironment.repository
    if (originalEnvironment.tag === undefined) delete process.env.SLOTHVAULT_RELEASE_TAG
    else process.env.SLOTHVAULT_RELEASE_TAG = originalEnvironment.tag
    if (originalEnvironment.commitSha === undefined) delete process.env.SLOTHVAULT_RELEASE_COMMIT_SHA
    else process.env.SLOTHVAULT_RELEASE_COMMIT_SHA = originalEnvironment.commitSha
    if (originalEnvironment.appVersion === undefined) delete process.env.SLOTHVAULT_APP_VERSION
    else process.env.SLOTHVAULT_APP_VERSION = originalEnvironment.appVersion
  })

  it('parses plain release tags and legacy build suffixes in release order', () => {
    const current = parseReleaseTag('v2.0.0-build.75')
    const newerBuild = parseReleaseTag('v2.0.0-build.76')
    const plainRelease = parseReleaseTag('v2.0.0')
    const newerMinor = parseReleaseTag('v2.1.0-build.1')

    expect(current).not.toBeNull()
    expect(newerBuild).not.toBeNull()
    expect(plainRelease).not.toBeNull()
    expect(newerMinor).not.toBeNull()
    expect(compareReleaseVersions(newerBuild!, current!)).toBe(1)
    expect(compareReleaseVersions(plainRelease!, newerBuild!)).toBe(1)
    expect(compareReleaseVersions(newerMinor!, newerBuild!)).toBe(1)
    expect(plainRelease?.build).toBeNull()
    expect(parseReleaseTag('v2.0-build.76')).toBeNull()
    expect(parseReleaseTag('v2.0.0-build.-1')).toBeNull()
  })

  it('returns all skipped official releases from oldest to newest', async () => {
    mockReleaseResponse([
      release('v2.0.0-build.77', 'newest commit'),
      release('v2.0.0-build.76', 'middle commit'),
      release('v2.0.0-build.75', 'installed commit'),
      { ...release('v9.9.9-build.1'), prerelease: true },
      { ...release('not-a-release-tag'), html_url: 'https://example.test/release' },
    ])

    const result = await getSystemUpdateInfo()

    expect(result).toMatchObject({
      status: 'UPDATE_AVAILABLE',
      historyComplete: true,
      installed: { tag: 'v2.0.0-build.75', commitSha: 'installed-sha' },
      latest: { tag: 'v2.0.0-build.77' },
    })
    expect(result.missingReleases.map((item) => item.tag)).toEqual([
      'v2.0.0-build.76',
      'v2.0.0-build.77',
    ])
  })

  it('does not cache GitHub check failures', async () => {
    const releaseFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: vi.fn() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue([release('v2.0.0-build.75')]) })
    vi.stubGlobal('fetch', releaseFetch)
    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'CHECK_FAILED',
      error: 'RELEASE_RATE_LIMITED',
    })

    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'UP_TO_DATE',
      error: null,
    })
    expect(releaseFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    { status: 404, error: 'RELEASE_SOURCE_NOT_FOUND' },
    { status: 403, error: 'RELEASE_RATE_LIMITED' },
  ])('maps GitHub HTTP $status to a displayable release-check status', async ({ status, error }) => {
    mockReleaseResponse([], status)

    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'CHECK_FAILED',
      error,
    })
  })

  it('keeps malformed and timed-out GitHub responses displayable', async () => {
    mockReleaseResponse({ releases: [] })
    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'CHECK_FAILED',
      error: 'RELEASE_CHECK_FAILED',
    })

    resetSystemUpdateCacheForTests()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')))
    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'CHECK_FAILED',
      error: 'RELEASE_REQUEST_TIMEOUT',
    })
  })

  it('uses a successful cache for the same known installed release', async () => {
    mockReleaseResponse([release('v2.0.0-build.75')])

    await getSystemUpdateInfo()
    await getSystemUpdateInfo()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports an old image without embedded build metadata as unverifiable', async () => {
    delete process.env.SLOTHVAULT_RELEASE_TAG
    mockReleaseResponse([release('v2.0.0-build.76')])

    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'UNVERSIONED',
      latest: { tag: 'v2.0.0-build.76' },
      missingReleases: [],
      historyComplete: false,
    })
  })

  it('marks a newer local build without proposing a downgrade', async () => {
    process.env.SLOTHVAULT_RELEASE_TAG = 'v2.1.0-build.1'
    mockReleaseResponse([release('v2.0.0-build.76')])

    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'LOCAL_NEWER',
      missingReleases: [],
    })
  })

  it('does not claim that a partial release history contains every skipped log', async () => {
    mockReleaseResponse([release('v2.0.0-build.76')])

    await expect(getSystemUpdateInfo()).resolves.toMatchObject({
      status: 'HISTORY_INCOMPLETE',
      historyComplete: false,
      missingReleases: [{ tag: 'v2.0.0-build.76' }],
    })
  })
})
