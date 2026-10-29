/**
 * @file manager.ts
 * @project SlothVault
 * @module Plugin Manager
 * @description Coordinates verified installation, dependencies, persistent state, reversible updates and data-preserving uninstall.
 * @logic Separate package/installation/worker state, snapshot before schema changes, commit version pointers only after health checks, and never resurrect uninstall tombstones.
 * @dependencies Prisma, package verifier, worker supervisor, table registry, recovery snapshots
 * @index_tags plugins,manager,install,upgrade,uninstall,recovery
 * @author holic512
 */
import 'server-only'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import semver from 'semver'
import { pluginManifestSchema, type PluginManifest, type PluginListItem, type PluginInvocation } from '@slothvault/plugin-sdk/protocol'
import { retireLegacyGiftCards } from './retirement'
import { prisma } from '@/server/prisma'
import { HttpError } from '@/server/http/errors'
import {
  decryptPluginConfig,
  encryptPluginConfig,
  maskedPluginConfig,
  MASKED_PLUGIN_SECRET,
  validatePluginConfig
} from './config'
import { assertCompatible, packageExists, pluginRoot, stagePluginPackage, verifyInstalledPackage } from './packages'
import {
  createOwnedTable,
  dropOwnedTables,
  orderedPluginTables,
  physicalTableName,
  pluginTableMap,
  tableExists,
  verifyOwnedTable,
  schemaDatabase
} from './database'
import { pluginRegistry, type RegisteredPlugin } from './state'
import { pluginWorkers, startPluginWorker, stopPluginWorker } from './runtime'
import { ownedTables, readSnapshot, restorePluginSnapshot, snapshotPlugin } from './snapshots'

const recoveryErrors = new Set(['PLUGIN_RECOVERY_REQUIRED', 'PLUGIN_UNINSTALL_INCOMPLETE'])
const runtime = globalThis as unknown as { slothVaultPluginsReady?: Promise<void> }

export async function reloadPluginRegistry() {
  const rows = await prisma.pluginInstallation.findMany()
  pluginRegistry.clear()
  for (const row of rows) {
    try {
      pluginRegistry.set(
        row.pluginId,
        {
          manifest: pluginManifestSchema.parse(JSON.parse(row.manifestJson)),
          digest: row.digest,
          installed: row.installed,
          enabled: row.enabled && !recoveryErrors.has(row.error ?? ''),
          generation: row.generation,
          configCiphertext: row.configCiphertext,
          accessBindings: JSON.parse(row.accessBindingsJson),
        }
      )
    } catch { console.error('[plugins] Invalid stored manifest; plugin remains inactive') }
  }
}

export async function initializePlugins() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (!runtime.slothVaultPluginsReady) {
    runtime.slothVaultPluginsReady = (async () => {
      await retireLegacyGiftCards()
      for (const operation of await prisma.pluginOperation.findMany({ where: { status: 'RUNNING' }, orderBy: { id: 'asc' } })) {
        if (operation.phase === 'COMMITTED') {
          await prisma.pluginOperation.update({ where: { id: operation.id }, data: { status: 'SUCCEEDED', updatedAt: new Date() } })
          continue
        }
        const payload = JSON.parse(operation.payloadJson) as { snapshot?: string; manifest?: PluginManifest; digest?: string }
        try {
          if (payload.snapshot) {
            await restorePluginSnapshot(
              payload.snapshot,
              payload.manifest?.tables.map(descriptor => ({ name: physicalTableName(operation.pluginId, descriptor), descriptor }))
            )
          }
          await prisma.pluginOperation.update({
            where: { id: operation.id },
            data: { status: 'RECOVERED', phase: 'ROLLED_BACK', updatedAt: new Date() },
          })
        } catch {
          await markPluginRecoveryRequired(operation.pluginId, payload.manifest, payload.digest)
          await prisma.pluginOperation.update({
            where: { id: operation.id },
            data: { status: 'FAILED', error: 'PLUGIN_RECOVERY_REQUIRED', updatedAt: new Date() },
          })
        }
      }
      await prisma.pluginTask.updateMany({
        where: { status: 'RUNNING' },
        data: { status: 'PENDING', error: 'INTERRUPTED_AFTER_RESTART', runAt: new Date() },
      })
      await reloadPluginRegistry()

    })().catch(error => {
      runtime.slothVaultPluginsReady = undefined
      throw error
    })
  }
  await runtime.slothVaultPluginsReady
  if (process.env.NODE_ENV !== 'test') (await import('./scheduler')).initializePluginScheduler()
}

