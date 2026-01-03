import { H3Event, readMultipartFormData } from 'h3'
import { randomUUID } from 'crypto'
import { join, extname } from 'path'
import { writeFile, unlink, stat, readFile, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { prisma } from './prisma'

// ============ 类型定义 ============

/** 业务类型枚举 */
export type BusinessType = 
  | 'ProjectAvatar'    // 项目头像
  | 'UserAvatar'       // 用户头像
  | 'NoteAttachment'   // 笔记附件
  | 'HomeworkFile'     // 作业文件
  | 'TempFile'         // 临时文件
  | 'Other'            // 其他

/** 业务类型配置 */
export const BusinessTypeConfig: Record<BusinessType, { label: string; dir: string }> = {
  ProjectAvatar: { label: '项目头像', dir: 'project-avatar' },
  UserAvatar: { label: '用户头像', dir: 'user-avatar' },
  NoteAttachment: { label: '笔记附件', dir: 'note-attachment' },
  HomeworkFile: { label: '作业文件', dir: 'homework' },
  TempFile: { label: '临时文件', dir: 'temp' },
  Other: { label: '其他', dir: 'other' },
}

/** 所有有效的业务类型列表 */
export const ValidBusinessTypes: BusinessType[] = Object.keys(BusinessTypeConfig) as BusinessType[]

/** 文件上传选项 */
export interface FileUploadOptions {
  /** 业务类型 */
  businessType: BusinessType
  /** 允许的文件扩展名（不含点），为空则不限制 */
  allowedExtensions?: string[]
  /** 最大文件大小（字节），默认 10MB */
  maxSize?: number
  /** 临时文件过期时间（秒），仅 businessType='temp' 时有效 */
  expireSeconds?: number
}

/** 文件上传结果 */
export interface FileUploadResult {
  id: bigint
  originalName: string
  fileName: string
  filePath: string
  fileSize: bigint
  businessType: string
  /** 可访问的 URL 路径 */
  url: string
  /** 临时文件过期时间戳（毫秒） */
  expireAt?: number
}

/** 文件查询条件 */
export interface FileQueryOptions {
  id?: bigint
  businessType?: BusinessType
  status?: number
  /** 分页 - 页码（从1开始） */
  page?: number
  /** 分页 - 每页数量 */
  pageSize?: number
}

// ============ 常量配置 ============

/** 默认最大文件大小：10MB */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024

/** 上传根目录（相对于 public） */
const UPLOAD_ROOT = 'uploads'

/** 临时文件目录 */
const TEMP_DIR = 'temp'

/** 临时文件记录（内存缓存，用于过期清理） */
const tempFileRegistry = new Map<string, { expireAt: number; filePath: string }>()

// ============ 工具函数 ============

/**
 * 获取上传目录的绝对路径
 */
function getUploadDir(businessType: BusinessType): string {
  const publicDir = join(process.cwd(), 'public')
  const dir = BusinessTypeConfig[businessType]?.dir || 'other'
  return join(publicDir, UPLOAD_ROOT, dir)
}

/**
 * 确保目录存在
 */
async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true })
  }
}

/**
 * 生成唯一文件名
 */
function generateFileName(originalName: string): string {
  const ext = extname(originalName)
  const uuid = randomUUID()
  const timestamp = Date.now()
  return `${timestamp}_${uuid}${ext}`
}

/**
 * 获取文件的访问 URL
 */
function getFileUrl(businessType: BusinessType, fileName: string): string {
  const dir = BusinessTypeConfig[businessType]?.dir || 'other'
  return `/${UPLOAD_ROOT}/${dir}/${fileName}`
}


// ============ 核心功能 ============

/**
 * 上传文件
 * @param event H3 事件对象
 * @param options 上传选项
 * @returns 上传结果数组
 */
