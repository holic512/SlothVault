/**
 * @file solana-chain.ts
 * @project SlothVault
 * @module Solana Chain Runtime
 * @description Builds, validates, submits, and reconciles legacy Solana transactions for Bubblegum tree creation and cNFT minting without the former Nitro CJS bridge.
 * @logic Use the locked account-compression package for exact tree allocation and change-log decoding, partially sign server-owned authorities, bind submit payloads to the prepared message, persist deterministic signatures before broadcast, and derive cNFT identity only from confirmed chain events.
 * @dependencies @solana/web3.js, @solana/spl-account-compression, bs58, server/services/system-config
 * @index_tags solana,bubblegum,merkle-tree,cnft,transaction,signature,reconciliation,change-log
 * @author holic512
 */
import 'server-only'

import { createHash } from 'node:crypto'

import {
  ALL_DEPTH_SIZE_PAIRS,
  ConcurrentMerkleTreeAccount,
  createAllocTreeIx,
  deserializeChangeLogEventV1,
  getConcurrentMerkleTreeAccountSize,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  type ValidDepthSizePair,
} from '@solana/spl-account-compression'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from '@solana/web3.js'
import bs58 from 'bs58'

import { HttpError } from '@/server/http/errors'
import {
  getSolanaRpcUrl,
  type SolanaNetwork,
} from '@/server/services/system-config'
import type { SolanaPrepareSession } from '@/server/services/solana-session'

export const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
)

const CREATE_TREE_DISCRIMINATOR = Buffer.from([165, 83, 136, 142, 89, 202, 47, 220])
const MINT_V1_DISCRIMINATOR = Buffer.from([145, 98, 192, 118, 184, 147, 118, 104])
const MAX_SOLANA_TRANSACTION_BYTES = 4_096
const MAX_TREE_ACCOUNT_BYTES = 10 * 1024 * 1024

export const TREE_PRESETS = [
  { label: 'Small', maxDepth: 14, maxBufferSize: 64, canopyDepth: 0 },
  { label: 'Medium', maxDepth: 20, maxBufferSize: 64, canopyDepth: 0 },
  { label: 'Large', maxDepth: 24, maxBufferSize: 64, canopyDepth: 0 },
] as const

export type CnftMetadata = {
  name: string
  symbol: string
  uri: string
  sellerFeeBasisPoints: number
  primarySaleHappened?: boolean
  isMutable?: boolean
  creators: Array<{
    address: PublicKey
    verified: boolean
    share: number
  }>
}

export function getSolanaConnection(network: SolanaNetwork, commitment: Commitment = 'confirmed') {
  return getSolanaRpcUrl(network).then(
    (rpcUrl) =>
      new Connection(rpcUrl, {
        commitment,
        confirmTransactionInitialTimeout: 60_000,
      }),
  )
}

