/**
 * Solana CJS 隔离模块
 *
 * 目的：将所有 Solana 相关的 CJS 依赖隔离在这个文件中
 * 避免 Nitro ESM 打包导致的 require/module 解析问题
 *
 * 这个文件会在构建后被复制到 .output/server/utils/
 * 并通过 createRequire + 绝对路径加载
 */

const {
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} = require('@solana/web3.js')

const {
  createAllocTreeIx,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
} = require('@solana/spl-account-compression')

// Bubblegum 程序 ID
const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY'
)

// SPL Noop 程序 ID
const SPL_NOOP_PROGRAM_ID = new PublicKey(
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'
)

/**
 * 创建 Solana 连接
 */
function createConnection(rpcUrl, options = {}) {
  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
    ...options,
  })
}

/**
 * 获取默认 RPC URL
 */
function getDefaultRpcUrl(network = 'devnet') {
  return clusterApiUrl(network === 'mainnet' ? 'mainnet-beta' : 'devnet')
}

/**
 * 格式化 lamports 为 SOL
 */
function lamportsToSol(lamports) {
  const LAMPORTS_PER_SOL = 1_000_000_000
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4)
}

/**
 * SOL 转 lamports
 */
function solToLamports(sol) {
  const LAMPORTS_PER_SOL = 1_000_000_000
  return Math.floor(sol * LAMPORTS_PER_SOL)
}

/**
 * 计算 Merkle Tree 账户所需空间
 */
function calculateTreeSpace(maxDepth, maxBufferSize, canopyDepth = 0) {
  if (maxDepth < 1 || maxDepth > 30) {
    throw new Error('maxDepth 必须在 1-30 之间')
  }
  if (maxBufferSize < 1) {
    throw new Error('maxBufferSize 必须大于 0')
  }
  if (canopyDepth < 0 || canopyDepth > maxDepth) {
    throw new Error('canopyDepth 必须在 0 到 maxDepth 之间')
  }

  const HEADER_SIZE = 8 + 4 + 4 + 32 + 8 + 1 + 7 + 8 + 8 + (32 * maxDepth) + 32 + 4
  const CHANGELOG_ENTRY_SIZE = 32 + 4 + (32 * maxDepth)
  const CHANGELOG_SIZE = maxBufferSize * CHANGELOG_ENTRY_SIZE
  const canopyNodes = canopyDepth > 0 ? Math.pow(2, canopyDepth + 1) - 2 : 0
  const CANOPY_SIZE = canopyNodes * 32

  return HEADER_SIZE + CHANGELOG_SIZE + CANOPY_SIZE
}

/**
 * 获取 TreeConfig PDA
 */
function getTreeConfigPda(merkleTree) {
  return PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )
}

/**
 * 创建 Bubblegum createTree 指令
 */
function createBubblegumCreateTreeInstruction(
  treeConfig,
  merkleTree,
  payer,
  treeCreator,
  maxDepth,
  maxBufferSize,
  isPublic = false
) {
  const CREATE_TREE_DISCRIMINATOR = Buffer.from([165, 83, 136, 142, 89, 202, 47, 220])

  const data = Buffer.alloc(8 + 4 + 4 + 2)
  CREATE_TREE_DISCRIMINATOR.copy(data, 0)
  data.writeUInt32LE(maxDepth, 8)
  data.writeUInt32LE(maxBufferSize, 12)
  data.writeUInt8(1, 16)
  data.writeUInt8(isPublic ? 1 : 0, 17)

  const keys = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: merkleTree, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: treeCreator, isSigner: true, isWritable: false },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  return new TransactionInstruction({
    keys,
    programId: BUBBLEGUM_PROGRAM_ID,
    data,
  })
}

/**
 * 构建创建 Merkle Tree 的交易
 */
