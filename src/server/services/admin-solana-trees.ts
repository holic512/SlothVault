/**
 * @file admin-solana-trees.ts
 * @project SlothVault
 * @module Solana Tree Administration
 * @description Implements configured-network management and the portable Merkle Tree list, estimate, prepare, submit, verify, and safe-delete workflow.
 * @logic Build server-partially-signed transactions, seal immutable prepare context, validate wallet submissions, serialize priority through a database lock record, persist chain outcomes idempotently, and reconcile confirmed and remaining capacity from chain state.
 * @dependencies Prisma MerkleTree/SystemConfig models, solana-chain, solana-session
 * @index_tags admin,solana,merkle-tree,prepare,submit,verify
 * @author holic512
 */
import 'server-only'

import { Keypair, SystemProgram } from '@solana/web3.js'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { hasPrismaCode } from '@/server/services/admin-catalog'
import {
  BUBBLEGUM_PROGRAM_ID,
  TREE_PRESETS,
  assertPreparedTransaction,
  buildCreateTreeTransaction,
  estimateRentOffline,
  formatSol,
  getSolanaConnection,
  inspectMerkleTreeAccount,
  isLikelyRpcError,
  parseSignedTransaction,
  parseSolanaPublicKey,
  sendAndConfirmPreparedTransaction,
  serializePreparedTransaction,
  transactionMessageHash,
  treeAccountSpace,
} from '@/server/services/solana-chain'
import {
  encryptTreeAuthorityKey,
  openSolanaSession,
  sealSolanaSession,
  secretKeyToBase64,
} from '@/server/services/solana-session'
import {
  CONFIG_KEYS,
  getSolanaNetwork,
  type SolanaNetwork,
} from '@/server/services/system-config'

export const TREE_STATUS = {
  FAILED: -1,
  CREATING: 0,
  NORMAL: 1,
  FULL: 2,
} as const

function treeDto(tree: {
  id: number
  name: string
  treeAddress: string
  treeAuthority: string
  creatorAddress: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  network: string
  totalMinted: number
  maxCapacity: bigint
  creationCost: bigint
  txSignature: string | null
  priority: number
  status: number
  createdAt: Date
  updatedAt: Date
  _count?: { cnfts: number }
}) {
  return {
    id: tree.id.toString(),
    name: tree.name,
    treeAddress: tree.treeAddress,
    treeAuthority: tree.treeAuthority,
    creatorAddress: tree.creatorAddress,
    maxDepth: tree.maxDepth,
    maxBufferSize: tree.maxBufferSize,
    canopyDepth: tree.canopyDepth,
    network: tree.network,
    totalMinted: tree.totalMinted,
    maxCapacity: tree.maxCapacity.toString(),
    creationCost: tree.creationCost.toString(),
    txSignature: tree.txSignature,
    priority: tree.priority,
    status: tree.status,
    createdAt: tree.createdAt,
    updatedAt: tree.updatedAt,
    mintedCount: tree._count?.cnfts ?? 0,
  }
}

function throwSolanaOperationError(error: unknown, operation: string): never {
  if (error instanceof HttpError) throw error
  console.error(`[solana-tree] ${operation} failed`, error)
  if (isLikelyRpcError(error)) {
    throw new HttpError('Solana RPC is unavailable', 503, 503)
  }
  throw new HttpError(`Unable to ${operation}`, 500, 500)
}

export async function readAdminSolanaNetwork() {
  return { network: await getSolanaNetwork() }
}

export async function updateAdminSolanaNetwork(network: SolanaNetwork) {
  const config = await prisma.systemConfig.upsert({
    where: { configKey: CONFIG_KEYS.SOLANA_NETWORK },
    update: { configValue: network, updatedAt: new Date() },
    create: {
      configKey: CONFIG_KEYS.SOLANA_NETWORK,
      configValue: network,
      description: 'Solana network environment',
    },
  })
  return { network: config.configValue as SolanaNetwork }
}

