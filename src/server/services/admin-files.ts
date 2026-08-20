/**
 * @file admin-files.ts
 * @project SlothVault
 * @module Admin File Storage
 * @description Owns managed-file queries, safe upload validation, stable DTOs, contained storage access, and compensating deletion workflows.
 * @logic Build provider-portable metadata filters, validate every multipart file before disk writes, persist metadata atomically, constrain physical paths to the upload root, and stage hard deletes until the database delete succeeds.
 * @dependencies node:fs/promises, node:path, sharp, Prisma FileManagement model, server/http/errors
 * @index_tags admin,files,upload,filesystem,containment,sharp,transaction,hard-delete
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'

import sharp from 'sharp'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { databaseTextContains, hasPrismaCode } from '@/server/services/admin-catalog'

export const GENERAL_FILE_MAX_BYTES = 10 * 1024 * 1024
export const AVATAR_FILE_MAX_BYTES = 2 * 1024 * 1024
export const REQUEST_FILE_MAX_COUNT = 10
export const REQUEST_FILES_MAX_BYTES = 20 * 1024 * 1024
export const REQUEST_CONTENT_LENGTH_MAX_BYTES = 25 * 1024 * 1024

const configuredUploadRoot = process.env.UPLOAD_STORAGE_PATH?.trim()
export const UPLOAD_ROOT = configuredUploadRoot
  ? resolve(/* turbopackIgnore: true */ process.cwd(), configuredUploadRoot)
  : resolve(/* turbopackIgnore: true */ process.cwd(), 'data', 'uploads')
const TRASH_DIRECTORY = '.trash'
const IMAGE_PIXEL_LIMIT = 40_000_000

export const BUSINESS_TYPE_CONFIG = {
  SystemLogo: { dir: 'system-logo', imagesOnly: true },
  ProjectAvatar: { dir: 'project-avatar', imagesOnly: true },
  UserAvatar: { dir: 'user-avatar', imagesOnly: true },
  ArticleCover: { dir: 'article-cover', imagesOnly: true },
  ArticleAttachment: { dir: 'article-attachment', imagesOnly: true },
  NoteAttachment: { dir: 'note-attachment', imagesOnly: false },
  HomeworkFile: { dir: 'homework', imagesOnly: false },
  ContractAttachment: { dir: 'contract-attachment', imagesOnly: false },
  Markdown: { dir: 'markdown', imagesOnly: true },
  TempFile: { dir: 'temp', imagesOnly: false },
  Other: { dir: 'other', imagesOnly: false },
} as const

export type BusinessType = keyof typeof BUSINESS_TYPE_CONFIG

export const VALID_BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_CONFIG) as BusinessType[]

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const SAFE_FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  'pdf',
  'txt',
  'md',
  'json',
  'zip',
  'docx',
  'xlsx',
  'pptx',
])

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

type FileRecordLike = {
  id: number
  originalName: string
  fileName: string
  filePath: string
  fileSize: bigint
  businessType: string
  status: number
  createTime: Date
}

type PreparedUpload = {
  originalName: string
  fileName: string
  filePath: string
  absolutePath: string
  buffer: Buffer
}

export type UploadFilesOptions = {
  businessType: BusinessType
  maxFiles?: number
}

function nodeErrorHasCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

function assertContained(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  const isWithinRoot =
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))

  if (!isWithinRoot) throw new HttpError('Access denied', 403, 403)
  return candidate
}

function resolveWithinUploads(...segments: string[]) {
  return assertContained(UPLOAD_ROOT, resolve(UPLOAD_ROOT, ...segments))
}

function resolveStoredUploadPath(filePath: string) {
  if (
    !filePath ||
    filePath.includes('\0') ||
    filePath.includes('\\') ||
    !filePath.startsWith('uploads/')
  ) {
    throw new HttpError('Access denied', 403, 403)
  }

  const storagePath = filePath.slice('uploads/'.length)
  const segments = storagePath.split('/')
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
  ) {
    throw new HttpError('Access denied', 403, 403)
  }
  return resolveWithinUploads(...segments)
}

function decodePublicSegment(rawSegment: string) {
  let segment = rawSegment
  for (let index = 0; index < 3; index += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new HttpError('Access denied', 403, 403)
    }
    if (decoded === segment) break
    segment = decoded
  }

  if (
    !segment ||
    segment.includes('\0') ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment === '.' ||
    segment === '..' ||
    segment.startsWith('.')
  ) {
    throw new HttpError('Access denied', 403, 403)
  }
  return segment
}

function sanitizedOriginalName(rawName: string) {
  const originalName = basename(rawName.replaceAll('\\', '/'))
  if (
    !originalName ||
    originalName === '.' ||
    originalName === '..' ||
    originalName.includes('\0')
  ) {
    throw new HttpError('Invalid file name', 400, 400)
  }
  if (Array.from(originalName).length > 255) {
    throw new HttpError('File name exceeds 255 characters', 400, 400)
  }
  return originalName
}