export function resetPluginInitialization() {
  runtime.slothVaultPluginsReady = undefined
  pluginRegistry.clear()
}

function assertDependencies(manifest: PluginManifest, enable = false) {
  for (const [id, range] of Object.entries(manifest.dependencies)) {
    const dependency = pluginRegistry.get(id)
    if (id === manifest.id || !dependency?.installed ||
      !semver.satisfies(dependency.manifest.version, range) ||
      (enable && !dependency.enabled)) {
      throw new HttpError(`Plugin dependency is missing, disabled or incompatible: ${id}`, 409)
    }
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) {
      throw new HttpError('Plugin dependency cycle', 409)
    }
    if (visited.has(id)) {
      return
    }
    visiting.add(id)
    const node = id === manifest.id ? manifest : pluginRegistry.get(id)?.manifest
    for (const key of Object.keys(node?.dependencies ?? {})) visit(key)
    visiting.delete(id)
    visited.add(id)
  }
  visit(manifest.id)
}

function assertDependents(id: string, version?: string) {
  for (const other of pluginRegistry.values()) {
    if (other.installed && other.enabled && other.manifest.dependencies[id] &&
      (!version || !semver.satisfies(version, other.manifest.dependencies[id]))) {
      throw new HttpError(`Disable dependent plugin first: ${other.manifest.id}`, 409)
    }
  }
}

async function markPluginRecoveryRequired(id: string, manifest?: PluginManifest, digest = '0'.repeat(64), configCiphertext = '') {
  const current = await prisma.pluginInstallation.findUnique({ where: { pluginId: id }, select: { id: true } })
  if (current) {
    await prisma.pluginInstallation.update({ where: { pluginId: id }, data: { enabled: false, error: 'PLUGIN_RECOVERY_REQUIRED' } })
  } else if (manifest) {
    await prisma.pluginInstallation.create({
      data: {
        pluginId: id,
        version: manifest.version,
        digest,
        manifestJson: JSON.stringify(manifest),
        configCiphertext,
        installed: false,
        enabled: false,
        error: 'PLUGIN_RECOVERY_REQUIRED',
      },
    })
  }
}

async function failOperation(id: number, error: unknown) {
  await prisma.pluginOperation.update({
    where: { id },
    data: {
      status: 'FAILED',
      error: error instanceof HttpError ? error.message.slice(0, 255) : 'PLUGIN_OPERATION_FAILED',
      updatedAt: new Date(),
    },
  })
}

async function requireRecoveredInstallation(id: string) {
  const installation = await prisma.pluginInstallation.findUnique({ where: { pluginId: id } })
  if (installation?.error && recoveryErrors.has(installation.error)) {
    throw new HttpError('Complete plugin recovery before changing its state', 409, 409, { reason: installation.error })
  }
  return installation
}

