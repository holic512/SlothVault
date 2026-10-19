/**
 * @file gift-cards.ts
 * @project SlothVault
 * @module Gift-card Compatibility Adapter
 * @description Keeps existing HTTP and MCP contracts while delegating all card business logic to the installed plugin.
 * @logic Recheck the active actor before invoking a declared plugin service; never provide a disabled-plugin fallback.
 * @dependencies Plugin Manager, host user reader
 * @index_tags plugins,gift-cards,compatibility,mcp
 * @author holic512
 */
import 'server-only'
import { GIFT_CARDS_PLUGIN_ID } from '@slothvault/plugin-sdk/protocol'
import { prisma } from '@/server/prisma'
import { HttpError } from '@/server/http/errors'
import { invokePluginService } from './manager'
async function actor(userId: number, administrator = false) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } })
  if (!user || user.status !== 1 || (administrator && user.role !== 'ADMIN')) throw new HttpError('Unauthorized', 401)
  return { userId: user.id, role: user.role }
}
export async function issueGiftCardBatch(input: { adminId: number; name: string; points: number; quantity: number; expiresAt?: Date | null }) {
  return invokePluginService(GIFT_CARDS_PLUGIN_ID, 'issue', { actor: await actor(input.adminId, true), input: { name: input.name, points: input.points, quantity: input.quantity, expiresAt: input.expiresAt?.toISOString() ?? null } }) as Promise<{ batch: { id: string; name: string; points: number; quantity: number; expiresAt: string | null; createdAt: string }; codes: string[] }>
}
export async function redeemGiftCard(userId: number, code: string) {
  return invokePluginService(GIFT_CARDS_PLUGIN_ID, 'redeem', { actor: await actor(userId), input: { code } }) as Promise<{ pointsAdded: number; pointsBalance: number; batchName: string }>
}
export async function listGiftCardBatches(page: number, pageSize: number, adminId: number) {
  return invokePluginService(GIFT_CARDS_PLUGIN_ID, 'list', { actor: await actor(adminId, true), input: { page, pageSize } }) as Promise<{ total: number; list: { id: string; name: string; points: number; quantity: number; redeemed: number; status: number; expiresAt: string | null; createdBy: string; createdAt: string }[] }>
}
