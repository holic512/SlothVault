/**
 * @file plugin-compiler.mjs
 * @project SlothVault
 * @module Plugin Compiler Worker
 * @description Compiles source packages outside the application's main event loop.
 * @logic Accept host-validated paths, compile with a fixed pipeline, and return only bounded diagnostics.
 * @dependencies worker_threads, plugin-bundler
 * @index_tags plugins,compiler,worker
 * @author holic512
 */
import { parentPort, workerData } from 'node:worker_threads'
import { compilePlugin } from './plugin-bundler.mjs'
try {
  await compilePlugin(workerData.directory, workerData.output, workerData.manifest, workerData.sdk)
  parentPort.postMessage({ ok: true })
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error.message).replaceAll(workerData.directory, '<plugin>').replaceAll(workerData.sdk, '<sdk>').slice(0, 1500) })
}
