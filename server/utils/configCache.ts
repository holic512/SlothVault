/**
 * 系统配置缓存服务
 *
 * 提供内存缓存 + 数据库查询的配置管理
 * 支持手动刷新缓存，避免频繁数据库查询
 *
 * 配置完全存储在数据库中，不依赖环境变量
 */

import { prisma } from './prisma'

// 配置键常量
export const CONFIG_KEYS = {
  // Solana 配置
  SOLANA_RPC_URL: 'SOLANA_RPC_URL',
  SOLANA_DEVNET_RPC_URL: 'SOLANA_DEVNET_RPC_URL',
  // Filebase IPFS 配置
  FILEBASE_ACCESS_KEY: 'FILEBASE_ACCESS_KEY',
  FILEBASE_SECRET_KEY: 'FILEBASE_SECRET_KEY',
  FILEBASE_BUCKET: 'FILEBASE_BUCKET',
  FILEBASE_ENDPOINT: 'FILEBASE_ENDPOINT',
} as const

export type ConfigKey = typeof CONFIG_KEYS[keyof typeof CONFIG_KEYS]

// 配置项描述（用于管理界面）
export const CONFIG_DESCRIPTIONS: Record<ConfigKey, { description: string; defaultValue: string }> = {
  [CONFIG_KEYS.SOLANA_RPC_URL]: {
    description: 'Solana 主网 RPC URL (如 Helius)',
    defaultValue: '',
  },
  [CONFIG_KEYS.SOLANA_DEVNET_RPC_URL]: {
    description: 'Solana 测试网 RPC URL',
    defaultValue: '',
  },
  [CONFIG_KEYS.FILEBASE_ACCESS_KEY]: {
    description: 'Filebase IPFS Access Key',
    defaultValue: '',
  },
  [CONFIG_KEYS.FILEBASE_SECRET_KEY]: {
    description: 'Filebase IPFS Secret Key',
    defaultValue: '',
  },
  [CONFIG_KEYS.FILEBASE_BUCKET]: {
    description: 'Filebase Bucket 名称',
    defaultValue: '',
  },
  [CONFIG_KEYS.FILEBASE_ENDPOINT]: {
    description: 'Filebase S3 端点',
    defaultValue: 'https://s3.filebase.com',
  },
}

// 配置分组（用于管理界面展示）
export const CONFIG_GROUPS = {
  solana: {
    label: 'Solana 配置',
    keys: [CONFIG_KEYS.SOLANA_RPC_URL, CONFIG_KEYS.SOLANA_DEVNET_RPC_URL],
  },
  filebase: {
    label: 'Filebase IPFS 配置',
    keys: [
      CONFIG_KEYS.FILEBASE_ACCESS_KEY,
      CONFIG_KEYS.FILEBASE_SECRET_KEY,
      CONFIG_KEYS.FILEBASE_BUCKET,
      CONFIG_KEYS.FILEBASE_ENDPOINT,
    ],
  },
} as const

// 内存缓存
interface CacheEntry {
  value: string
  loadedAt: number
}

const configCache = new Map<string, CacheEntry>()

// 缓存过期时间（毫秒），默认 5 分钟
const CACHE_TTL = 5 * 60 * 1000

// 缓存是否已初始化
let cacheInitialized = false

/**
 * 从数据库加载单个配置
 */
async function loadConfigFromDb(key: string): Promise<string | null> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { configKey: key },
    })
    return config?.configValue ?? null
  } catch (error) {
    console.error(`[ConfigCache] Failed to load config "${key}" from database:`, error)
    return null
  }
}

/**
 * 从数据库加载所有配置到缓存
 */
async function loadAllConfigsFromDb(): Promise<void> {
  try {
    const configs = await prisma.systemConfig.findMany()
    const now = Date.now()

    for (const config of configs) {
      configCache.set(config.configKey, {
        value: config.configValue,
        loadedAt: now,
      })
    }

    cacheInitialized = true
    console.log(`[ConfigCache] Loaded ${configs.length} configs from database`)
  } catch (error) {
    console.error('[ConfigCache] Failed to load configs from database:', error)
  }
}

