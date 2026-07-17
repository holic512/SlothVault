/**
 * @file filebase.ts
 * @project SlothVault
 * @module Filebase IPFS Storage
 * @description Uploads optional cNFT media and metadata through Filebase's S3-compatible API using current database configuration.
 * @logic Read configuration for every operation, create an isolated S3 client, obtain the IPFS CID from object metadata, and expose compensating deletion for failed prepare flows.
 * @dependencies @aws-sdk/client-s3, Prisma SystemConfig via system-config
 * @index_tags filebase,ipfs,s3,cnft,metadata,compensation
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { HttpError } from '@/server/http/errors'
import {
  CONFIG_KEYS,
  getConfigValue,
} from '@/server/services/system-config'

type FilebaseRuntimeConfig = {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export type FilebaseUploadResult = {
  cid: string
  ipfsUri: string
  gatewayUrl: string
  key: string
}

async function runtimeConfig(): Promise<FilebaseRuntimeConfig> {
  const [storedEndpoint, storedAccessKey, storedSecretKey, storedBucket] = await Promise.all([
    getConfigValue(CONFIG_KEYS.FILEBASE_ENDPOINT),
    getConfigValue(CONFIG_KEYS.FILEBASE_ACCESS_KEY),
    getConfigValue(CONFIG_KEYS.FILEBASE_SECRET_KEY),
    getConfigValue(CONFIG_KEYS.FILEBASE_BUCKET),
  ])
  return {
    endpoint:
      storedEndpoint || process.env.FILEBASE_ENDPOINT || 'https://s3.filebase.com',
    accessKeyId: storedAccessKey || process.env.FILEBASE_ACCESS_KEY || '',
    secretAccessKey: storedSecretKey || process.env.FILEBASE_SECRET_KEY || '',
    bucket: storedBucket || process.env.FILEBASE_BUCKET || '',
  }
}

function clientFor(config: FilebaseRuntimeConfig) {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    throw new HttpError('Filebase is not fully configured', 400, 400)
  }
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint)
  } catch {
    throw new HttpError('Filebase endpoint is invalid', 500, 500)
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new HttpError('Filebase endpoint must use HTTP(S)', 500, 500)
  }
  return new S3Client({
    endpoint: endpoint.toString(),
    region: 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  })
}

export async function isFilebaseConfigured() {
  const config = await runtimeConfig()
  return Boolean(config.accessKeyId && config.secretAccessKey && config.bucket)
}

export async function uploadToFilebase(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<FilebaseUploadResult> {
  const config = await runtimeConfig()
  const client = clientFor(config)
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )
  const head = await client.send(
    new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
  )
  const cid = head.Metadata?.cid
  if (!cid || !/^[a-zA-Z0-9]+$/.test(cid)) {
    throw new HttpError('Filebase did not return an IPFS CID', 502, 502)
  }
  return {
    cid,
    ipfsUri: `ipfs://${cid}`,
    gatewayUrl: `https://ipfs.filebase.io/ipfs/${cid}`,
    key,
  }
}

export function uploadImageToFilebase(
  buffer: Buffer,
  extension: string,
  contentType: string,
) {
  const safeExtension = /^[a-z0-9]+$/.test(extension) ? extension : 'bin'
  return uploadToFilebase(
    buffer,
    `images/${randomUUID()}.${safeExtension}`,
    contentType,
  )
}

export function uploadMetadataToFilebase(metadata: Record<string, unknown>) {
  const buffer = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
  return uploadToFilebase(
    buffer,
    `metadata/${randomUUID()}.json`,
    'application/json',
  )
}

export async function deleteFilebaseObject(key: string) {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) return
  const config = await runtimeConfig()
  const client = clientFor(config)
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
}

