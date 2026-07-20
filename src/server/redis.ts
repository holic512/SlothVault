/**
 * @file redis.ts
 * @project SlothVault
 * @module Redis Runtime
 * @description Provides the shared Redis connection used for short-lived authentication state and abuse controls.
 * @logic Lazily connect one node-redis client, namespace every key, expose atomic challenge storage/consumption, and fail security-sensitive operations closed when Redis is unavailable.
 * @dependencies redis 6.1.0, server/http/errors
 * @index_tags redis,cache,rate-limit,authentication,challenge
 * @author holic512
 */
import 'server-only'

import { createClient } from 'redis'

import { HttpError } from '@/server/http/errors'

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379'
const DEFAULT_KEY_PREFIX = 'slothvault'

function createRedisClient() {
  const client = createClient({
    url: process.env.REDIS_URL?.trim() || DEFAULT_REDIS_URL,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: (retries) => Math.min(200 * 2 ** retries, 3_000),
    },
  })
  client.on('error', (error) => {
    console.error('[redis] connection error', error instanceof Error ? error.message : 'unknown error')
  })
  return client
}

type RedisClient = ReturnType<typeof createRedisClient>

const globalForRedis = globalThis as unknown as {
  slothVaultRedis?: RedisClient
  slothVaultRedisConnect?: Promise<RedisClient>
}

export function redisKey(...segments: Array<string | number>) {
  const prefix = process.env.REDIS_PREFIX?.trim() || DEFAULT_KEY_PREFIX
  return [prefix, ...segments].map((segment) => String(segment)).join(':')
}

export async function getRedisClient() {
  const client = globalForRedis.slothVaultRedis ?? createRedisClient()
  globalForRedis.slothVaultRedis = client
  if (client.isReady) return client

  if (!globalForRedis.slothVaultRedisConnect) {
    globalForRedis.slothVaultRedisConnect = (client.isOpen
      ? Promise.resolve(client)
      : client.connect().then(() => client)
    ).finally(() => {
      globalForRedis.slothVaultRedisConnect = undefined
    })
  }

  try {
    return await globalForRedis.slothVaultRedisConnect
  } catch {
    throw new HttpError('Authentication service is temporarily unavailable', 503, 5034)
  }
}

export async function storeEphemeralJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  const redis = await getRedisClient()
  const result = await redis.set(key, JSON.stringify(value), {
    expiration: { type: 'EX', value: ttlSeconds },
    condition: 'NX',
  })
  return result === 'OK'
}

export async function consumeEphemeralJson<T>(key: string): Promise<T | null> {
  const redis = await getRedisClient()
  const raw = await redis.getDel(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function enforceRateLimit(options: {
  scope: string
  identity: string
  limit: number
  windowSeconds: number
}) {
  const redis = await getRedisClient()
  const key = redisKey('rate', options.scope, options.identity)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, options.windowSeconds)
  if (count <= options.limit) return

  const retryAfter = Math.max(await redis.ttl(key), 1)
  throw new HttpError('Too many requests', 429, 429, { retryAfter })
}

export async function closeRedisForTests() {
  const client = globalForRedis.slothVaultRedis
  globalForRedis.slothVaultRedis = undefined
  globalForRedis.slothVaultRedisConnect = undefined
  if (client?.isOpen) client.destroy()
}