function extensionOf(fileName: string) {
  return extname(fileName).slice(1).toLowerCase()
}

async function ensureContainedDirectory(directory: string) {
  await mkdir(UPLOAD_ROOT, { recursive: true })
  await mkdir(directory, { recursive: true })

  const [realUploadRoot, realDirectory] = await Promise.all([
    realpath(UPLOAD_ROOT),
    realpath(directory),
  ])
  assertContained(realUploadRoot, realDirectory)
}

async function validateImage(buffer: Buffer, extension: string, originalName: string) {
  const expectedFormat = extension === 'jpg' ? 'jpeg' : extension
  const options = {
    animated: true,
    failOn: 'warning' as const,
    limitInputPixels: IMAGE_PIXEL_LIMIT,
  }

  try {
    const metadata = await sharp(buffer, options).metadata()
    if (metadata.format !== expectedFormat) throw new Error('Image format mismatch')
    await sharp(buffer, options).toBuffer()
  } catch {
    throw new HttpError(`Invalid image file: ${originalName}`, 400, 400)
  }
}

function assertContentLength(request: Request) {
  const rawLength = request.headers.get('content-length')
  if (rawLength === null) return

  const contentLength = Number(rawLength)
  if (Number.isFinite(contentLength) && contentLength > REQUEST_CONTENT_LENGTH_MAX_BYTES) {
    throw new HttpError('Request body is too large', 413, 413)
  }
}

async function readMultipartFiles(request: Request, maxFiles: number) {
  assertContentLength(request)
  const contentType = request.headers.get('content-type')?.toLowerCase() || ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new HttpError('Expected multipart/form-data', 400, 400)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError('Invalid multipart form data', 400, 400)
  }

  const files = Array.from(formData.values()).filter(
    (entry): entry is File => typeof entry !== 'string',
  )
  if (files.length === 0) throw new HttpError('未检测到上传文件', 400, 400)
  if (files.length > maxFiles) {
    throw new HttpError(`A maximum of ${maxFiles} files is allowed`, 400, 400)
  }
  return files
}

async function prepareUploads(files: File[], businessType: BusinessType) {
  const config = BUSINESS_TYPE_CONFIG[businessType]
  const maxFileSize =
    businessType === 'SystemLogo' ||
    businessType === 'ProjectAvatar' ||
    businessType === 'UserAvatar'
      ? AVATAR_FILE_MAX_BYTES
      : GENERAL_FILE_MAX_BYTES
  let totalSize = 0
  const prepared: PreparedUpload[] = []

  for (const file of files) {
    const originalName = sanitizedOriginalName(file.name)
    if (file.size === 0) throw new HttpError(`File is empty: ${originalName}`, 400, 400)
    if (file.size > maxFileSize) {
      throw new HttpError(
        `文件 ${originalName} 超过最大限制 ${Math.round(maxFileSize / 1024 / 1024)}MB`,
        400,
        400,
      )
    }

    totalSize += file.size
    if (totalSize > REQUEST_FILES_MAX_BYTES) {
      throw new HttpError('Files exceed the 20MB request limit', 400, 400)
    }

    const extension = extensionOf(originalName)
    const allowedExtensions = config.imagesOnly ? IMAGE_EXTENSIONS : SAFE_FILE_EXTENSIONS
    if (!extension || !allowedExtensions.has(extension)) {
      throw new HttpError(`File type is not allowed: ${originalName}`, 400, 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length === 0) throw new HttpError(`File is empty: ${originalName}`, 400, 400)
    if (IMAGE_EXTENSIONS.has(extension)) {
      await validateImage(buffer, extension, originalName)
    }

    const fileName = `${randomUUID()}.${extension}`
    const filePath = `uploads/${config.dir}/${fileName}`
    prepared.push({
      originalName,
      fileName,
      filePath,
      absolutePath: resolveWithinUploads(config.dir, fileName),
      buffer,
    })
  }

  return prepared
}

async function cleanupFiles(paths: string[]) {
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await unlink(assertContained(UPLOAD_ROOT, filePath))
      } catch (error) {
        if (!nodeErrorHasCode(error, 'ENOENT')) {
          console.error('[files] Failed to remove compensated upload', error)
        }
      }
    }),
  )
}

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && Object.hasOwn(BUSINESS_TYPE_CONFIG, value)
}

export function fileDto(file: FileRecordLike) {
  return {
    id: file.id.toString(),
    originalName: file.originalName,
    fileName: file.fileName,
    filePath: file.filePath,
    fileSize: file.fileSize.toString(),
    businessType: file.businessType,
    status: file.status,
    createTime: file.createTime,
    url: file.businessType === 'ContractAttachment' ? null : `/${file.filePath}`,
  }
}