export async function listMerkleTrees(network?: SolanaNetwork) {
  const trees = await prisma.merkleTree.findMany({
    where: { isDeleted: false, ...(network ? { network } : {}) },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      treeAddress: true,
      treeAuthority: true,
      creatorAddress: true,
      maxDepth: true,
      maxBufferSize: true,
      canopyDepth: true,
      network: true,
      totalMinted: true,
      maxCapacity: true,
      creationCost: true,
      txSignature: true,
      priority: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { cnfts: true } },
    },
  })
  return trees.map(treeDto)
}

async function estimateOne(
  network: SolanaNetwork,
  preset: { label?: string; maxDepth: number; maxBufferSize: number; canopyDepth: number },
  connection: Awaited<ReturnType<typeof getSolanaConnection>> | null,
) {
  const spaceBytes = treeAccountSpace(
    preset.maxDepth,
    preset.maxBufferSize,
    preset.canopyDepth,
  )
  let rentLamports = estimateRentOffline(spaceBytes)
  let isEstimate = true
  if (connection) {
    try {
      rentLamports = await connection.getMinimumBalanceForRentExemption(spaceBytes)
      isEstimate = false
    } catch {
      // The exact locked-package size is still used with the documented offline rent formula.
    }
  }
  return {
    ...(preset.label ? { label: preset.label } : {}),
    maxDepth: preset.maxDepth,
    maxBufferSize: preset.maxBufferSize,
    canopyDepth: preset.canopyDepth,
    capacity: 2 ** preset.maxDepth,
    spaceBytes,
    rentLamports,
    rentSol: formatSol(rentLamports),
    network,
    isEstimate,
  }
}

export async function estimateMerkleTree(options: {
  network: SolanaNetwork
  maxDepth?: number
  maxBufferSize?: number
  canopyDepth?: number
}) {
  let connection: Awaited<ReturnType<typeof getSolanaConnection>> | null = null
  try {
    connection = await getSolanaConnection(options.network)
    await connection.getLatestBlockhash('confirmed')
  } catch {
    connection = null
  }

  if (options.maxDepth !== undefined || options.maxBufferSize !== undefined) {
    if (options.maxDepth === undefined || options.maxBufferSize === undefined) {
      throw new HttpError('maxDepth and maxBufferSize must be supplied together', 400, 400)
    }
    return estimateOne(
      options.network,
      {
        maxDepth: options.maxDepth,
        maxBufferSize: options.maxBufferSize,
        canopyDepth: options.canopyDepth ?? 0,
      },
      connection,
    )
  }

  const presets = await Promise.all(
    TREE_PRESETS.map((preset) => estimateOne(options.network, preset, connection)),
  )
  return {
    presets: presets.map((preset) => ({
      label: preset.label,
      maxDepth: preset.maxDepth,
      maxBufferSize: preset.maxBufferSize,
      canopyDepth: preset.canopyDepth,
      capacity: preset.capacity,
      spaceBytes: preset.spaceBytes,
      rentLamports: preset.rentLamports,
      rentSol: preset.rentSol,
      network: preset.network,
    })),
    network: options.network,
    isEstimate: presets.some((preset) => preset.isEstimate),
  }
}

