import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// 加密算法配置
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32

/**
 * 获取加密密钥（从环境变量）
 * 必须在 .env 中配置 ENCRYPTION_KEY
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error('未配置 ENCRYPTION_KEY 环境变量')
  }
  // 使用 scrypt 派生固定长度的密钥
  return scryptSync(secret, 'solana-tree-key', 32)
}

/**
 * 加密私钥
 * @param privateKey - 原始私钥（Base58 或 Uint8Array JSON）
 * @returns 加密后的字符串（格式：salt:iv:authTag:encrypted）
 */
export function encryptPrivateKey(privateKey: string): string {
  const key = getEncryptionKey()
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  
  const cipher = createCipheriv(ALGORITHM, key, iv)
  
  let encrypted = cipher.update(privateKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = cipher.getAuthTag()
  
  // 格式：salt:iv:authTag:encrypted（全部 hex 编码）
  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':')
}

/**
 * 解密私钥
 * @param encryptedData - 加密后的字符串
 * @returns 原始私钥
 */
export function decryptPrivateKey(encryptedData: string): string {
  const key = getEncryptionKey()
  
  const parts = encryptedData.split(':')
  if (parts.length !== 4) {
    throw new Error('无效的加密数据格式')
  }
  
  const [saltHex, ivHex, authTagHex, encrypted] = parts
  
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}

/**
 * 将 Solana Keypair 的 secretKey 转换为可存储的字符串
 * @param secretKey - Uint8Array 格式的私钥
 * @returns Base64 编码的字符串
 */
export function secretKeyToString(secretKey: Uint8Array): string {
  return Buffer.from(secretKey).toString('base64')
}

/**
 * 将存储的字符串转换回 Uint8Array
 * @param str - Base64 编码的字符串
 * @returns Uint8Array 格式的私钥
 */
export function stringToSecretKey(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'))
}
