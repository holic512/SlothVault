/**
 * NFT 元数据工具模块
 *
 * 构建符合 Metaplex 标准的 NFT 元数据
 * 并上传到 IPFS（通过 Filebase）
 */

import { uploadMetadataToFilebase } from './filebase'

/**
 * NFT 属性
 */
export interface NftAttribute {
  trait_type: string
  value: string | number
}

/**
 * NFT 文件信息
 */
export interface NftFile {
  uri: string
  type: string
}

/**
 * NFT 元数据结构（符合 Metaplex 标准）
 */
export interface NftMetadataJson {
  /** NFT 名称 */
  name: string
  /** NFT 符号 */
  symbol: string
  /** NFT 描述 */
  description?: string
  /** 图片 URI (ipfs://CID) */
  image: string
  /** 外部链接 */
  external_url?: string
  /** 属性列表 */
  attributes?: NftAttribute[]
  /** 扩展属性 */
  properties?: {
    files?: NftFile[]
    category?: string
    creators?: Array<{
      address: string
      share: number
    }>
  }
  /** 销售费用基点 (0-10000) */
  seller_fee_basis_points?: number
}

/**
 * 构建元数据的输入参数
 */
export interface BuildMetadataInput {
  /** NFT 名称 */
  name: string
  /** NFT 符号 */
  symbol?: string
  /** NFT 描述 */
  description?: string
  /** 图片 IPFS CID */
  imageCid: string
  /** 图片 MIME 类型 */
  imageMimeType?: string
  /** 外部链接 */
  externalUrl?: string
  /** 属性列表 */
  attributes?: NftAttribute[]
  /** 创建者地址 */
  creatorAddress?: string
  /** 销售费用基点 */
  sellerFeeBasisPoints?: number
}

/**
 * 元数据上传结果
 */
export interface MetadataUploadResult {
  /** 元数据 JSON 对象 */
  metadata: NftMetadataJson
  /** 元数据 IPFS CID */
  metadataCid: string
  /** 元数据 IPFS URI */
  metadataUri: string
  /** IPFS 网关 URL */
  gatewayUrl: string
}

/**
 * 构建 NFT 元数据 JSON
 *
 * @param input - 输入参数
 * @returns 元数据 JSON 对象
 */
export function buildNftMetadata(input: BuildMetadataInput): NftMetadataJson {
  const {
    name,
    symbol = '',
    description,
    imageCid,
    imageMimeType = 'image/webp',
    externalUrl,
    attributes,
    creatorAddress,
    sellerFeeBasisPoints = 0,
  } = input

  const imageUri = `ipfs://${imageCid}`

  const metadata: NftMetadataJson = {
    name,
    symbol,
    image: imageUri,
  }

  // 可选字段
  if (description) {
    metadata.description = description
  }

  if (externalUrl) {
    metadata.external_url = externalUrl
  }

  if (attributes && attributes.length > 0) {
    metadata.attributes = attributes
  }

  if (sellerFeeBasisPoints > 0) {
    metadata.seller_fee_basis_points = sellerFeeBasisPoints
  }

  // 构建 properties
  const properties: NftMetadataJson['properties'] = {
    files: [
      {
        uri: imageUri,
        type: imageMimeType,
      },
    ],
    category: 'image',
  }

  if (creatorAddress) {
    properties.creators = [
      {
        address: creatorAddress,
        share: 100,
      },
    ]
  }

  metadata.properties = properties

  return metadata
}

/**
 * 构建并上传 NFT 元数据到 IPFS
 *
 * @param input - 输入参数
 * @returns 上传结果
 */
export async function buildAndUploadMetadata(
  input: BuildMetadataInput
): Promise<MetadataUploadResult> {
  // 构建元数据
  const metadata = buildNftMetadata(input)

  // 生成文件名
  const fileName = `${input.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`

  // 上传到 Filebase
  const uploadResult = await uploadMetadataToFilebase(metadata, fileName)

  return {
    metadata,
    metadataCid: uploadResult.cid,
    metadataUri: uploadResult.ipfsUri,
    gatewayUrl: uploadResult.gatewayUrl,
  }
}

/**
 * 验证元数据是否符合基本要求
 *
 * @param metadata - 元数据对象
 * @returns 验证结果
 */
export function validateMetadata(metadata: Partial<NftMetadataJson>): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!metadata.name || metadata.name.trim().length === 0) {
    errors.push('name 不能为空')
  }

  if (!metadata.image || !metadata.image.startsWith('ipfs://')) {
    errors.push('image 必须是有效的 IPFS URI (ipfs://...)')
  }

  if (metadata.seller_fee_basis_points !== undefined) {
    if (metadata.seller_fee_basis_points < 0 || metadata.seller_fee_basis_points > 10000) {
      errors.push('seller_fee_basis_points 必须在 0-10000 之间')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
