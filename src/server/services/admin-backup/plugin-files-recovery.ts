/**
 * @file plugin-files-recovery.ts
 * @project SlothVault
 * @module Private Plugin File Restore Participant
 * @description Coordinates private plugin storage with the core database commit receipt.
 * @logic Stage on the private root filesystem, infer atomic moves from stage/live/rollback, retain rollback evidence until the shared recovery decision is durable.
 * @dependencies private file root, backup file safety, Node filesystem
 * @index_tags backup,plugins,restore,journal,rollback
 * @author holic512
 */
import 'server-only'
import { copyFile, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { pluginFilesRoot } from '@/server/plugins/files'
import { lstatOrNull } from './files-common'
import { PLUGIN_FILES_ARCHIVE_ROOT } from './plugin-files'

export type PrivateRestoreState = { oldPresent: boolean }
function paths(id: string) {
  z.string().uuid().parse(id)
  const live = pluginFilesRoot(), parent = dirname(live)
  return { live, parent, stage: resolve(parent, `.plugin-files-stage-${id}`), rollback: resolve(parent, `.plugin-files-rollback-${id}`) }
}
async function sync(path: string) { const h = await open(path, 'r'); try { await h.sync() } finally { await h.close() } }
async function presentDirectory(path: string) {
  const info = await lstatOrNull(path)
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Unsafe plugin restore directory')
  return Boolean(info)
}
async function copyTree(source: string, destination: string) {
  if (!await presentDirectory(source)) return
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error('Unsafe private restore entry')
    const from = resolve(source, entry.name), to = resolve(destination, entry.name)
    if (entry.isDirectory()) { await mkdir(to, { mode: 0o700 }); await copyTree(from, to) }
    else if (entry.isFile()) { await copyFile(from, to, 1); await sync(to) }
    else throw new Error('Unsafe private restore entry')
  }
  await sync(destination)
}
export async function preparePrivateRestore(id: string, stagedUploads: string): Promise<PrivateRestoreState> {
  const p = paths(id)
  await mkdir(p.parent, { recursive: true, mode: 0o700 }); await presentDirectory(p.parent)
  if (await lstatOrNull(p.stage) || await lstatOrNull(p.rollback)) throw new Error('Private restore stage conflicts')
  const oldPresent = await presentDirectory(p.live)
  await mkdir(p.stage, { mode: 0o700 })
  try {
    const source = resolve(stagedUploads, PLUGIN_FILES_ARCHIVE_ROOT)
    await copyTree(source, p.stage); await sync(p.stage); await sync(p.parent)
    await rm(source, { recursive: true, force: true })
    return { oldPresent }
  } catch (error) { await rm(p.stage, { recursive: true, force: true }); throw error }
}
export async function switchPrivateRestore(id: string, state: PrivateRestoreState) {
  const p = paths(id)
  if (state.oldPresent) { await rename(p.live, p.rollback); await sync(p.parent) }
  await rename(p.stage, p.live); await sync(p.parent)
}
export async function reconcilePrivateRestore(id: string, state: PrivateRestoreState, committed: boolean) {
  const p = paths(id)
  const staged = await presentDirectory(p.stage), live = await presentDirectory(p.live), rollback = await presentDirectory(p.rollback)
  if (committed) {
    if (staged || !live) throw new Error('Committed private files are inconsistent')
    return
  }
  if (!staged) {
    if (!live) throw new Error('Private restore material is missing')
    await rename(p.live, p.stage); await sync(p.parent)
  }
  if (state.oldPresent) {
    if (rollback) {
      if (await lstatOrNull(p.live)) throw new Error('Private rollback destination conflicts')
      await rename(p.rollback, p.live); await sync(p.parent)
    } else if (!await presentDirectory(p.live)) throw new Error('Original private files are missing')
  } else if (await lstatOrNull(p.live)) throw new Error('Unexpected private files during rollback')
}
export async function cleanupPrivateRestore(id: string) {
  const p = paths(id)
  await rm(p.stage, { recursive: true, force: true }); await rm(p.rollback, { recursive: true, force: true }); await sync(p.parent)
}
