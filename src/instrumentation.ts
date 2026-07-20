/**
 * @file instrumentation.ts
 * @project SlothVault
 * @module Server Bootstrap
 * @description Runs Node-only persistence bootstrap before a Next.js server accepts requests.
 * @logic Dynamically load Node runtime initialization, generate the persistent master key, and acquire the SQLite instance lock without requiring a database during first deployment.
 * @dependencies Next.js instrumentation, instrumentation-node
 * @index_tags nextjs,instrumentation,startup,sqlite,master-key
 * @author holic512
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeNodeRuntime } = await import('./instrumentation-node')
    await initializeNodeRuntime()
  }
}
