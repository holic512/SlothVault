/**
 * @file plugin-worker.ts
 * @project SlothVault
 * @module Plugin Worker Bootstrap
 * @description Runs one independently packaged backend outside the Next.js event loop.
 * @logic Bind RPC to invocation-local contexts, construct the SDK, dispatch declared handlers, and dispose deterministically.
 * @dependencies node worker_threads, AsyncLocalStorage, plugin server SDK
 * @index_tags plugins,worker,rpc,lifecycle
 * @author holic512
 */
import { parentPort, workerData } from 'node:worker_threads'
import { AsyncLocalStorage } from 'node:async_hooks'
import { pathToFileURL } from 'node:url'
import { createPluginContext } from '../plugins/sdk/src/server'
import type { PluginServer } from '../plugins/sdk/src/server'

const port = parentPort!
const invocation = new AsyncLocalStorage<string>()
let sequence = 0
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
const call = (method: string, payload?: unknown) => new Promise<unknown>((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  port.postMessage({ type: 'host', id, invocationId: invocation.getStore() ?? 'boot', method, payload })
})
const context = createPluginContext(workerData, call)
let plugin: PluginServer
port.on('message', async message => {
  if (message.type === 'host-result') {
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    if (message.error) {
      const error = Object.assign(new Error(message.error.message), { status: message.error.status, code: message.error.code })
      item.reject(error)
    } else {
      item.resolve(message.value)
    }
    return
  }
  if (message.type !== 'invoke') return
  await invocation.run(message.id, async () => {
    try {
      let value: unknown
      if (message.group === 'lifecycle') {
        const handler = plugin[message.key as keyof PluginServer]
        if (typeof handler === 'function') value = await (handler as () => Promise<void>)()
      } else {
        const handlers = plugin[message.group as 'mcp' | 'api' | 'services' | 'events' | 'jobs' | 'migrations']
        const handler = handlers?.[message.key]
        if (!handler) throw Object.assign(new Error('Plugin handler is not registered'), { status: 404 })
        value = message.group === 'jobs'
          ? await (handler as (task: unknown) => Promise<unknown>)(message.task)
          : await (handler as (input: unknown, task: unknown) => Promise<unknown>)(message.input, message.task)
      }
      port.postMessage({ type: 'result', id: message.id, value })
    } catch (error) {
      port.postMessage({
        type: 'result',
        id: message.id,
        error: {
          message: error instanceof Error ? error.message : 'Plugin execution failed',
          status: (error as { status?: number }).status ?? 500,
        },
      })
    }
  })
})
try {
  const loaded = await import(/* webpackIgnore: true */ pathToFileURL(workerData.entry).href)
  if (typeof loaded.default !== 'function') throw new Error('Plugin must export a default SDK factory')
  plugin = await loaded.default(context)
  if (!plugin || typeof plugin !== 'object') throw new Error('Plugin factory must return handlers')
  for (const [group, keys] of Object.entries({
    mcp: (workerData.manifest.mcp ?? []).map((a: { key: string }) => a.key),
    api: workerData.manifest.api.map((a: { key: string }) => a.key),
    services: workerData.manifest.services,
    events: workerData.manifest.events,
    jobs: workerData.manifest.jobs.map((a: { key: string }) => a.key),
    migrations: workerData.manifest.migrations,
  })) {
    const handlers = plugin[group as 'mcp' | 'api' | 'services' | 'events' | 'jobs' | 'migrations']
    if ((keys as string[]).some(key => typeof handlers?.[key] !== 'function')) {
      throw new Error('Declared plugin handler is missing')
    }
  }
  port.postMessage({ type: 'ready' })
} catch { port.postMessage({ type: 'fatal', error: 'PLUGIN_ACTIVATION_FAILED' }) }
