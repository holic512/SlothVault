/**
 * 图片处理工具模块
 *
 * 使用 sharp 库对图片进行压缩和格式转换
 * 用于 NFT 图片的优化处理
 */

import sharp from 'sharp'

/**
 * 图片压缩选项
 */
export interface ImageCompressOptions {
  /** 最大宽度（像素），默认 1024 */
  maxWidth?: number
  /** 最大高度（像素），默认 1024 */
  maxHeight?: number
  /** 输出格式，默认 'webp' */
  format?: 'webp' | 'png' | 'jpeg'
  /** 压缩质量 (1-100)，默认 85 */
  quality?: number
  /** 是否保持宽高比，默认 true */
  keepAspectRatio?: boolean
}

/**
 * 图片处理结果
 */
export interface ImageProcessResult {
  /** 处理后的图片 Buffer */
  buffer: Buffer
  /** MIME 类型 */
  mimeType: string
  /** 文件扩展名 */
  extension: string
  /** 原始宽度 */
  originalWidth: number
  /** 原始高度 */
  originalHeight: number
  /** 处理后宽度 */
  width: number
  /** 处理后高度 */
  height: number
  /** 原始大小（字节） */
  originalSize: number
  /** 处理后大小（字节） */
  size: number
  /** 压缩率 */
  compressionRatio: number
}

// 格式对应的 MIME 类型
const FORMAT_MIME_MAP: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
}

/**
 * 检测图片是否包含透明像素
 */
async function hasTransparency(buffer: Buffer): Promise<boolean> {
  const metadata = await sharp(buffer).metadata()

  // 只有支持透明通道的格式才需要检测
  if (!metadata.hasAlpha) {
    return false
  }

  // 提取 alpha 通道并检测是否有非完全不透明的像素
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // RGBA 格式，每4字节一个像素，第4字节是 alpha
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      return true
    }
  }

  return false
}

/**
 * 为图片添加纯色背景（处理透明通道）
 */
async function flattenWithBackground(
  buffer: Buffer,
  backgroundColor: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }
): Promise<Buffer> {
  return sharp(buffer)
    .flatten({ background: backgroundColor })
    .toBuffer()
}

// 格式对应的扩展名
const FORMAT_EXT_MAP: Record<string, string> = {
  webp: 'webp',
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
}

/**
 * 压缩图片
 *
 * @param input - 输入图片 Buffer
 * @param options - 压缩选项
 * @returns 处理结果
 */
export async function compressImage(
  input: Buffer,
  options: ImageCompressOptions = {}
): Promise<ImageProcessResult> {
  const {
    maxWidth = 1024,
    maxHeight = 1024,
    format = 'webp',
    quality = 85,
    keepAspectRatio = true,
  } = options

  const originalSize = input.length

  // 获取原始图片信息
  const metadata = await sharp(input).metadata()
  const originalWidth = metadata.width || 0
  const originalHeight = metadata.height || 0

  // 创建 sharp 实例
  let pipeline = sharp(input)

  // 调整尺寸
  if (originalWidth > maxWidth || originalHeight > maxHeight) {
    pipeline = pipeline.resize({
      width: maxWidth,
      height: maxHeight,
      fit: keepAspectRatio ? 'inside' : 'fill',
      withoutEnlargement: true,
    })
  }

  // 转换格式并压缩
  switch (format) {
    case 'webp':
      pipeline = pipeline.webp({ quality, effort: 4 })
      break
    case 'png':
      pipeline = pipeline.png({ quality, compressionLevel: 9 })
      break
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality, progressive: true })
      break
  }

  // 输出 Buffer
  const outputBuffer = await pipeline.toBuffer()

  // 获取输出图片信息
  const outputMetadata = await sharp(outputBuffer).metadata()

  return {
    buffer: outputBuffer,
    mimeType: FORMAT_MIME_MAP[format],
    extension: FORMAT_EXT_MAP[format],
    originalWidth,
    originalHeight,
    width: outputMetadata.width || 0,
    height: outputMetadata.height || 0,
    originalSize,
    size: outputBuffer.length,
    compressionRatio: Number((1 - outputBuffer.length / originalSize).toFixed(4)),
  }
}

/**
 * 压缩图片为 NFT 标准格式
 *
 * 针对 NFT 场景优化：
 * - 最大尺寸 1024x1024
 * - WebP 格式（体积小、质量好）
 * - 质量 85%
 * - 透明图片自动添加黑色背景（避免压缩斑点）
 *
 * @param input - 输入图片 Buffer
 * @param backgroundColor - 透明图片的背景色，默认黑色
 * @returns 处理结果
 */
export async function compressForNft(
  input: Buffer,
  backgroundColor: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }
): Promise<ImageProcessResult> {
  let processedInput = input

  // 检测并处理透明通道
  const transparent = await hasTransparency(input)
  if (transparent) {
    processedInput = await flattenWithBackground(input, backgroundColor)
  }

  return compressImage(processedInput, {
    maxWidth: 1024,
    maxHeight: 1024,
    format: 'webp',
    quality: 85,
  })
}

/**
 * 检测图片格式
 *
 * @param buffer - 图片 Buffer
 * @returns 格式信息
 */
export async function detectImageFormat(buffer: Buffer): Promise<{
  format: string
  mimeType: string
  width: number
  height: number
}> {
  const metadata = await sharp(buffer).metadata()

  const format = metadata.format || 'unknown'
  const mimeType = FORMAT_MIME_MAP[format] || 'application/octet-stream'

  return {
    format,
    mimeType,
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

/**
 * 验证是否为有效图片
 *
 * @param buffer - 文件 Buffer
 * @returns 是否为有效图片
 */
export async function isValidImage(buffer: Buffer): Promise<boolean> {
  try {
    const metadata = await sharp(buffer).metadata()
    return !!(metadata.format && metadata.width && metadata.height)
  } catch {
    return false
  }
}
