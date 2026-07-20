import { spawn } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { waitForMigrationProcessExit } from '@/server/database/migrations'

describe('migration subprocess timeout', () => {
  it('waits for forced termination before reporting a timeout', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject)
      child.stdout.once('data', () => resolveReady())
    })

    const startedAt = Date.now()
    await expect(
      waitForMigrationProcessExit(child, {
        timeoutMs: 40,
        terminationGraceMs: 60,
      }),
    ).rejects.toThrow('Database initialization timed out')

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(85)
    expect(child.signalCode).toBe('SIGKILL')
  })
})