async function buildCreateTreeTransaction(
  connection,
  payerPublicKey,
  treeKeypair,
  maxDepth,
  maxBufferSize,
  canopyDepth = 0
) {
  const spaceBytes = calculateTreeSpace(maxDepth, maxBufferSize, canopyDepth)
  const rentLamports = await connection.getMinimumBalanceForRentExemption(spaceBytes)
  const treeAuthorityKeypair = Keypair.generate()

  const allocAccountIx = await createAllocTreeIx(
    connection,
    treeKeypair.publicKey,
    payerPublicKey,
    { maxDepth, maxBufferSize },
    canopyDepth
  )

  const [treeConfigPda] = getTreeConfigPda(treeKeypair.publicKey)

  const createTreeIx = createBubblegumCreateTreeInstruction(
    treeConfigPda,
    treeKeypair.publicKey,
    payerPublicKey,
    treeAuthorityKeypair.publicKey,
    maxDepth,
    maxBufferSize,
    false
  )

  const transaction = new Transaction()
  transaction.add(allocAccountIx)
  transaction.add(createTreeIx)

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.lastValidBlockHeight = lastValidBlockHeight
  transaction.feePayer = payerPublicKey

  return {
    transaction,
    rentLamports,
    spaceBytes,
    treeAuthorityKeypair,
  }
}

/**
 * 获取 Asset ID
 */
function getAssetId(merkleTree, leafIndex) {
  const leafIndexBuffer = Buffer.alloc(8)
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex))

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('asset'),
      merkleTree.toBuffer(),
      leafIndexBuffer,
    ],
    BUBBLEGUM_PROGRAM_ID
  )
}

/**
 * 序列化 MetadataArgs
 */
function serializeMetadataArgs(metadata) {
  const buffers = []

  // name
  const nameBytes = Buffer.from(metadata.name, 'utf8')
  const nameLen = Buffer.alloc(4)
  nameLen.writeUInt32LE(nameBytes.length)
  buffers.push(nameLen, nameBytes)

  // symbol
  const symbolBytes = Buffer.from(metadata.symbol, 'utf8')
  const symbolLen = Buffer.alloc(4)
  symbolLen.writeUInt32LE(symbolBytes.length)
  buffers.push(symbolLen, symbolBytes)

  // uri
  const uriBytes = Buffer.from(metadata.uri, 'utf8')
  const uriLen = Buffer.alloc(4)
  uriLen.writeUInt32LE(uriBytes.length)
  buffers.push(uriLen, uriBytes)

  // seller_fee_basis_points
  const sellerFee = Buffer.alloc(2)
  sellerFee.writeUInt16LE(metadata.sellerFeeBasisPoints)
  buffers.push(sellerFee)

  // primary_sale_happened
  buffers.push(Buffer.from([metadata.primarySaleHappened ? 1 : 0]))

  // is_mutable
  buffers.push(Buffer.from([metadata.isMutable ? 1 : 0]))

  // edition_nonce
  if (metadata.editionNonce !== null) {
    buffers.push(Buffer.from([1, metadata.editionNonce]))
  } else {
    buffers.push(Buffer.from([0]))
  }

  // token_standard
  if (metadata.tokenStandard !== null) {
    buffers.push(Buffer.from([1, metadata.tokenStandard]))
  } else {
    buffers.push(Buffer.from([0]))
  }

  // collection
  if (metadata.collection !== null) {
    buffers.push(Buffer.from([1]))
    buffers.push(Buffer.from([metadata.collection.verified ? 1 : 0]))
    buffers.push(metadata.collection.key.toBuffer())
  } else {
    buffers.push(Buffer.from([0]))
  }

  // uses
  if (metadata.uses !== null) {
    buffers.push(Buffer.from([1]))
    buffers.push(Buffer.from([metadata.uses.useMethod]))
    const remaining = Buffer.alloc(8)
    remaining.writeBigUInt64LE(metadata.uses.remaining)
    buffers.push(remaining)
    const total = Buffer.alloc(8)
    total.writeBigUInt64LE(metadata.uses.total)
    buffers.push(total)
  } else {
    buffers.push(Buffer.from([0]))
  }

  // token_program_version
  buffers.push(Buffer.from([metadata.tokenProgramVersion]))

  // creators
  const creatorsLen = Buffer.alloc(4)
  creatorsLen.writeUInt32LE(metadata.creators.length)
  buffers.push(creatorsLen)

  for (const creator of metadata.creators) {
    buffers.push(creator.address.toBuffer())
    buffers.push(Buffer.from([creator.verified ? 1 : 0]))
    buffers.push(Buffer.from([creator.share]))
  }

  return Buffer.concat(buffers)
}

