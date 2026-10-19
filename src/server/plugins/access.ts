/**
 * @file access.ts
 * @project SlothVault
 * @module Plugin Host Authorization
 * @description Enforces host sessions and active membership rules before invoking or exposing contributions.
 * @logic Fail closed on unknown policies; UI visibility never substitutes for server-side permission checks.
 * @dependencies shared auth, active memberships, plugin protocol
 * @index_tags plugins,authorization,membership,session
 * @author holic512
 */
import 'server-only'
import type { PluginAccess, PluginActor, PluginUi } from '@slothvault/plugin-sdk/protocol'
import { getActiveMemberships } from '@/server/services/membership'
import { HttpError } from '@/server/http/errors'
import { initializePlugins } from './manager'
import { pluginRegistry, type RegisteredPlugin } from './state'
export function boundPluginAccess(item: RegisteredPlugin, access: PluginAccess): PluginAccess {
  return { ...access, membershipLevelIds: access.membershipLevelIds.map(id => item.accessBindings?.[String(id)] ?? id) }
}
export async function canAccessPlugin(access: PluginAccess, actor: PluginActor, activeMembershipIds?: number[]) {
  if (access.audience === 'public') return true
  if (!actor) return false
  if (actor.role === 'ADMIN') return true
  if (access.audience === 'user') return true
  if (access.audience === 'memberships' && access.membershipLevelIds.length) {
    const memberships = activeMembershipIds ?? (await getActiveMemberships(actor.userId)).map(m => Number(m.id))
    return memberships.some(id => access.membershipLevelIds.includes(id))
  }
  return false
}
export async function requirePluginAccess(access: PluginAccess, actor: PluginActor) { if (!await canAccessPlugin(access, actor)) throw new HttpError('Access denied', actor ? 403 : 401) }
export async function pluginContributions(surface: string, actor: PluginActor): Promise<PluginUi[]> {
  await initializePlugins(); const result: PluginUi[] = []
  const candidates = [...pluginRegistry.values()].filter(p => p.installed && p.enabled && p.manifest.ui.some((ui: { surface: string; access: PluginAccess }) => ui.surface === surface && ui.access.audience === 'memberships'))
  const memberships = actor && actor.role !== 'ADMIN' && candidates.length ? (await getActiveMemberships(actor.userId)).map(m => Number(m.id)) : []
  for (const item of pluginRegistry.values()) if (item.installed && item.enabled) for (const ui of item.manifest.ui) if (ui.surface === surface && await canAccessPlugin(boundPluginAccess(item, ui.access), actor, memberships)) result.push({ ...ui, pluginId: item.manifest.id, digest: item.digest, version: item.manifest.version })
  return result.sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId) || a.key.localeCompare(b.key))
}
