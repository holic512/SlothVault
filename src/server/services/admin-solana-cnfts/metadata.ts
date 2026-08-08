/**
 * @file metadata.ts
 * @project SlothVault
 * @module Solana cNFT Metadata
 * @description Builds optional Filebase image and metadata uploads from controlled project avatars.
 * @logic Resolve and validate a stored avatar, transform it to bounded WebP, upload image and metadata, and compensate partial uploads.
 * @dependencies admin file storage, Filebase, Sharp
 * @index_tags admin,solana,cnft,filebase,metadata,image
 * @author holic512
 */
import 'server-only'

import sharp from 'sharp'

import { HttpError } from '@/server/http/errors'
import {
  inspectPublicUpload,
  readPublicUpload,
} from '@/server/services/admin-files'
import {
  deleteFilebaseObject,
  uploadImageToFilebase,
  uploadMetadataToFilebase,
  type FilebaseUploadResult,
} from '@/server/services/filebase'

export async function cleanupFilebaseUploads(keys: string[]) {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await deleteFilebaseObject(key)
      } catch (error) {
        console.error('[solana-cnft] Unable to compensate Filebase upload', error)
      }
    }),
  )
}

function avatarSegments(avatar: string) {
  const normalized = avatar.startsWith('/') ? avatar.slice(1) : avatar
  if (!normalized.startsWith('uploads/')) return null
  const segments = normalized.slice('uploads/'.length).split('/')
  return segments.length > 0 ? segments : null
}

export async function uploadProjectAvatarMetadata(options: {
  avatar: string
  name: string
  symbol: string
  description: string
  creatorAddress: string
}) {
  const segments = avatarSegments(options.avatar)
  if (!segments) return null
  const inspected = await inspectPublicUpload(segments)
  if (inspected.stats.size > 5 * 1024 * 1024) {
    throw new HttpError('Project avatar is too large for cNFT metadata', 400, 400)
  }
  const original = await readPublicUpload(inspected.absolutePath)
  const image = await sharp(original, {
    failOn: 'warning',
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .flatten({ background: { r: 15, g: 23, b: 42 } })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, effort: 4 })
    .toBuffer()

  let imageUpload: FilebaseUploadResult | null = null
  try {
    imageUpload = await uploadImageToFilebase(image, 'webp', 'image/webp')
    const metadata = {
      name: options.name,
      symbol: options.symbol,
      description: options.description,
      image: imageUpload.ipfsUri,
      properties: {
        category: 'image',
        files: [{ uri: imageUpload.ipfsUri, type: 'image/webp' }],
        creators: [{ address: options.creatorAddress, share: 100 }],
      },
    }
    const metadataUpload = await uploadMetadataToFilebase(metadata)
    return { imageUpload, metadataUpload, filePath: `uploads/${segments.join('/')}` }
  } catch (error) {
    if (imageUpload) await cleanupFilebaseUploads([imageUpload.key])
    throw error
  }
}