export function parseSolanaPublicKey(value: string, label: string) {
  try {
    return new PublicKey(value)
  } catch {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
}

export function validDepthSizePair(maxDepth: number, maxBufferSize: number): ValidDepthSizePair {
  const pair = ALL_DEPTH_SIZE_PAIRS.find(
    (candidate) =>
      candidate.maxDepth === maxDepth && candidate.maxBufferSize === maxBufferSize,
  )
  if (!pair) {
    throw new HttpError(
      `Unsupported maxDepth/maxBufferSize pair: ${maxDepth}/${maxBufferSize}`,
      400,
      400,
    )
  }
  return pair
}

export function treeAccountSpace(
  maxDepth: number,
  maxBufferSize: number,
  canopyDepth = 0,
) {
  validDepthSizePair(maxDepth, maxBufferSize)
  if (!Number.isInteger(canopyDepth) || canopyDepth < 0 || canopyDepth > maxDepth) {
    throw new HttpError('canopyDepth must be between 0 and maxDepth', 400, 400)
  }
  const spaceBytes = getConcurrentMerkleTreeAccountSize(
    maxDepth,
    maxBufferSize,
    canopyDepth,
  )
  if (spaceBytes <= 0 || spaceBytes > MAX_TREE_ACCOUNT_BYTES) {
    throw new HttpError('Merkle Tree account exceeds the supported size', 400, 400)
  }
  return spaceBytes
}

export function estimateRentOffline(spaceBytes: number) {
  return Number((BigInt(spaceBytes) + 128n) * 6_960n)
}

export function formatSol(lamports: number) {
  const sol = lamports / LAMPORTS_PER_SOL
  return sol >= 100 ? sol.toFixed(2) : sol >= 1 ? sol.toFixed(3) : sol.toFixed(4)
}

export function getTreeConfigPda(merkleTree: PublicKey) {
  return PublicKey.findProgramAddressSync([merkleTree.toBuffer()], BUBBLEGUM_PROGRAM_ID)
}

function createBubblegumTreeInstruction(options: {
  treeConfig: PublicKey
  merkleTree: PublicKey
  payer: PublicKey
  treeCreator: PublicKey
  maxDepth: number
  maxBufferSize: number
}) {
  const data = Buffer.alloc(18)
  CREATE_TREE_DISCRIMINATOR.copy(data, 0)
  data.writeUInt32LE(options.maxDepth, 8)
  data.writeUInt32LE(options.maxBufferSize, 12)
  data.writeUInt8(1, 16)
  data.writeUInt8(0, 17)

  return new TransactionInstruction({
    programId: BUBBLEGUM_PROGRAM_ID,
    keys: [
      { pubkey: options.treeConfig, isSigner: false, isWritable: true },
      { pubkey: options.merkleTree, isSigner: false, isWritable: true },
      { pubkey: options.payer, isSigner: true, isWritable: true },
      { pubkey: options.treeCreator, isSigner: true, isWritable: false },
      { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

export async function buildCreateTreeTransaction(options: {
  connection: Connection
  payer: PublicKey
  treeKeypair: Keypair
  treeAuthority: Keypair
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
}) {
  const depthSizePair = validDepthSizePair(options.maxDepth, options.maxBufferSize)
  const spaceBytes = treeAccountSpace(
    options.maxDepth,
    options.maxBufferSize,
    options.canopyDepth,
  )
  const [allocationInstruction, rentLamports, latestBlockhash] = await Promise.all([
    createAllocTreeIx(
      options.connection,
      options.treeKeypair.publicKey,
      options.payer,
      depthSizePair,
      options.canopyDepth,
    ),
    options.connection.getMinimumBalanceForRentExemption(spaceBytes),
    options.connection.getLatestBlockhash('confirmed'),
  ])
  const [treeConfig] = getTreeConfigPda(options.treeKeypair.publicKey)
  const transaction = new Transaction({
    feePayer: options.payer,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(
    allocationInstruction,
    createBubblegumTreeInstruction({
      treeConfig,
      merkleTree: options.treeKeypair.publicKey,
      payer: options.payer,
      treeCreator: options.treeAuthority.publicKey,
      maxDepth: options.maxDepth,
      maxBufferSize: options.maxBufferSize,
    }),
  )
  transaction.partialSign(options.treeKeypair, options.treeAuthority)
  if (!transaction.verifySignatures(false)) {
    throw new HttpError('Unable to partially sign Merkle Tree transaction', 500, 500)
  }

  return {
    transaction,
    rentLamports,
    spaceBytes,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }
}

function encodeRustString(value: string) {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(bytes.length)
  return [length, bytes]
}

function serializeMetadata(metadata: CnftMetadata) {
  const buffers: Buffer[] = []
  buffers.push(...encodeRustString(metadata.name))
  buffers.push(...encodeRustString(metadata.symbol))
  buffers.push(...encodeRustString(metadata.uri))

  const sellerFee = Buffer.alloc(2)
  sellerFee.writeUInt16LE(metadata.sellerFeeBasisPoints)
  buffers.push(sellerFee)
  buffers.push(Buffer.from([metadata.primarySaleHappened ? 1 : 0]))
  buffers.push(Buffer.from([metadata.isMutable === false ? 0 : 1]))
  buffers.push(Buffer.from([0])) // edition_nonce: None
  buffers.push(Buffer.from([1, 0])) // token_standard: Some(NonFungible)
  buffers.push(Buffer.from([0])) // collection: None
  buffers.push(Buffer.from([0])) // uses: None
  buffers.push(Buffer.from([0])) // token_program_version: Original

  const creatorsLength = Buffer.alloc(4)
  creatorsLength.writeUInt32LE(metadata.creators.length)
  buffers.push(creatorsLength)
  for (const creator of metadata.creators) {
    buffers.push(creator.address.toBuffer())
    buffers.push(Buffer.from([creator.verified ? 1 : 0]))
    buffers.push(Buffer.from([creator.share]))
  }
  return Buffer.concat(buffers)
}

function createMintInstruction(options: {
  merkleTree: PublicKey
  payer: PublicKey
  treeAuthority: PublicKey
  owner: PublicKey
  metadata: CnftMetadata
}) {
  const [treeConfig] = getTreeConfigPda(options.merkleTree)
  return new TransactionInstruction({
    programId: BUBBLEGUM_PROGRAM_ID,
    keys: [
      { pubkey: treeConfig, isSigner: false, isWritable: true },
      { pubkey: options.owner, isSigner: false, isWritable: false },
      { pubkey: options.owner, isSigner: false, isWritable: false },
      { pubkey: options.merkleTree, isSigner: false, isWritable: true },
      { pubkey: options.payer, isSigner: true, isWritable: true },
      { pubkey: options.treeAuthority, isSigner: true, isWritable: false },
      { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([MINT_V1_DISCRIMINATOR, serializeMetadata(options.metadata)]),
  })
}

export async function buildMintTransaction(options: {
  connection: Connection
  payer: PublicKey
  treeAuthority: Keypair
  merkleTree: PublicKey
  owner: PublicKey
  metadata: CnftMetadata
}) {
  const latestBlockhash = await options.connection.getLatestBlockhash('confirmed')
  const transaction = new Transaction({
    feePayer: options.payer,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(
    createMintInstruction({
      merkleTree: options.merkleTree,
      payer: options.payer,
      treeAuthority: options.treeAuthority.publicKey,
      owner: options.owner,
      metadata: options.metadata,
    }),
  )
  transaction.partialSign(options.treeAuthority)
  if (!transaction.verifySignatures(false)) {
    throw new HttpError('Unable to partially sign cNFT transaction', 500, 500)
  }
  return {
    transaction,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }
}

export function getAssetId(merkleTree: PublicKey, leafIndex: number) {
  const leafIndexBuffer = Buffer.alloc(8)
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex))
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset'), merkleTree.toBuffer(), leafIndexBuffer],
    BUBBLEGUM_PROGRAM_ID,
  )[0]
}

export function transactionMessageHash(transaction: Transaction) {
  return createHash('sha256').update(transaction.serializeMessage()).digest('hex')
}

export function serializePreparedTransaction(transaction: Transaction) {
  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: true })
    .toString('base64')
}

export function parseSignedTransaction(encoded: string) {
  let bytes: Buffer
  try {
    bytes = Buffer.from(encoded, 'base64')
  } catch {
    throw new HttpError('Invalid signed transaction', 400, 400)
  }
  if (!bytes.length || bytes.length > MAX_SOLANA_TRANSACTION_BYTES) {
    throw new HttpError('Invalid signed transaction', 400, 400)
  }
  try {
    return Transaction.from(bytes)
  } catch {
    throw new HttpError('Invalid signed transaction', 400, 400)
  }
}

export function signedTransactionSignature(transaction: Transaction) {
  if (!transaction.signature) {
    throw new HttpError('Signed transaction is missing its payer signature', 400, 400)
  }
  return bs58.encode(transaction.signature)
}

function signerAddresses(transaction: Transaction) {
  return new Set(transaction.signatures.map((signature) => signature.publicKey.toBase58()))
}

export function assertPreparedTransaction(
  transaction: Transaction,
  session: SolanaPrepareSession,
) {
  if (transaction.feePayer?.toBase58() !== session.payerAddress) {
    throw new HttpError('Signed transaction fee payer does not match prepare session', 400, 400)
  }
  if (transaction.recentBlockhash !== session.recentBlockhash) {
    throw new HttpError('Signed transaction blockhash does not match prepare session', 400, 400)
  }
  if (transactionMessageHash(transaction) !== session.messageHash) {
    throw new HttpError('Signed transaction was modified after prepare', 400, 400)
  }

  const actualPrograms = transaction.instructions.map((instruction) => instruction.programId.toBase58())
  if (
    actualPrograms.length !== session.programIds.length ||
    actualPrograms.some((programId, index) => programId !== session.programIds[index])
  ) {
    throw new HttpError('Signed transaction contains unexpected programs', 400, 400)
  }
  const expectedTree = new PublicKey(session.treeAddress)
  if (
    !transaction.instructions.some((instruction) =>
      instruction.keys.some((key) => key.pubkey.equals(expectedTree)),
    )
  ) {
    throw new HttpError('Signed transaction does not reference the prepared tree', 400, 400)
  }
  if (
    session.kind === 'mint' &&
    !transaction.instructions.some((instruction) =>
      instruction.keys.some((key) => key.pubkey.toBase58() === session.ownerAddress),
    )
  ) {
    throw new HttpError('Signed transaction does not reference the prepared owner', 400, 400)
  }

  const signers = signerAddresses(transaction)
  const requiredSigners =
    session.kind === 'tree'
      ? [session.payerAddress, session.treeAddress, session.treeAuthority]
      : [session.payerAddress, session.treeAuthority]
  if (requiredSigners.some((address) => !signers.has(address))) {
    throw new HttpError('Signed transaction has unexpected signer accounts', 400, 400)
  }
  if (
    transaction.signatures.some((signature) => signature.signature === null) ||
    !transaction.verifySignatures(true)
  ) {
    throw new HttpError('Signed transaction signatures are incomplete or invalid', 400, 400)
  }
}

export type ConfirmationResult = 'success' | 'failed' | 'pending'

export type MintTransactionInspection =
  | { result: 'pending'; seenOnChain: boolean }
  | { result: 'failed' }
  | { result: 'confirmed'; leafIndex: number }
  | { result: 'confirmed-unresolved' }

export async function inspectMintTransaction(
  connection: Connection,
  signature: string,
  expectedTree: PublicKey,
): Promise<MintTransactionInspection> {
  const response = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!response) {
    const status = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    })
    if (status.value?.err) return { result: 'failed' }
    return { result: 'pending', seenOnChain: status.value !== null }
  }
  if (response.meta?.err) return { result: 'failed' }
  if (!response.meta?.innerInstructions) return { result: 'confirmed-unresolved' }

  const message = response.transaction.message
  const accountKeys =
    message.version === 'legacy'
      ? message.getAccountKeys()
      : message.getAccountKeys({
          accountKeysFromLookups: response.meta.loadedAddresses,
        })
  const leafIndexes = new Set<number>()

  for (const group of response.meta.innerInstructions) {
    for (const instruction of group.instructions) {
      const programId = accountKeys.get(instruction.programIdIndex)
      if (!programId?.equals(SPL_NOOP_PROGRAM_ID)) continue
      try {
        const event = deserializeChangeLogEventV1(
          Buffer.from(bs58.decode(instruction.data)),
        )
        if (event.treeId.equals(expectedTree)) leafIndexes.add(event.index)
      } catch {
        // The noop wrapper may also contain application-data events. Only the
        // account-compression change log for the prepared tree is authoritative.
      }
    }
  }

  if (leafIndexes.size !== 1) return { result: 'confirmed-unresolved' }
  return { result: 'confirmed', leafIndex: [...leafIndexes][0] }
}

export async function sendAndConfirmPreparedTransaction(options: {
  connection: Connection
  transaction: Transaction
  blockhash: string
  lastValidBlockHeight: number
}) {
  const signature = await options.connection.sendRawTransaction(
    options.transaction.serialize({ requireAllSignatures: true, verifySignatures: true }),
    { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 },
  )

  let result: ConfirmationResult = 'pending'
  try {
    const confirmation = await options.connection.confirmTransaction(
      {
        signature,
        blockhash: options.blockhash,
        lastValidBlockHeight: options.lastValidBlockHeight,
      },
      'confirmed',
    )
    result = confirmation.value.err ? 'failed' : 'success'
  } catch {
    try {
      const status = await options.connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      })
      if (status.value?.err) result = 'failed'
      else if (
        status.value?.confirmationStatus === 'confirmed' ||
        status.value?.confirmationStatus === 'finalized'
      ) {
        result = 'success'
      }
    } catch {
      result = 'pending'
    }
  }
  return { signature, result }
}

export async function inspectMerkleTreeAccount(connection: Connection, address: PublicKey) {
  const accountInfo = await connection.getAccountInfo(address, 'confirmed')
  if (!accountInfo) return null
  if (!accountInfo.owner.equals(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID)) {
    throw new HttpError('Tree account is not owned by the account-compression program', 409, 409)
  }
  try {
    const tree = ConcurrentMerkleTreeAccount.fromBuffer(Buffer.from(accountInfo.data))
    return {
      maxDepth: tree.getMaxDepth(),
      maxBufferSize: tree.getMaxBufferSize(),
      canopyDepth: tree.getCanopyDepth(),
      currentSequence: Number(tree.getCurrentSeq().toString()),
    }
  } catch {
    throw new HttpError('Tree account data is invalid', 409, 409)
  }
}

export function isLikelyRpcError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return [
    'fetch failed',
    'network',
    'timeout',
    'timed out',
    '429',
    '503',
    'econn',
    'socket',
    'rpc',
  ].some((fragment) => message.includes(fragment))
}