export async function installPlugin(
  buffer: Buffer,
  options: { trusted: boolean; actorUserId: number | null; source?: string; expectedGeneration?: number }
) {
  if (!options.trusted) throw new HttpError('Explicit full-code trust confirmation is required', 400)
  const { manifest, digest } = await stagePluginPackage(buffer)
  assertCompatible(manifest)
  const previous = await requireRecoveredInstallation(manifest.id)
  if (options.expectedGeneration !== undefined &&
    (previous?.generation ?? 0) !== options.expectedGeneration) {
    throw new HttpError('Plugin changed during compilation; preview and retry', 409)
  }
  const enabled = previous?.installed === true && previous.enabled
  assertDependencies(manifest, enabled)
  if (previous?.installed && previous.version === manifest.version && previous.digest === digest) {
    await stopPluginWorker(manifest.id)
    await stagePluginPackage(buffer, true)
    await prisma.pluginPackage.upsert({
      where: { digest },
      create: {
        pluginId: manifest.id,
        version: manifest.version,
        digest,
        manifestJson: JSON.stringify(manifest),
      },
      update: {},
    })
    await prisma.pluginInstallation.update({ where: { pluginId: manifest.id }, data: { manifestJson: JSON.stringify(manifest), error: null } })
    await prisma.pluginOperation.create({
      data: {
        pluginId: manifest.id,
        action: 'REPAIR',
        phase: 'COMMITTED',
        status: 'SUCCEEDED',
        actorUserId: options.actorUserId,
      },
    })
    await reloadPluginRegistry()
    return { id: manifest.id, version: manifest.version, enabled: previous.enabled }
  }
  if (previous?.installed && semver.lt(manifest.version, previous.version)) {
    throw new HttpError('Install the same or a newer source version; use explicit rollback to downgrade', 409)
  }
  assertDependents(manifest.id, manifest.version)
  const config = validatePluginConfig(
    manifest,
    {
      ...manifest.configDefaults,
      ...(previous?.configCiphertext ? decryptPluginConfig(previous.configCiphertext) : {}),
    }
  )
  // Establish ownership before taking a recovery snapshot: recovery must never
  // adopt/drop another plugin's table or an unregistered namespaced table.
  for (const descriptor of manifest.tables) {
    const name = physicalTableName(manifest.id, descriptor)
    const owner = await prisma.pluginOwnedTable.findUnique({ where: { name } })
    if (owner && owner.pluginId !== manifest.id) {
      throw new HttpError('Plugin table is already owned by another plugin', 409)
    }
    if (!owner && await tableExists(name)) {
      throw new HttpError('Unregistered plugin table requires ownership recovery, not automatic adoption', 409)
    }
  }
  const snapshot = await snapshotPlugin(manifest.id, manifest)
  const operation = await prisma.pluginOperation.create({
    data: {
      pluginId: manifest.id,
      action: previous?.installed ? 'UPDATE' : 'INSTALL',
      phase: 'SNAPSHOT',
      actorUserId: options.actorUserId,
      payloadJson: JSON.stringify({ snapshot, manifest, digest }),
    },
  })
  const registered: RegisteredPlugin = {
    manifest,
    digest,
    installed: true,
    enabled,
    generation: (previous?.generation ?? 0) + 1,
    accessBindings: previous ? JSON.parse(previous.accessBindingsJson) : {},
    configCiphertext: encryptPluginConfig(config),
  }
  const added = manifest.tables.map(descriptor => ({ name: physicalTableName(manifest.id, descriptor), descriptor }))
  try {
    const old = pluginRegistry.get(manifest.id)
    if (old) old.enabled = false
    await stopPluginWorker(manifest.id)
    await stagePluginPackage(buffer, true)
    const names = pluginTableMap(manifest)
    for (const table of orderedPluginTables(added)) {
      const owner = await prisma.pluginOwnedTable.findUnique({ where: { name: table.name } })
      if (owner && owner.pluginId !== manifest.id) {
        throw new HttpError('Plugin table is already owned by another plugin', 409)
      }
      if (!await tableExists(table.name)) await createOwnedTable(manifest.id, table.descriptor, names)
      await prisma.pluginOwnedTable.upsert({
        where: { name: table.name },
        create: { pluginId: manifest.id, name: table.name, descriptorJson: JSON.stringify(table.descriptor) },
        update: { descriptorJson: JSON.stringify(table.descriptor) },
      })
    }
    if (manifest.server) {
      const worker = await startPluginWorker(registered)
      for (const key of manifest.migrations) {
        if (await prisma.pluginMigration.findUnique({ where: { pluginId_key: { pluginId: manifest.id, key } } })) {
          continue
        }
        await worker.invoke('migrations', key, undefined, { ddl: true, timeout: 60_000 })
        await prisma.pluginMigration.create({ data: { pluginId: manifest.id, key, digest } })
      }
      await worker.invoke('lifecycle', previous?.installed ? 'onUpgrade' : 'onInstall', undefined, { timeout: 15_000 })
      if (registered.enabled) await worker.invoke('lifecycle', 'onEnable')
    }
    const removed = (await ownedTables(manifest.id)).filter(t => !added.some(next => next.name === t.name))
    await dropOwnedTables(removed)
    for (const table of removed) await prisma.pluginOwnedTable.delete({ where: { name: table.name } })
    for (const table of added) await verifyOwnedTable(table.name, table.descriptor, names)
    await prisma.$transaction(async tx => {
      await tx.pluginPackage.upsert({
        where: { digest },
        create: {
          pluginId: manifest.id,
          version: manifest.version,
          digest,
          manifestJson: JSON.stringify(manifest),
        },
        update: {},
      })
      const values = {
        version: manifest.version,
        digest,
        manifestJson: JSON.stringify(manifest),
        configCiphertext: registered.configCiphertext,
        installed: true,
        enabled: registered.enabled,
        generation: registered.generation,
        source: options.source ?? previous?.source ?? null,
        error: null,
        updatedAt: new Date(),
      }
      await tx.pluginInstallation.upsert({ where: { pluginId: manifest.id }, create: { pluginId: manifest.id, ...values }, update: values })
      await tx.pluginOperation.update({
        where: { id: operation.id },
        data: { phase: 'COMMITTED', status: 'SUCCEEDED', updatedAt: new Date() },
      })
    })
    pluginRegistry.set(manifest.id, registered)
    await stopPluginWorker(manifest.id)
    return { id: manifest.id, version: manifest.version, enabled: registered.enabled }
  } catch (error) {
    await stopPluginWorker(manifest.id)
    try {
      await restorePluginSnapshot(snapshot, added)
    } catch {
      await markPluginRecoveryRequired(manifest.id, manifest, digest, registered.configCiphertext)
    }
    await reloadPluginRegistry()
    await failOperation(operation.id, error)
    throw error
  }
}

