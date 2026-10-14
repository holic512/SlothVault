/**
 * @file telemetry-worker.mjs
 * @project SlothVault
 * @module Telemetry Worker Boundary
 * @description Serializes independent telemetry database operations off the HTTP event loop.
 * @logic Open the private store once, acknowledge idempotent batches and bounded queries, and return only sanitized failure codes.
 * @dependencies node:worker_threads, telemetry-store
 * @index_tags telemetry,worker,sqlite,fault-isolation
 * @author holic512
 */
import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { TelemetryStore } from './telemetry-store.mjs'
let store
try {
  store = new TelemetryStore(workerData.file)
  try { const marker = JSON.parse(readFileSync(resolve(dirname(workerData.file), 'epoch.json'), 'utf8')); if (/^[a-f0-9-]{36}$/.test(marker.epoch) && marker.epoch !== store.epoch && marker.startedAt >= store.metadata().epochStartedAt) store.rotate(marker.startedAt, marker.epoch, marker.sourceGeneration) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  parentPort.postMessage({type:'ready',metadata:store.metadata()})
}
catch { parentPort.postMessage({type:'fatal',error:'TELEMETRY_STORAGE_UNAVAILABLE'}) }
parentPort.on('message',message=>{
  if(!store) return
  try {
    let data
    if(message.type==='batch') data=message.batch.epoch===store.epoch ? store.apply(message.batch) : store.metadata()
    else if(message.type==='rotate') data=store.rotate(message.startedAt,message.epoch,message.sourceGeneration)
    else if(message.type==='query') {
      const {operation,input}=message
      if(operation==='analytics') data=store.analytics(input.range,Date.now(),input.key,input.kind,input.sort)
      else if(operation==='observability') data=store.observability(input.range)
      else if(operation==='samples') data=store.samples(input)
      else throw new Error('Unknown query')
    } else throw new Error('Unknown operation')
    parentPort.postMessage({type:'result',id:message.id,data})
  } catch {parentPort.postMessage({type:'failure',id:message.id,error:'TELEMETRY_OPERATION_FAILED'})}
})