/**
 * 获取配置值
 *
 * 优先级：内存缓存 > 数据库 > 默认值
 *
 * @param key 配置键
 * @returns 配置值
 */
export async function getConfig(key: ConfigKey): Promise<string> {
  // 1. 检查内存缓存
  const cached = configCache.get(key)
  const now = Date.now()

  if (cached && (now - cached.loadedAt) < CACHE_TTL) {
    return cached.value
  }

  // 2. 从数据库加载
  const dbValue = await loadConfigFromDb(key)

  if (dbValue !== null) {
    configCache.set(key, { value: dbValue, loadedAt: now })
    return dbValue
  }

  // 3. 返回默认值
  return CONFIG_DESCRIPTIONS[key]?.defaultValue ?? ''
}

/**
 * 批量获取配置值
 */
export async function getConfigs(keys: ConfigKey[]): Promise<Record<ConfigKey, string>> {
  const result: Record<string, string> = {}

  for (const key of keys) {
    result[key] = await getConfig(key)
  }

  return result as Record<ConfigKey, string>
}

/**
 * 获取所有配置（用于管理界面）
 */
export async function getAllConfigs(): Promise<Array<{
  key: ConfigKey
  value: string
  description: string
  defaultValue: string
}>> {
  const allKeys = Object.values(CONFIG_KEYS)
  const result: Array<{
    key: ConfigKey
    value: string
    description: string
    defaultValue: string
  }> = []

  for (const key of allKeys) {
    const value = await getConfig(key)
    const meta = CONFIG_DESCRIPTIONS[key]

    result.push({
      key,
      value,
      description: meta?.description ?? '',
      defaultValue: meta?.defaultValue ?? '',
    })
  }

  return result
}

/**
 * 设置配置值（写入数据库并更新缓存）
 */
export async function setConfig(key: ConfigKey, value: string): Promise<void> {
  const meta = CONFIG_DESCRIPTIONS[key]

  await prisma.systemConfig.upsert({
    where: { configKey: key },
    update: {
      configValue: value,
      updatedAt: new Date(),
    },
    create: {
      configKey: key,
      configValue: value,
      description: meta?.description ?? null,
    },
  })

  // 更新缓存
  configCache.set(key, { value, loadedAt: Date.now() })
}

/**
 * 批量设置配置值
 */
export async function setConfigs(configs: Array<{ key: ConfigKey; value: string }>): Promise<void> {
  for (const { key, value } of configs) {
    await setConfig(key, value)
  }
}

/**
 * 刷新缓存（清除内存缓存，强制从数据库重新加载）
 */
export function refreshCache(): void {
  configCache.clear()
  cacheInitialized = false
  console.log('[ConfigCache] Cache cleared')
}

/**
 * 预热缓存（启动时调用）
 */
export async function warmupCache(): Promise<void> {
  if (!cacheInitialized) {
    await loadAllConfigsFromDb()
  }
}

// ============ 便捷方法 ============

/**
 * 获取 Solana 主网 RPC URL
 */
export async function getSolanaRpcUrl(): Promise<string> {
  return getConfig(CONFIG_KEYS.SOLANA_RPC_URL)
}

/**
 * 获取 Solana 测试网 RPC URL
 */
export async function getSolanaDevnetRpcUrl(): Promise<string> {
  return getConfig(CONFIG_KEYS.SOLANA_DEVNET_RPC_URL)
}

/**
 * 获取 Filebase 配置
 */
export async function getFilebaseConfig(): Promise<{
  accessKey: string
  secretKey: string
  bucket: string
  endpoint: string
}> {
  const [accessKey, secretKey, bucket, endpoint] = await Promise.all([
    getConfig(CONFIG_KEYS.FILEBASE_ACCESS_KEY),
    getConfig(CONFIG_KEYS.FILEBASE_SECRET_KEY),
    getConfig(CONFIG_KEYS.FILEBASE_BUCKET),
    getConfig(CONFIG_KEYS.FILEBASE_ENDPOINT),
  ])

  return { accessKey, secretKey, bucket, endpoint }
}