function readStoredManifest(value: string): PluginManifest | undefined {
  try { return pluginManifestSchema.parse(JSON.parse(value)) } catch { return undefined }
}

export async function listPlugins(): Promise<PluginListItem[]> {
  await initializePlugins()
  const [rows, counts] = await Promise.all([
    prisma.pluginInstallation.findMany({ orderBy: { pluginId: 'asc' } }),
    prisma.pluginOwnedTable.groupBy({ by: ['pluginId'], _count: { _all: true } })
  ])
  const tableCounts = new Map(counts.map(row => [row.pluginId, row._count._all]))
  return Promise.all(rows.map(async row => {
    const manifest = readStoredManifest(row.manifestJson)
    const fallback = manifest ?? pluginManifestSchema.parse({
      schema: 1,
      id: 'slothvault.invalid-metadata',
      name: row.pluginId.slice(0, 100),
      version: '0.0.0',
      author: 'Unknown',
      engines: { slothvault: '*', sdk: '*', node: '*' },
    })
    const error = manifest ? row.error : 'PLUGIN_MANIFEST_INVALID'
    return {
      id: row.pluginId,
      name: fallback.name,
      description: fallback.description,
      version: row.version,
      installed: row.installed,
      enabled: row.enabled && !!manifest,
      generation: row.generation,
      digest: row.digest,
      codeState: await packageExists(row.digest, row.pluginId) ? 'PRESENT' as const : 'MISSING' as const,
      runtime: error
        ? 'ERROR'
        : !row.installed
          ? 'UNINSTALLED'
          : !row.enabled ? 'DISABLED' : pluginWorkers.get(row.pluginId)?.stopped === false ? 'RUNNING' : 'IDLE',
      error,
      retainedTables: tableCounts.get(row.pluginId) ?? 0,
      manifest: fallback,
      source: row.source,
      updatedAt: row.updatedAt.toISOString(),
    }
  }))
}

