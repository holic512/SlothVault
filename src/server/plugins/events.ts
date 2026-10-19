/**
 * @file events.ts
 * @project SlothVault
 * @module Plugin Transactional Events
 * @description Appends bounded after-commit work only when enabled plugins subscribe.
 * @logic Keep business requests independent of worker execution; use the caller's transaction as an outbox.
 * @dependencies Prisma task model, metadata registry
 * @index_tags plugins,hooks,events,outbox
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { pluginRegistry } from './state'
export async function enqueuePluginEvent(tx: Pick<Prisma.TransactionClient, 'pluginTask'>, event: string, payload: unknown) {
  const plugins = [...pluginRegistry.values()].filter(p => p.installed && p.enabled && p.manifest.events.includes(event))
  if (!plugins.length) return
  const payloadJson = JSON.stringify(payload ?? null)
  if (Buffer.byteLength(payloadJson) > 64 * 1024) throw new Error('Plugin event payload exceeds 64 KiB')
  await tx.pluginTask.createMany({ data: plugins.map(p => ({ pluginId: p.manifest.id, taskKey: randomUUID(), kind: 'event', handler: event, payloadJson, runAt: new Date() })) })
}