export async function prepareMerkleTree(options: {
  name: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  payerAddress: string
  network: SolanaNetwork
}) {
  const configuredNetwork = await getSolanaNetwork()
  if (configuredNetwork !== options.network) {
    throw new HttpError('Solana network changed; refresh and prepare again', 409, 409)
  }

  const payer = parseSolanaPublicKey(options.payerAddress, 'payerAddress')
  const treeKeypair = Keypair.generate()
  const treeAuthority = Keypair.generate()
  try {
    const connection = await getSolanaConnection(options.network)
    const prepared = await buildCreateTreeTransaction({
      connection,
      payer,
      treeKeypair,
      treeAuthority,
      maxDepth: options.maxDepth,
      maxBufferSize: options.maxBufferSize,
      canopyDepth: options.canopyDepth,
    })

    const fee = (await connection.getFeeForMessage(prepared.transaction.compileMessage())).value ?? 5_000
    const requiredLamports = prepared.rentLamports + fee
    const balance = await connection.getBalance(payer, 'confirmed')
    if (balance < requiredLamports) {
      throw new HttpError(
        `Wallet balance is insufficient; approximately ${formatSol(requiredLamports)} SOL is required`,
        400,
        400,
        { balance, required: requiredLamports, shortfall: requiredLamports - balance },
      )
    }

    const encryptedKey = encryptTreeAuthorityKey(
      secretKeyToBase64(treeAuthority.secretKey),
    )
    const session = sealSolanaSession({
      kind: 'tree',
      name: options.name,
      treeAddress: treeKeypair.publicKey.toBase58(),
      treeAuthority: treeAuthority.publicKey.toBase58(),
      encryptedKey,
      maxDepth: options.maxDepth,
      maxBufferSize: options.maxBufferSize,
      canopyDepth: options.canopyDepth,
      network: options.network,
      payerAddress: payer.toBase58(),
      rentLamports: prepared.rentLamports,
      spaceBytes: prepared.spaceBytes,
      messageHash: transactionMessageHash(prepared.transaction),
      recentBlockhash: prepared.blockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
      programIds: [SystemProgram.programId.toBase58(), BUBBLEGUM_PROGRAM_ID.toBase58()],
    })

    return {
      transactionBase64: serializePreparedTransaction(prepared.transaction),
      treeAddress: treeKeypair.publicKey.toBase58(),
      sessionId: session.token,
      rentLamports: prepared.rentLamports,
      spaceBytes: prepared.spaceBytes,
      expiresAt: session.expiresAt,
    }
  } catch (error) {
    throwSolanaOperationError(error, 'prepare Merkle Tree transaction')
  }
}

export async function submitMerkleTree(options: {
  sessionId: string
  signedTransactionBase64: string
}) {
  const session = openSolanaSession(options.sessionId, 'tree')
  const existing = await prisma.merkleTree.findUnique({
    where: { treeAddress: session.treeAddress },
  })
  if (existing) {
    return {
      data: treeDto({ ...existing, _count: { cnfts: 0 } }),
      message: 'Merkle Tree transaction was already submitted',
    }
  }

  const transaction = parseSignedTransaction(options.signedTransactionBase64)
  assertPreparedTransaction(transaction, session)

  let submitted: Awaited<ReturnType<typeof sendAndConfirmPreparedTransaction>>
  try {
    const connection = await getSolanaConnection(session.network)
    submitted = await sendAndConfirmPreparedTransaction({
      connection,
      transaction,
      blockhash: session.recentBlockhash,
      lastValidBlockHeight: session.lastValidBlockHeight,
    })
  } catch (error) {
    throwSolanaOperationError(error, 'submit Merkle Tree transaction')
  }

  const status =
    submitted.result === 'success'
      ? TREE_STATUS.NORMAL
      : submitted.result === 'failed'
        ? TREE_STATUS.FAILED
        : TREE_STATUS.CREATING
  const maxCapacity = 1n << BigInt(session.maxDepth)

  try {
    const record = await unitOfWork.execute(async (tx) => {
      const duplicate = await tx.merkleTree.findUnique({
        where: { treeAddress: session.treeAddress },
      })
      if (duplicate) return duplicate
      await tx.runtimeLock.update({
        where: { key: `solana-tree-priority:${session.network}` },
        data: { revision: { increment: 1 }, updatedAt: new Date() },
      })
      const priority = await tx.merkleTree.aggregate({
        where: { network: session.network, isDeleted: false },
        _max: { priority: true },
      })
      return tx.merkleTree.create({
        data: {
          name: session.name,
          treeAddress: session.treeAddress,
          treeAuthority: session.treeAuthority,
          encryptedKey: session.encryptedKey,
          creatorAddress: session.payerAddress,
          maxDepth: session.maxDepth,
          maxBufferSize: session.maxBufferSize,
          canopyDepth: session.canopyDepth,
          network: session.network,
          totalMinted: 0,
          maxCapacity,
          remainingCapacity: maxCapacity,
          creationCost: BigInt(session.rentLamports),
          txSignature: submitted.signature,
          priority: (priority._max.priority ?? 0) + 1,
          status,
        },
      })
    })
    return {
      data: treeDto({ ...record, _count: { cnfts: 0 } }),
      message:
        status === TREE_STATUS.NORMAL
          ? 'Merkle Tree created'
          : status === TREE_STATUS.FAILED
            ? 'Merkle Tree transaction failed'
            : 'Merkle Tree transaction submitted and is awaiting confirmation',
    }
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      const duplicate = await prisma.merkleTree.findUnique({
        where: { treeAddress: session.treeAddress },
      })
      if (duplicate) {
        return {
          data: treeDto({ ...duplicate, _count: { cnfts: 0 } }),
          message: 'Merkle Tree transaction was already submitted',
        }
      }
    }
    console.error('[solana-tree] Chain transaction submitted but persistence failed', error)
    throw new HttpError(
      'Transaction was submitted but the Merkle Tree record could not be saved',
      500,
      500,
      { txSignature: submitted.signature, treeAddress: session.treeAddress },
    )
  }
}

