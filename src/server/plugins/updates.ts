/**
 * @file updates.ts
 * @project SlothVault
 * @module Plugin Update Discovery
 * @description Checks stable versions from the installed source without downloading or executing plugin code.
 * @logic Share bounded, short-lived repository scans; bind candidates to plugin IDs and preserve manual-source installations.
 * @dependencies plugin sources, semver, protocol
 * @index_tags plugins,updates,cache
 * @author holic512
 */
import 'server-only'
import semver from 'semver'
import type { PluginRelease, PluginUpdateInfo } from '@slothvault/plugin-sdk/protocol'
import { githubRepository, listPluginReleases, OFFICIAL_PLUGINS } from './sources'

const scans = new Map<string, { expires: number; promise: Promise<PluginRelease[]> }>()
let active = 0
const waiting: (() => void)[] = []
async function bounded<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve))
  else active++
  try { return await run() } finally { const next = waiting.shift(); if (next) next(); else active-- }
}
export async function checkPluginUpdate(item: { pluginId: string; version: string; source: string | null }): Promise<PluginUpdateInfo> {
  const result = { currentVersion: item.version, checkedAt: new Date().toISOString(), release: null }
  if (!item.source) return { ...result, status: 'manual' }
  const repo = githubRepository(item.source)
  const official = OFFICIAL_PLUGINS.find(entry => entry.id === item.pluginId && entry.repository === repo)
  const prefix = official?.tagPrefix ?? ''
  const key = `${repo}:${prefix}`
  let cached = scans.get(key)
  if (!cached || cached.expires <= Date.now()) {
    for (const [key, entry] of scans) if (entry.expires <= Date.now()) scans.delete(key)
    if (scans.size >= 100) scans.delete(scans.keys().next().value!)
    const promise = bounded(() => listPluginReleases(repo, prefix)).then(releases => {
      // The TTL starts after queued network work finishes, not while it waits for a slot.
      const current = scans.get(key)
      if (current?.promise === promise) current.expires = Date.now() + 60_000
      return releases
    }).catch(error => {
      // A previously evicted scan must not remove a newer request's cache entry.
      if (scans.get(key)?.promise === promise) scans.delete(key)
      throw error
    })
    cached = { expires: Infinity, promise }; scans.set(key, cached)
  }
  const releases = await cached.promise
  const release = releases.find(entry => entry.asset === `slothvault-plugin-${item.pluginId}-${entry.version}.zip`) ?? null
  if (!release) return { ...result, status: 'noRelease' }
  return { ...result, release, status: semver.gt(release.version, item.version) ? 'available' : 'current' }
}