/**
 * 创建 mintV1 指令
 */
function createMintV1Instruction(
  treeConfig,
  leafOwner,
  leafDelegate,
  merkleTree,
  payer,
  treeCreatorOrDelegate,
  metadata
) {
  const MINT_V1_DISCRIMINATOR = Buffer.from([145, 98, 192, 118, 184, 147, 118, 104])

  const metadataArgs = {
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
    sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
    primarySaleHappened: metadata.primarySaleHappened ?? false,
    isMutable: metadata.isMutable ?? true,
    editionNonce: null,
    tokenStandard: 0,
    collection: metadata.collection ?? null,
    uses: metadata.uses ?? null,
    tokenProgramVersion: 0,
    creators: metadata.creators.map(c => ({
      address: c.address,
      verified: c.verified,
      share: c.share,
    })),
  }

  const metadataBuffer = serializeMetadataArgs(metadataArgs)
  const data = Buffer.concat([MINT_V1_DISCRIMINATOR, metadataBuffer])

  const keys = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: leafOwner, isSigner: false, isWritable: false },
    { pubkey: leafDelegate, isSigner: false, isWritable: false },
    { pubkey: merkleTree, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: treeCreatorOrDelegate, isSigner: true, isWritable: false },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  return new TransactionInstruction({
    keys,
    programId: BUBBLEGUM_PROGRAM_ID,
    data,
  })
}

/**
 * 构建 cNFT 铸造交易
 */
async function buildMintCnftTransaction(
  connection,
  payerPublicKey,
  treeAuthorityKeypair,
  merkleTreePublicKey,
  leafOwnerPublicKey,
  metadata,
  leafIndex
) {
  const [treeConfigPda] = getTreeConfigPda(merkleTreePublicKey)

  const mintIx = createMintV1Instruction(
    treeConfigPda,
    leafOwnerPublicKey,
    leafOwnerPublicKey,
    merkleTreePublicKey,
    payerPublicKey,
    treeAuthorityKeypair.publicKey,
    metadata
  )

  const transaction = new Transaction()
  transaction.add(mintIx)

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.lastValidBlockHeight = lastValidBlockHeight
  transaction.feePayer = payerPublicKey

  return {
    transaction,
    leafIndex,
    treeConfigPda,
  }
}

/**
 * 获取账户余额
 */
async function getBalance(connection, publicKeyString) {
  const publicKey = new PublicKey(publicKeyString)
  const balance = await connection.getBalance(publicKey)
  return balance
}

/**
 * 验证 Solana 地址
 */
function isValidSolanaAddress(address) {
  try {
    const pubkey = new PublicKey(address)
    return PublicKey.isOnCurve(pubkey.toBuffer()) || true
  } catch {
    return false
  }
}

/**
 * 从私钥字节数组创建 Keypair
 */
function keypairFromSecretKey(secretKey) {
  return Keypair.fromSecretKey(Uint8Array.from(secretKey))
}

/**
 * 从 base58 字符串创建 PublicKey
 */
function publicKeyFromString(str) {
  return new PublicKey(str)
}

/**
 * 生成新的 Keypair
 */
function generateKeypair() {
  return Keypair.generate()
}

// 导出所有函数
module.exports = {
  // 连接相关
  createConnection,
  getDefaultRpcUrl,

  // 工具函数
  lamportsToSol,
  solToLamports,
  calculateTreeSpace,
  isValidSolanaAddress,

  // Keypair 和 PublicKey
  keypairFromSecretKey,
  publicKeyFromString,
  generateKeypair,

  // Tree 相关
  buildCreateTreeTransaction,
  getTreeConfigPda,

  // cNFT 相关
  buildMintCnftTransaction,
  getAssetId,

  // 账户相关
  getBalance,

  // 常量
  BUBBLEGUM_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
}
