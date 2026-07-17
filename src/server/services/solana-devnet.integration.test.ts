import { randomBytes } from 'node:crypto'

import {
  deserializeChangeLogEventV1,
  SPL_NOOP_PROGRAM_ID,
} from '@solana/spl-account-compression'
import { Connection, clusterApiUrl, type PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/services/system-config', () => ({
  getSolanaRpcUrl: vi.fn(async () => clusterApiUrl('devnet')),
}))

import {
  BUBBLEGUM_PROGRAM_ID,
  inspectMerkleTreeAccount,
  inspectMintTransaction,
} from '@/server/services/solana-chain'

type CompiledInstructionLike = {
  programIdIndex: number
  data: string | Uint8Array
}

function mintTreeFromTransaction(
  transaction: Awaited<ReturnType<Connection['getTransaction']>>,
) {
  if (!transaction || transaction.meta?.err) return null
  const isMint = transaction.meta?.logMessages?.some((message) =>
    /Program log: Instruction: Mint(?:ToCollection)?V\d+$/.test(message),
  )
  if (!isMint || !transaction.meta?.innerInstructions) return null

  const message = transaction.transaction.message
  const accountKeys =
    message.version === 'legacy'
      ? message.getAccountKeys()
      : message.getAccountKeys({
          accountKeysFromLookups: transaction.meta?.loadedAddresses,
        })
  const treeIds = new Map<string, PublicKey>()
  const instructions = transaction.meta.innerInstructions.flatMap(
    (group) => group.instructions as CompiledInstructionLike[],
  )

  for (const instruction of instructions) {
    const programId = accountKeys.get(instruction.programIdIndex)
    if (!programId?.equals(SPL_NOOP_PROGRAM_ID)) continue
    try {
      const encoded =
        typeof instruction.data === 'string'
          ? Buffer.from(bs58.decode(instruction.data))
          : Buffer.from(instruction.data)
      const event = deserializeChangeLogEventV1(encoded)
      treeIds.set(event.treeId.toBase58(), event.treeId)
    } catch {
      // Bubblegum also emits application-data events through the noop wrapper.
    }
  }

  return treeIds.size === 1 ? [...treeIds.values()][0] : null
}

async function findRecentMint(connection: Connection) {
  const signatures = await connection.getSignaturesForAddress(
    BUBBLEGUM_PROGRAM_ID,
    { limit: 20 },
    'confirmed',
  )
  const successful = signatures.filter((item) => !item.err)
  for (const item of successful) {
    const transaction = await connection.getTransaction(item.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    const tree = mintTreeFromTransaction(transaction)
    if (tree) return { signature: item.signature, tree }
  }
  return null
}

const runDevnet = process.env.RUN_SOLANA_DEVNET_SMOKE === '1'

describe.runIf(runDevnet)('Solana devnet read-only integration', () => {
  it(
    'connects to devnet and reconciles a real Bubblegum mint change log',
    async () => {
      const connection = new Connection(clusterApiUrl('devnet'), {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 30_000,
      })
      const [version, blockhash, blockHeight, programAccount] = await Promise.all([
        connection.getVersion(),
        connection.getLatestBlockhash('confirmed'),
        connection.getBlockHeight('confirmed'),
        connection.getAccountInfo(BUBBLEGUM_PROGRAM_ID, 'confirmed'),
      ])

      expect(version['solana-core']).toMatch(/^\d+\.\d+/)
      expect(blockhash.blockhash).toHaveLength(44)
      expect(blockhash.lastValidBlockHeight).toBeGreaterThan(blockHeight)
      expect(programAccount?.executable).toBe(true)

      const recentMint = await findRecentMint(connection)
      expect(
        recentMint,
        'No recent successful Bubblegum mint transaction with a unique change log was found',
      ).not.toBeNull()
      const mint = recentMint as { signature: string; tree: PublicKey }

      const inspection = await inspectMintTransaction(
        connection,
        mint.signature,
        mint.tree,
      )
      expect(inspection).toMatchObject({ result: 'confirmed' })
      if (inspection.result !== 'confirmed') return
      expect(inspection.leafIndex).toBeGreaterThanOrEqual(0)

      const tree = await inspectMerkleTreeAccount(connection, mint.tree)
      expect(tree).not.toBeNull()
      expect(tree?.currentSequence).toBeGreaterThan(inspection.leafIndex)
      expect(tree?.maxDepth).toBeGreaterThan(0)
      expect(tree?.maxBufferSize).toBeGreaterThan(0)
    },
    60_000,
  )

  it(
    'treats an unseen but correctly shaped signature as pending',
    async () => {
      const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
      const signature = bs58.encode(randomBytes(64))
      const inspection = await inspectMintTransaction(
        connection,
        signature,
        BUBBLEGUM_PROGRAM_ID,
      )
      expect(inspection).toEqual({ result: 'pending', seenOnChain: false })
    },
    30_000,
  )
})