export function reconciledRemainingCapacity(options: {
  maxCapacity: bigint
  currentSequence: number
  pendingAttempts: number
  storedRemainingCapacity: bigint
}) {
  const upperBound = options.maxCapacity - BigInt(options.currentSequence)
  const lowerBoundCandidate = upperBound - BigInt(options.pendingAttempts)
  const lowerBound = lowerBoundCandidate > 0n ? lowerBoundCandidate : 0n
  const valid =
    upperBound >= 0n &&
    options.storedRemainingCapacity >= lowerBound &&
    options.storedRemainingCapacity <= upperBound
  return {
    valid,
    remainingCapacity:
      options.pendingAttempts === 0 ? upperBound : options.storedRemainingCapacity,
    lowerBound,
    upperBound,
  }
}

export async function verifyMerkleTree(id: number) {
  const tree = await prisma.merkleTree.findFirst({
    where: { id, isDeleted: false },
  })
  if (!tree) throw new HttpError('Merkle Tree not found', 404, 404)
  if (tree.network !== 'mainnet' && tree.network !== 'devnet') {
    throw new HttpError('Merkle Tree has an invalid network', 409, 409)
  }

  try {
    const connection = await getSolanaConnection(tree.network)
    const account = await inspectMerkleTreeAccount(
      connection,
      parseSolanaPublicKey(tree.treeAddress, 'treeAddress'),
    )
    if (account) {
      return unitOfWork.execute(async (tx) => {
        const currentTree = await tx.merkleTree.findFirst({
          where: { id: tree.id, isDeleted: false },
        })
        if (!currentTree) throw new HttpError('Merkle Tree not found', 404, 404)

        if (
          account.maxDepth !== currentTree.maxDepth ||
          account.maxBufferSize !== currentTree.maxBufferSize ||
          account.canopyDepth !== currentTree.canopyDepth
        ) {
          await tx.merkleTree.update({
            where: { id: currentTree.id },
            data: {
              capacityRevision: { increment: 1 },
              status: TREE_STATUS.FAILED,
              updatedAt: new Date(),
            },
          })
          return {
            status: TREE_STATUS.FAILED,
            message: 'On-chain tree parameters do not match the record',
          }
        }

        const [pendingAttempts, highestConfirmedLeaf] = await Promise.all([
          tx.compressedNft.count({
            where: { merkleTreeId: currentTree.id, status: 0, capacityReserved: true },
          }),
          tx.compressedNft.aggregate({
            where: { merkleTreeId: currentTree.id, status: 1 },
            _max: { leafIndex: true },
          }),
        ])
        if (pendingAttempts > 0 && account.currentSequence !== currentTree.totalMinted) {
          return {
            status: currentTree.status,
            message: 'Pending cNFT attempts must be reconciled before synchronizing the tree sequence',
            currentSequence: account.currentSequence,
          }
        }

        const capacity = reconciledRemainingCapacity({
          maxCapacity: currentTree.maxCapacity,
          currentSequence: account.currentSequence,
          pendingAttempts,
          storedRemainingCapacity: currentTree.remainingCapacity,
        })
        const statePredicate = {
          id: currentTree.id,
          totalMinted: currentTree.totalMinted,
          remainingCapacity: currentTree.remainingCapacity,
          capacityRevision: currentTree.capacityRevision,
          status: currentTree.status,
          isDeleted: false,
        }
        const concurrentlyChanged = async () => {
          const latest = await tx.merkleTree.findUnique({ where: { id: currentTree.id } })
          return {
            status: latest?.status ?? currentTree.status,
            message: 'Merkle Tree capacity changed concurrently; verify again',
            currentSequence: account.currentSequence,
          }
        }

        if (
          !capacity.valid ||
          (highestConfirmedLeaf._max.leafIndex !== null &&
            highestConfirmedLeaf._max.leafIndex >= account.currentSequence)
        ) {
          const failed = await tx.merkleTree.updateMany({
            where: statePredicate,
            data: {
              capacityRevision: { increment: 1 },
              status: TREE_STATUS.FAILED,
              updatedAt: new Date(),
            },
          })
          if (failed.count === 0) return concurrentlyChanged()
          return {
            status: TREE_STATUS.FAILED,
            message: capacity.valid
              ? 'The on-chain sequence conflicts with confirmed local cNFT records'
              : 'Local cNFT reservations conflict with the on-chain tree capacity',
            currentSequence: account.currentSequence,
          }
        }

        const status =
          capacity.remainingCapacity === 0n ? TREE_STATUS.FULL : TREE_STATUS.NORMAL
        const synchronized = await tx.merkleTree.updateMany({
          where: statePredicate,
          data: {
            totalMinted: account.currentSequence,
            remainingCapacity: capacity.remainingCapacity,
            capacityRevision: { increment: 1 },
            status,
            updatedAt: new Date(),
          },
        })
        if (synchronized.count === 0) return concurrentlyChanged()
        return {
          status,
          message: 'Merkle Tree account is valid on chain',
          currentSequence: account.currentSequence,
        }
      })
    }

    if (tree.txSignature) {
      const signatureStatus = await connection.getSignatureStatus(tree.txSignature, {
        searchTransactionHistory: true,
      })
      if (signatureStatus.value?.err) {
        const failed = await unitOfWork.execute((tx) =>
          tx.merkleTree.updateMany({
            where: {
              id: tree.id,
              status: tree.status,
              capacityRevision: tree.capacityRevision,
              isDeleted: false,
            },
            data: {
              capacityRevision: { increment: 1 },
              status: TREE_STATUS.FAILED,
              updatedAt: new Date(),
            },
          }),
        )
        if (failed.count === 0) {
          const latest = await prisma.merkleTree.findUnique({ where: { id: tree.id } })
          return {
            status: latest?.status ?? tree.status,
            message: 'Merkle Tree state changed concurrently; verify again',
          }
        }
        return { status: TREE_STATUS.FAILED, message: 'Merkle Tree transaction failed on chain' }
      }
    }
    return { status: tree.status, message: 'Merkle Tree is awaiting chain confirmation' }
  } catch (error) {
    throwSolanaOperationError(error, 'verify Merkle Tree')
  }
}

export async function deleteMerkleTree(id: number) {
  const tree = await prisma.merkleTree.findFirst({
    where: { id, isDeleted: false },
    include: { _count: { select: { cnfts: true } } },
  })
  if (!tree) throw new HttpError('Merkle Tree not found', 404, 404)
  if (tree.status !== TREE_STATUS.CREATING && tree.status !== TREE_STATUS.FAILED) {
    throw new HttpError('Only creating or failed Merkle Tree records can be deleted', 400, 400)
  }
  if (tree._count.cnfts > 0) {
    throw new HttpError('Delete related failed cNFT records before deleting this tree', 409, 409)
  }
  await prisma.merkleTree.update({
    where: { id: tree.id },
    data: { isDeleted: true, updatedAt: new Date() },
  })
  return { id: tree.id.toString(), deleted: true }
}