export function uploadedFileDto(file: FileRecordLike) {
  return {
    id: file.id.toString(),
    url: file.businessType === 'ContractAttachment' ? null : `/${file.filePath}`,
    originalName: file.originalName,
    fileName: file.fileName,
    filePath: file.filePath,
    fileSize: file.fileSize.toString(),
    businessType: file.businessType,
  }
}

export function avatarFileDto(file: FileRecordLike) {
  return {
    id: file.id.toString(),
    url: `/${file.filePath}`,
    originalName: file.originalName,
    fileName: file.fileName,
    filePath: file.filePath,
    fileSize: file.fileSize.toString(),
  }
}

type FileOrderField =
  | 'id'
  | 'originalName'
  | 'fileSize'
  | 'businessType'
  | 'createTime'

export type FileListQuery = {
  page: number
  pageSize: number
  skip: number
  keyword: string
  businessType?: string
  includeDeleted: boolean
  status?: number
  orderByField: FileOrderField
  order: 'asc' | 'desc'
}

export async function listAdminFiles(query: FileListQuery) {
  const where: Prisma.FileManagementWhereInput = {}
  if (!query.includeDeleted) where.status = 1
  else if (Number.isFinite(query.status)) where.status = query.status
  if (query.keyword) where.originalName = databaseTextContains(query.keyword)
  if (query.businessType) where.businessType = query.businessType

  const [total, list] = await Promise.all([
    prisma.fileManagement.count({ where }),
    prisma.fileManagement.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
    }),
  ])
  return {
    list: list.map(fileDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function getAdminFile(id: number) {
  const file = await prisma.fileManagement.findUnique({ where: { id } })
  if (!file) throw new HttpError('Not Found', 404, 404)
  return fileDto(file)
}

export async function readManagedFile(id: number) {
  const file = await prisma.fileManagement.findFirst({
    where: { id, status: 1 },
  })
  if (!file) throw new HttpError('Managed file not found', 404, 404)
  try {
    return {
      file,
      buffer: await readFile(resolveStoredUploadPath(file.filePath)),
    }
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) {
      throw new HttpError('Managed file content is missing', 409, 409)
    }
    throw error
  }
}

async function assertFileIsNotContractAttachment(id: number) {
  const contract = await prisma.contract.findUnique({
    where: { attachmentFileId: id },
    select: { contractId: true },
  })
  if (contract) {
    throw new HttpError('Contract attachments cannot be changed or deleted', 409, 409)
  }
}

export async function uploadFiles(request: Request, options: UploadFilesOptions) {
  const maxFiles = Math.min(
    REQUEST_FILE_MAX_COUNT,
    Math.max(1, options.maxFiles ?? REQUEST_FILE_MAX_COUNT),
  )
  const files = await readMultipartFiles(request, maxFiles)
  const prepared = await prepareUploads(files, options.businessType)
  const uploadDirectory = resolveWithinUploads(BUSINESS_TYPE_CONFIG[options.businessType].dir)
  const writtenPaths: string[] = []

  try {
    await ensureContainedDirectory(uploadDirectory)
    for (const item of prepared) {
      try {
        await writeFile(item.absolutePath, item.buffer, { flag: 'wx' })
        writtenPaths.push(item.absolutePath)
      } catch (error) {
        if (!nodeErrorHasCode(error, 'EEXIST')) {
          await cleanupFiles([item.absolutePath])
        }
        throw error
      }
    }

    return await prisma.$transaction(async (tx) => {
      const records: FileRecordLike[] = []
      for (const item of prepared) {
        records.push(
          await tx.fileManagement.create({
            data: {
              originalName: item.originalName,
              fileName: item.fileName,
              filePath: item.filePath,
              fileSize: BigInt(item.buffer.length),
              businessType: options.businessType,
              status: 1,
            },
          }),
        )
      }
      return records
    })
  } catch (error) {
    await cleanupFiles(writtenPaths)
    throw error
  }
}

export async function uploadAdminFiles(request: Request, options: UploadFilesOptions) {
  return (await uploadFiles(request, {
    ...options,
    maxFiles: options.businessType === 'SystemLogo' ? 1 : options.maxFiles,
  })).map(uploadedFileDto)
}

export async function uploadAdminProjectAvatar(request: Request) {
  const [file] = await uploadFiles(request, {
    businessType: 'ProjectAvatar',
    maxFiles: 1,
  })
  return avatarFileDto(file)
}

export async function uploadUserAvatar(request: Request) {
  const [file] = await uploadFiles(request, {
    businessType: 'UserAvatar',
    maxFiles: 1,
  })
  return avatarFileDto(file)
}

export async function updateFileBusinessType(id: number, businessType: BusinessType) {
  await assertFileIsNotContractAttachment(id)
  try {
    return await prisma.fileManagement.update({
      where: { id },
      data: { businessType },
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function softDeleteFile(id: number) {
  await assertFileIsNotContractAttachment(id)
  try {
    return await prisma.fileManagement.update({
      where: { id },
      data: { status: 0 },
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

async function restoreStagedFile(stagedPath: string, originalPath: string) {
  try {
    await lstat(originalPath)
    console.error('[files] Hard-delete rollback skipped because the original path exists')
    return
  } catch (error) {
    if (!nodeErrorHasCode(error, 'ENOENT')) throw error
  }
  await rename(stagedPath, originalPath)
}

export async function hardDeleteFile(id: number) {
  await assertFileIsNotContractAttachment(id)
  const file = await prisma.fileManagement.findUnique({ where: { id } })
  if (!file) throw new HttpError('Not Found', 404, 404)

  const originalPath = resolveStoredUploadPath(file.filePath)
  let stagedPath: string | null = null

  try {
    const fileStats = await lstat(originalPath)
    if (fileStats.isDirectory()) throw new HttpError('Access denied', 403, 403)

    const trashDirectory = resolveWithinUploads(TRASH_DIRECTORY)
    await ensureContainedDirectory(trashDirectory)
    const trashPath = resolveWithinUploads(TRASH_DIRECTORY, randomUUID())
    await rename(originalPath, trashPath)
    stagedPath = trashPath
  } catch (error) {
    if (!nodeErrorHasCode(error, 'ENOENT')) throw error
  }

  try {
    await prisma.fileManagement.delete({ where: { id } })
  } catch (error) {
    if (stagedPath) {
      try {
        await restoreStagedFile(stagedPath, originalPath)
      } catch (restoreError) {
        console.error('[files] Failed to restore staged hard-delete file', restoreError)
      }
    }
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }

  if (stagedPath) {
    try {
      await unlink(stagedPath)
    } catch (error) {
      if (!nodeErrorHasCode(error, 'ENOENT')) {
        console.error('[files] Failed to remove committed hard-delete trash file', error)
      }
    }
  }
}

export async function batchSoftDelete(ids: number[]) {
  const linked = await prisma.contract.findFirst({
    where: { attachmentFileId: { in: ids } },
    select: { contractId: true },
  })
  if (linked) throw new HttpError('Contract attachments cannot be changed or deleted', 409, 409)
  return prisma.fileManagement.updateMany({
    where: { id: { in: ids } },
    data: { status: 0 },
  })
}

export async function updateAdminFileBusinessType(
  id: number,
  businessType: BusinessType,
) {
  return fileDto(await updateFileBusinessType(id, businessType))
}

export async function deleteAdminFile(id: number, hard: boolean) {
  if (hard) await hardDeleteFile(id)
  else await softDeleteFile(id)
}

export async function batchDeleteAdminFiles(ids: number[]) {
  const result = await batchSoftDelete(ids)
  return { affected: result.count }
}

export async function inspectPublicUpload(pathSegments: string[]) {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) {
    throw new HttpError('File path is required', 400, 400)
  }

  const safeSegments = pathSegments.map(decodePublicSegment)
  if (safeSegments[0] === BUSINESS_TYPE_CONFIG.ContractAttachment.dir) {
    throw new HttpError('Access denied', 403, 403)
  }
  const candidate = resolveWithinUploads(...safeSegments)

  let realUploadRoot: string
  let realCandidate: string
  try {
    [realUploadRoot, realCandidate] = await Promise.all([
      realpath(UPLOAD_ROOT),
      realpath(candidate),
    ])
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) throw new HttpError('File not found', 404, 404)
    throw error
  }

  const absolutePath = assertContained(realUploadRoot, realCandidate)
  let fileStats: Awaited<ReturnType<typeof stat>>
  try {
    fileStats = await stat(absolutePath)
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) throw new HttpError('File not found', 404, 404)
    throw error
  }
  if (!fileStats.isFile()) throw new HttpError('Access denied', 403, 403)

  const fileName = basename(absolutePath)
  const extension = extensionOf(fileName)
  const contentType = CONTENT_TYPES[extension] || 'application/octet-stream'
  const inline = IMAGE_EXTENSIONS.has(extension) || extension === 'pdf' || extension === 'txt' || extension === 'md'

  return {
    absolutePath,
    fileName,
    stats: fileStats,
    contentType,
    attachment: !inline,
  }
}

export async function readPublicUpload(absolutePath: string) {
  try {
    const realUploadRoot = await realpath(UPLOAD_ROOT)
    return await readFile(assertContained(realUploadRoot, absolutePath))
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) throw new HttpError('File not found', 404, 404)
    throw error
  }
}