export async function pluginDetails(id: string) {
  const item = (await listPlugins()).find(p => p.id === id)
  if (!item) throw new HttpError('Plugin not found', 404)
  const row = await prisma.pluginInstallation.findUniqueOrThrow({ where: { pluginId: id } })
  let config: Record<string, unknown> = {}
  let configError: string | null = null
  try {
    if (!readStoredManifest(row.manifestJson)) {
      throw new Error('Invalid metadata')
    }
    config = maskedPluginConfig(item.manifest, decryptPluginConfig(row.configCiphertext))
  } catch {
    configError = 'PLUGIN_CONFIG_KEY_MISMATCH'
  }
  return {
    ...item,
    config,
    configError,
    tables: await ownedTables(id),
    operations: await prisma.pluginOperation.findMany({
      where: { pluginId: id },
      orderBy: { id: 'desc' },
      take: 20,
      select: { id: true, action: true, phase: true, status: true, error: true, createdAt: true },
    }),
    tasks: await prisma.pluginTask.findMany({
      where: { pluginId: id },
      orderBy: { id: 'desc' },
      take: 20,
      select: { id: true, kind: true, handler: true, status: true, attempts: true, runAt: true, error: true },
    }),
  }
}
/** Persistent declarations protect pending external operations even when plugin code is absent. */
async function assertLifecycleQuiescent(item: RegisteredPlugin) {
  const db = schemaDatabase()
  for (const guard of item.manifest.lifecycleGuards) {
    const descriptor = item.manifest.tables.find(table => table.name === guard.table)!
    const found = await db
      .selectFrom(physicalTableName(item.manifest.id, descriptor))
      .select(guard.column)
      .where(guard.column, 'in', guard.values)
      .limit(1)
      .executeTakeFirst()
    if (found) throw new HttpError(guard.message, 409)
  }
}

export async function setPluginEnabled(id: string, enabled: boolean, actorUserId: number) {
  await initializePlugins()
  await requireRecoveredInstallation(id)
  const item = pluginRegistry.get(id)
  if (!item?.installed) throw new HttpError('Plugin is not installed', 404)
  if (enabled) {
    assertCompatible(item.manifest)
    assertDependencies(item.manifest, true)
    await verifyInstalledPackage(item.digest, item.manifest)
  } else {
    assertDependents(id)
  }
  if (!enabled) await assertLifecycleQuiescent(item)
  item.enabled = false
  await prisma.pluginInstallation.update({
    where: { pluginId: id },
    data: { enabled: false, generation: { increment: 1 }, updatedAt: new Date() },
  })
  item.generation++
  if (!enabled) {
    await prisma.pluginTask.updateMany({ where: { pluginId: id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'CANCELED' } })
  }
  try {
    if (item.manifest.server) {
      if (!enabled && pluginWorkers.has(id)) {
        await pluginWorkers.get(id)!.invoke('lifecycle', 'onDisable', undefined, { readOnly: true, timeout: 2000 }).catch(() => undefined)
      }
      await stopPluginWorker(id)
      if (enabled) {
        validatePluginConfig(item.manifest, decryptPluginConfig(item.configCiphertext))
        await (await startPluginWorker(item)).invoke('lifecycle', 'onEnable')
        await stopPluginWorker(id)
      }
    }
    await prisma.pluginInstallation.update({ where: { pluginId: id }, data: { enabled, error: null, updatedAt: new Date() } })
    item.enabled = enabled
    await prisma.pluginOperation.create({
      data: {
        pluginId: id,
        action: enabled ? 'ENABLE' : 'DISABLE',
        phase: 'COMMITTED',
        status: 'SUCCEEDED',
        actorUserId,
      },
    })
  } catch (error) {
    await stopPluginWorker(id)
    await prisma.pluginInstallation.update({ where: { pluginId: id }, data: { enabled: false, error: 'PLUGIN_ACTIVATION_FAILED' } })
    throw error
  }
}

export async function savePluginConfig(id: string, values: Record<string, unknown>, actorUserId?: number) {
  await initializePlugins()
  await requireRecoveredInstallation(id)
  const item = pluginRegistry.get(id)
  if (!item?.installed) throw new HttpError('Plugin not installed', 404)
  let previous: Record<string, unknown> = {}
  try {
    previous = decryptPluginConfig(item.configCiphertext)
  } catch { /* Explicit replacement permits master-key recovery. */ }
  const merged = { ...values }
  for (const key of item.manifest.secretFields) if (merged[key] === MASKED_PLUGIN_SECRET) merged[key] = previous[key]
  const validated = validatePluginConfig(item.manifest, merged)
  await stopPluginWorker(id)
  item.configCiphertext = encryptPluginConfig(validated)
  item.generation++
  await prisma.pluginInstallation.update({
    where: { pluginId: id },
    data: {
      configCiphertext: item.configCiphertext,
      generation: item.generation,
      error: null,
      updatedAt: new Date(),
    },
  })
  await prisma.pluginOperation.create({
    data: { pluginId: id, action: 'CONFIGURE', status: 'SUCCEEDED', phase: 'COMMITTED', actorUserId },
  })
}

