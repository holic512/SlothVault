/**
 * Filebase IPFS 存储工具模块
 *
 * 使用 S3 兼容 API 将文件上传到 Filebase（IPFS 存储）
 * 上传后自动 Pin 到 IPFS 网络，返回 CID
 *
 * 配置来源：数据库 SystemConfig 表（通过 configCache 服务）
 * 回退：环境变量
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getFilebaseConfig } from './configCache'

// Filebase 配置缓存（运行时）
interface FilebaseRuntimeConfig {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

// S3 客户端实例（延迟初始化）
let s3Client: S3Client | null = null
let currentConfig: FilebaseRuntimeConfig | null = null

/**
 * 获取 Filebase 运行时配置
 */
async function getFilebaseRuntimeConfig(): Promise<FilebaseRuntimeConfig> {
  const config = await getFilebaseConfig()
  return {
    endpoint: config.endpoint || 'https://s3.filebase.com',
    accessKeyId: config.accessKey,
    secretAccessKey: config.secretKey,
    bucket: config.bucket,
  }
}

/**
 * 获取 S3 客户端实例（异步）
 */
async function getS3ClientAsync(): Promise<{ client: S3Client; bucket: string }> {
  const config = await getFilebaseRuntimeConfig()

  // 检查配置是否变化，如果变化则重新创建客户端
  if (
    !s3Client ||
    !currentConfig ||
    currentConfig.endpoint !== config.endpoint ||
    currentConfig.accessKeyId !== config.accessKeyId ||
    currentConfig.secretAccessKey !== config.secretAccessKey
  ) {
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error('Filebase 配置缺失，请在系统设置中配置 FILEBASE_ACCESS_KEY 和 FILEBASE_SECRET_KEY')
    }

    s3Client = new S3Client({
      endpoint: config.endpoint,
      region: 'us-east-1', // Filebase 使用固定 region
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Filebase 需要 path-style
    })
    currentConfig = config
  }

  return { client: s3Client, bucket: config.bucket }
}

/**
 * 重置 S3 客户端（配置更新后调用）
 */
export function resetFilebaseClient(): void {
  s3Client = null
  currentConfig = null
}

/**
 * 检查 Filebase 配置是否完整（异步）
 */
export async function isFilebaseConfigured(): Promise<boolean> {
  const config = await getFilebaseRuntimeConfig()
  return !!(
    config.accessKeyId &&
    config.secretAccessKey &&
    config.bucket
  )
}

/**
 * 上传结果
 */
export interface FilebaseUploadResult {
  /** IPFS CID */
  cid: string
  /** 完整的 IPFS URI (ipfs://CID) */
  ipfsUri: string
  /** IPFS 网关 URL */
  gatewayUrl: string
  /** 文件在 S3 中的 Key */
  key: string
}

/**
 * 上传文件到 Filebase
 *
 * @param buffer - 文件内容 Buffer
 * @param key - 文件名/路径（在 bucket 中的 key）
 * @param contentType - MIME 类型
 * @returns 上传结果，包含 CID 和 URI
 */
export async function uploadToFilebase(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<FilebaseUploadResult> {
  const { client, bucket } = await getS3ClientAsync()

  if (!bucket) {
    throw new Error('Filebase bucket 未配置，请在系统设置中配置 FILEBASE_BUCKET')
  }

  // 上传文件
  const putCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  })

  await client.send(putCommand)

  // 获取 CID（Filebase 在 HeadObject 的 Metadata 中返回）
  const headCommand = new HeadObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const headResponse = await client.send(headCommand)

  // Filebase 将 CID 存储在 x-amz-meta-cid 或 Metadata.cid 中
  const cid = headResponse.Metadata?.cid

  if (!cid) {
    throw new Error('无法获取 IPFS CID，请检查 Filebase 配置')
  }

  return {
    cid,
    ipfsUri: `ipfs://${cid}`,
    gatewayUrl: `https://ipfs.filebase.io/ipfs/${cid}`,
    key,
  }
}

/**
 * 上传图片到 Filebase
 *
 * @param buffer - 图片 Buffer
 * @param fileName - 文件名
 * @param mimeType - MIME 类型（如 image/png, image/webp）
 * @returns 上传结果
 */
export async function uploadImageToFilebase(
  buffer: Buffer,
  fileName: string,
  mimeType: string = 'image/png'
): Promise<FilebaseUploadResult> {
  // 使用时间戳 + 文件名作为 key，避免冲突
  const key = `images/${Date.now()}_${fileName}`
  return uploadToFilebase(buffer, key, mimeType)
}

/**
 * 上传 JSON 元数据到 Filebase
 *
 * @param metadata - 元数据对象
 * @param fileName - 文件名
 * @returns 上传结果
 */
export async function uploadMetadataToFilebase(
  metadata: Record<string, any>,
  fileName: string
): Promise<FilebaseUploadResult> {
  const jsonBuffer = Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8')
  const key = `metadata/${Date.now()}_${fileName}`
  return uploadToFilebase(jsonBuffer, key, 'application/json')
}
