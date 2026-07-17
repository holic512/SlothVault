/**
 * @file maintenance-lock.ts
 * @project SlothVault
 * @module Application State Coordination
 * @description Coordinates normal reads and state-changing API work inside one Next.js server process.
 * @logic Admit concurrent readers, serialize writers fairly, and expose an explicit release handle so streamed backups can retain their lock until the response body closes.
 * @dependencies JavaScript promises and the process-wide global object
 * @index_tags maintenance,read-write-lock,backup,restore,concurrency
 * @author holic512
 */
import 'server-only'

export type MaintenanceLockMode = 'shared' | 'exclusive'

type ReleaseLock = () => void

type LockWaiter = {
  mode: MaintenanceLockMode
  resolve: (release: ReleaseLock) => void
}

class MaintenanceLock {
  private activeReaders = 0
  private writerActive = false
  private readonly queue: LockWaiter[] = []

  acquire(mode: MaintenanceLockMode): Promise<ReleaseLock> {
    return new Promise((resolve) => {
      this.queue.push({ mode, resolve })
      this.drain()
    })
  }

  private drain() {
    if (this.writerActive) return

    const first = this.queue[0]
    if (!first) return

    if (first.mode === 'exclusive') {
      if (this.activeReaders > 0) return
      this.queue.shift()
      this.writerActive = true
      let released = false
      first.resolve(() => {
        if (released) return
        released = true
        this.writerActive = false
        this.drain()
      })
      return
    }

    while (this.queue[0]?.mode === 'shared') {
      const reader = this.queue.shift()
      if (!reader) break
      this.activeReaders += 1
      let released = false
      reader.resolve(() => {
        if (released) return
        released = true
        this.activeReaders -= 1
        this.drain()
      })
    }
  }
}

const globalForMaintenanceLock = globalThis as unknown as {
  slothVaultMaintenanceLock?: MaintenanceLock
}

const maintenanceLock =
  globalForMaintenanceLock.slothVaultMaintenanceLock ?? new MaintenanceLock()

globalForMaintenanceLock.slothVaultMaintenanceLock = maintenanceLock

export function acquireMaintenanceLock(mode: MaintenanceLockMode) {
  return maintenanceLock.acquire(mode)
}

export async function withMaintenanceLock<T>(
  mode: MaintenanceLockMode,
  operation: () => Promise<T>,
) {
  const release = await acquireMaintenanceLock(mode)
  try {
    return await operation()
  } finally {
    release()
  }
}