export async function uninstallPlugin(id: string, input: { deleteData: boolean; confirmPluginId?: string; actorUserId: number }) {
  await initializePlugins()
  const item = pluginRegistry.get(id)
  if (!item) {
    throw new HttpError('Plugin not found', 404)
  }
  assertDependents(id)
  if (input.deleteData && input.confirmPluginId !== id) {
    throw new HttpError('Type the plugin ID to confirm data deletion', 400)
  }
  await assertLifecycleQuiescent(item)
  const snapshot = await snapshotPlugin(id)
  const operation = await prisma.pluginOperation.create({
    data: {
      pluginId: id,
      action: 'UNINSTALL',
      phase: 'SNAPSHOT',
      actorUserId: input.actorUserId,
      payloadJson: JSON.stringify({ snapshot }),
    },
  })
  item.enabled = false
  try {
    await stopPluginWorker(id)
    await prisma.pluginTask.updateMany({ where: { pluginId: id }, data: { status: 'CANCELED' } })
    if (item.manifest.server && item.installed && await packageExists(item.digest, id)) {
      try {
        await (await startPluginWorker(item)).invoke('lifecycle', 'onUninstall', undefined, { readOnly: true, timeout: 2000 })
      } catch { /* Uninstall cannot be held hostage by a callback. */ }
      await stopPluginWorker(id)
    }
    if (input.deleteData) {
      await dropOwnedTables(await ownedTables(id))
      await prisma.pluginOwnedTable.deleteMany({ where: { pluginId: id } })
      await prisma.pluginMigration.deleteMany({ where: { pluginId: id } })
      await prisma.pluginTask.deleteMany({ where: { pluginId: id } })
    }
    await prisma.$transaction(async tx => {
      await tx.pluginInstallation.update({
        where: { pluginId: id },
        data: {
          installed: false,
          enabled: false,
          configCiphertext: input.deleteData ? '' : item.configCiphertext,
          generation: { increment: 1 },
          error: null,
          updatedAt: new Date(),
        },
      })
      await tx.pluginOperation.update({
        where: { id: operation.id },
        data: { status: 'SUCCEEDED', phase: 'COMMITTED', updatedAt: new Date() },
      })
    })
    for (const area of ['archives', 'packages', 'compiled', 'staging', ...(input.deleteData ? ['snapshots'] : [])]) await rm(resolve(pluginRoot(id), area), { recursive: true, force: true })
    await prisma.pluginPackage.deleteMany({ where: { pluginId: id } })
    await reloadPluginRegistry()
  } catch (error) {
    await failOperation(operation.id, error)
    await prisma.pluginInstallation.updateMany({ where: { pluginId: id }, data: { enabled: false, error: 'PLUGIN_UNINSTALL_INCOMPLETE' } })
    throw error
  }
}

export async function retryPlugin(id: string, actorUserId: number) {
  await initializePlugins()
  const row = await prisma.pluginInstallation.findUnique({ where: { pluginId: id } })
  if (row?.error === 'PLUGIN_RECOVERY_REQUIRED' || row?.error === 'PLUGIN_UNINSTALL_INCOMPLETE') {
    const operation = await prisma.pluginOperation.findFirst({
      where: { pluginId: id, status: 'FAILED', action: { in: ['INSTALL', 'UPDATE', 'UNINSTALL', 'ROLLBACK'] } },
      orderBy: { id: 'desc' },
    })
    if (!operation) throw new HttpError('No recoverable operation exists', 409)
    if (operation.phase === 'COMMITTED') {
      throw new HttpError('Uninstall committed; repeat uninstall to finish code cleanup', 409)
    }
    const payload = JSON.parse(operation.payloadJson) as { snapshot?: string; manifest?: PluginManifest; digest?: string }
    if (!payload.snapshot) throw new HttpError('Recovery snapshot is unavailable', 409)
    await stopPluginWorker(id)
    await restorePluginSnapshot(
      payload.snapshot,
      payload.manifest?.tables.map(descriptor => ({ name: physicalTableName(id, descriptor), descriptor }))
    )
    await prisma.pluginOperation.update({ where: { id: operation.id }, data: { status: 'RECOVERED', phase: 'ROLLED_BACK', error: null } })
    await reloadPluginRegistry()
  }
  if (pluginRegistry.get(id)?.installed) await setPluginEnabled(id, true, actorUserId)
}