export async function uploadFiles(
  event: H3Event,
  options: FileUploadOptions
): Promise<FileUploadResult[]> {
  const {
    businessType,
    allowedExtensions = [],
    maxSize = DEFAULT_MAX_SIZE,
    expireSeconds,
  } = options

  // 读取 multipart 表单数据
  const formData = await readMultipartFormData(event)
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, message: '未检测到上传文件' })
  }

  const results: FileUploadResult[] = []
  const uploadDir = getUploadDir(businessType)
  await ensureDir(uploadDir)

  for (const part of formData) {
    // 跳过非文件字段
    if (!part.filename || !part.data) continue

    const originalName = part.filename
    const fileBuffer = part.data
    const fileSize = fileBuffer.length

    // 校验文件大小
    if (fileSize > maxSize) {
      throw createError({
        statusCode: 400,
        message: `文件 ${originalName} 超过最大限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
      })
    }

    // 校验文件扩展名
    const ext = extname(originalName).toLowerCase().slice(1)
    if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) {
      throw createError({
        statusCode: 400,
        message: `文件 ${originalName} 类型不允许，仅支持: ${allowedExtensions.join(', ')}`,
      })
    }

    // 生成文件名并写入磁盘
    const fileName = generateFileName(originalName)
    const filePath = join(uploadDir, fileName)
    const relativePath = `${UPLOAD_ROOT}/${businessType}/${fileName}`

    await writeFile(filePath, fileBuffer)

    // 写入数据库
    const record = await prisma.fileManagement.create({
      data: {
        originalName,
        fileName,
        filePath: relativePath,
        fileSize: BigInt(fileSize),
        businessType,
        status: 1,
      },
    })

    const result: FileUploadResult = {
      id: record.id,
      originalName,
      fileName,
      filePath: relativePath,
      fileSize: BigInt(fileSize),
      businessType,
      url: getFileUrl(businessType, fileName),
    }

    // 临时文件处理
    if (businessType === 'TempFile' && expireSeconds) {
      const expireAt = Date.now() + expireSeconds * 1000
      result.expireAt = expireAt
      tempFileRegistry.set(fileName, { expireAt, filePath })
    }

    results.push(result)
  }

  return results
}

/**
 * 上传临时文件（带过期时间）
 */
export async function uploadTempFile(
  event: H3Event,
  expireSeconds: number,
  options?: Omit<FileUploadOptions, 'businessType' | 'expireSeconds'>
): Promise<FileUploadResult[]> {
  return uploadFiles(event, {
    ...options,
    businessType: 'TempFile',
    expireSeconds,
  })
}


// ============ 查询功能 ============

/**
 * 根据 ID 获取文件信息
 */
export async function getFileById(id: bigint) {
  const file = await prisma.fileManagement.findUnique({
    where: { id },
  })
  if (!file || file.status === 0) {
    return null
  }
  return {
    ...file,
    url: `/${file.filePath}`,
  }
}

/**
 * 查询文件列表
 */
export async function queryFiles(options: FileQueryOptions = {}) {
  const { id, businessType, status = 1, page = 1, pageSize = 20 } = options

  const where: any = { status }
  if (id) where.id = id
  if (businessType) where.businessType = businessType

  const [total, list] = await Promise.all([
    prisma.fileManagement.count({ where }),
    prisma.fileManagement.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createTime: 'desc' },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    list: list.map((f) => ({
      ...f,
      url: `/${f.filePath}`,
    })),
  }
}

// ============ 更新功能 ============

/**
 * 更新文件信息（仅支持更新业务类型）
 */
export async function updateFile(
  id: bigint,
  data: { businessType?: BusinessType }
) {
  const file = await prisma.fileManagement.findUnique({ where: { id } })
  if (!file || file.status === 0) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  return prisma.fileManagement.update({
    where: { id },
    data: {
      businessType: data.businessType,
    },
  })
}

// ============ 删除功能 ============

/**
 * 软删除文件（仅更新状态）
 */
export async function softDeleteFile(id: bigint) {
  const file = await prisma.fileManagement.findUnique({ where: { id } })
  if (!file) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  return prisma.fileManagement.update({
    where: { id },
    data: { status: 0 },
  })
}

/**
 * 硬删除文件（删除磁盘文件 + 数据库记录）
 */
export async function hardDeleteFile(id: bigint) {
  const file = await prisma.fileManagement.findUnique({ where: { id } })
  if (!file) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  // 删除磁盘文件
  const absolutePath = join(process.cwd(), 'public', file.filePath)
  if (existsSync(absolutePath)) {
    await unlink(absolutePath)
  }

  // 删除数据库记录
  return prisma.fileManagement.delete({ where: { id } })
}

/**
 * 批量软删除
 */
export async function batchSoftDelete(ids: bigint[]) {
  return prisma.fileManagement.updateMany({
    where: { id: { in: ids } },
    data: { status: 0 },
  })
}

// ============ 临时文件清理 ============

/**
 * 清理过期的临时文件
 * 建议通过定时任务调用
 */
export async function cleanExpiredTempFiles() {
  const now = Date.now()
  const expiredFiles: string[] = []

  // 从内存缓存中找出过期文件
  for (const [fileName, info] of tempFileRegistry.entries()) {
    if (info.expireAt <= now) {
      expiredFiles.push(fileName)
      // 删除磁盘文件
      if (existsSync(info.filePath)) {
        await unlink(info.filePath).catch(() => {})
      }
      tempFileRegistry.delete(fileName)
    }
  }

  // 同步删除数据库中的临时文件记录
  if (expiredFiles.length > 0) {
    await prisma.fileManagement.deleteMany({
      where: {
        businessType: 'TempFile',
        fileName: { in: expiredFiles },
      },
    })
  }

  return { cleaned: expiredFiles.length }
}

// ============ 辅助功能 ============

/**
 * 读取文件内容（Buffer）
 */
export async function readFileContent(id: bigint): Promise<Buffer | null> {
  const file = await getFileById(id)
  if (!file) return null

  const absolutePath = join(process.cwd(), 'public', file.filePath)
  if (!existsSync(absolutePath)) return null

  return readFile(absolutePath)
}

/**
 * 获取文件统计信息
 */
export async function getFileStats(id: bigint) {
  const file = await getFileById(id)
  if (!file) return null

  const absolutePath = join(process.cwd(), 'public', file.filePath)
  if (!existsSync(absolutePath)) return null

  const stats = await stat(absolutePath)
  return {
    ...file,
    diskSize: stats.size,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(id: bigint): Promise<boolean> {
  const file = await getFileById(id)
  if (!file) return false

  const absolutePath = join(process.cwd(), 'public', file.filePath)
  return existsSync(absolutePath)
}
