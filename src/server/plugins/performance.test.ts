import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { pluginRegistry } from './state'
import { enqueuePluginEvent } from './events'

describe('plugin hot-path scaling (synthetic, not production throughput)', () => {
  it('does no DB or worker work for zero subscribers at 0, 10 and 100 registered plugins', async () => {
    const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync('plugins/example/plugin.json', 'utf8')))
    const task = { createMany: vi.fn() }, metrics: { plugins: number; meanMs: number }[] = []
    try {
      for (const count of [0, 10, 100]) {
        pluginRegistry.clear()
        for (let i = 0; i < count; i++) pluginRegistry.set(`benchmark.plugin-${i}`, { manifest: { ...manifest, id: `benchmark.plugin-${i}` }, installed: true, enabled: true, generation: 1, digest: 'a'.repeat(64), configCiphertext: '' })
        const started = performance.now()
        for (let i = 0; i < 10000; i++) await enqueuePluginEvent({ pluginTask: task } as never, 'no.subscribers', { id: 1 })
        metrics.push({ plugins: count, meanMs: (performance.now() - started) / 10000 })
      }
      expect(task.createMany).not.toHaveBeenCalled()
      console.info('[plugin-local-benchmark]', JSON.stringify({ metrics, workerBytes: statSync('generated/plugin-runtime/worker.mjs').size, compilerBytes: statSync('generated/plugin-runtime/compiler.mjs').size, scope: 'single-process metadata/outbox benchmark; no HTTP or browser timing baseline' }))
    } finally { pluginRegistry.clear() }
  })
})