export async function rollbackPlugin(id: string, actorUserId: number) {
  await initializePlugins()
  const current = await requireRecoveredInstallation(id)
  if (!current?.installed) throw new HttpError('Plugin is not installed', 404)
  assertDependents(id)
  const operation = await prisma.pluginOperation.findFirst({ where: { pluginId: id, action: 'UPDATE', status: 'SUCCEEDED' }, orderBy: { id: 'desc' } })
  if (!operation) throw new HttpError('No plugin upgrade snapshot is available', 409)
  const saved = JSON.parse(operation.payloadJson) as { snapshot: string; digest: string }
  if (saved.digest !== current.digest) {
    throw new HttpError('The current plugin version has no matching upgrade snapshot', 409)
  }
  const snapshot = await readSnapshot(saved.snapshot)
  if (!snapshot.installation || !await packageExists(String(snapshot.installation.digest), id)) {
    throw new HttpError('Previous plugin code is unavailable', 409)
  }
  const previousManifest = pluginManifestSchema.parse(JSON.parse(String(snapshot.installation.manifestJson)))
  assertCompatible(previousManifest)
  assertDependencies(previousManifest, Boolean(snapshot.installation.enabled))
  await verifyInstalledPackage(String(snapshot.installation.digest), previousManifest)
  const recovery = await snapshotPlugin(id)
  const journal = await prisma.pluginOperation.create({
    data: {
      pluginId: id,
      action: 'ROLLBACK',
      phase: 'SNAPSHOT',
      payloadJson: JSON.stringify({ snapshot: recovery }),
      actorUserId,
    },
  })
  try {
    const item = pluginRegistry.get(id)
    if (item) {
      item.enabled = false
    }
    await stopPluginWorker(id)
    await restorePluginSnapshot(saved.snapshot)
    await reloadPluginRegistry()
    await prisma.pluginOperation.update({ where: { id: journal.id }, data: { phase: 'COMMITTED', status: 'SUCCEEDED' } })
  } catch (error) {
    try { await restorePluginSnapshot(recovery) } catch { await markPluginRecoveryRequired(id) }
    await reloadPluginRegistry()
    await failOperation(journal.id, error)
    throw error
  }
}

export async function invokePluginService(id: string, service: string, invocation: PluginInvocation) {
  await initializePlugins()
  const item = pluginRegistry.get(id)
  if (!item?.installed) throw new HttpError('Plugin is not installed', 404, 404, { reason: 'PLUGIN_NOT_INSTALLED' })
  if (!item.enabled) throw new HttpError('Plugin is disabled', 409, 409, { reason: 'PLUGIN_DISABLED' })
  if (!item.manifest.services.includes(service)) throw new HttpError('Plugin service not found', 404)
  return invokeRegisteredPlugin(item, 'services', service, invocation)
}

export async function invokeRegisteredPlugin(
  item: RegisteredPlugin,
  group: string,
  key: string,
  input: unknown,
  background = false,
  readOnly = false,
  task?: { id: string; attempt: number; scheduledAt: string }
) {
  const generation = item.generation
  if (!item.installed || !item.enabled) throw new HttpError('Plugin is disabled', 409)
  try {
    const worker = await startPluginWorker(item)
    const current = pluginRegistry.get(item.manifest.id)
    if (!current?.enabled || !current.installed || current.generation !== generation) {
      throw new HttpError('Plugin state changed during activation', 409)
    }
    return await worker.invoke(group, key, input, { background, readOnly, task })
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) {
      await prisma.pluginInstallation.updateMany({ where: { pluginId: item.manifest.id }, data: { error: 'PLUGIN_EXECUTION_FAILED' } })
    }
    throw error
  }
}
