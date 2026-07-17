import {
  accountCompressionEventBeet,
  SPL_NOOP_PROGRAM_ID,
  type AccountCompressionEvent,
} from '@solana/spl-account-compression'
import { Connection, Keypair, type PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/services/system-config', () => ({
  getSolanaRpcUrl: vi.fn(async () => 'http://127.0.0.1:8899'),
}))

import {
  getAssetId,
  inspectMintTransaction,
} from '@/server/services/solana-chain'

function changeLogData(tree: PublicKey, index: number) {
  const event: AccountCompressionEvent = {
    __kind: 'ChangeLog',
    fields: [
      {
        __kind: 'V1',
        fields: [{ id: tree, path: [], seq: index + 1, index }],
      },
    ],
  }
  const fixed = accountCompressionEventBeet.toFixedFromValue(event)
  const data = Buffer.alloc(fixed.byteSize)
  fixed.write(data, 0, event)
  return bs58.encode(data)
}

function confirmedTransaction(events: Array<{ tree: PublicKey; index: number }>) {
  return {
    meta: {
      err: null,
      innerInstructions: [
        {
          index: 0,
          instructions: events.map((event) => ({
            programIdIndex: 0,
            accounts: [],
            data: changeLogData(event.tree, event.index),
          })),
        },
      ],
      loadedAddresses: undefined,
    },
    transaction: {
      message: {
        version: 'legacy',
        getAccountKeys: () => ({
          get: (index: number) => index === 0 ? SPL_NOOP_PROGRAM_ID : undefined,
        }),
      },
    },
  }
}

function mockConnection(options: {
  transaction: unknown
  status?: unknown
}) {
  return {
    getTransaction: vi.fn(async () => options.transaction),
    getSignatureStatus: vi.fn(async () => ({ value: options.status ?? null })),
  } as unknown as Connection
}

describe('Solana mint transaction inspection', () => {
  it('derives final assets from each confirmed change log when submissions arrive out of order', async () => {
    const tree = Keypair.generate().publicKey
    const preparedFirst = await inspectMintTransaction(
      mockConnection({ transaction: confirmedTransaction([{ tree, index: 1 }]) }),
      'first-signature',
      tree,
    )
    const preparedSecond = await inspectMintTransaction(
      mockConnection({ transaction: confirmedTransaction([{ tree, index: 0 }]) }),
      'second-signature',
      tree,
    )

    expect(preparedFirst).toEqual({ result: 'confirmed', leafIndex: 1 })
    expect(preparedSecond).toEqual({ result: 'confirmed', leafIndex: 0 })
    expect(getAssetId(tree, 1).toBase58()).not.toBe(getAssetId(tree, 0).toBase58())
  })

  it('keeps a confirmed transaction unresolved when the expected tree has ambiguous leaves', async () => {
    const tree = Keypair.generate().publicKey
    const result = await inspectMintTransaction(
      mockConnection({
        transaction: confirmedTransaction([
          { tree, index: 3 },
          { tree, index: 4 },
        ]),
      }),
      'ambiguous-signature',
      tree,
    )

    expect(result).toEqual({ result: 'confirmed-unresolved' })
  })

  it('reports an explicit on-chain transaction error as failed', async () => {
    const tree = Keypair.generate().publicKey
    const result = await inspectMintTransaction(
      mockConnection({
        transaction: {
          meta: { err: { InstructionError: [0, 'Custom'] } },
          transaction: { message: {} },
        },
      }),
      'failed-signature',
      tree,
    )

    expect(result).toEqual({ result: 'failed' })
  })

  it('distinguishes unseen and observed signatures while transaction history is pending', async () => {
    const tree = Keypair.generate().publicKey
    const unseenConnection = mockConnection({ transaction: null })
    const observedConnection = mockConnection({
      transaction: null,
      status: { err: null, confirmationStatus: 'processed' },
    })

    await expect(
      inspectMintTransaction(unseenConnection, 'unseen-signature', tree),
    ).resolves.toEqual({ result: 'pending', seenOnChain: false })
    await expect(
      inspectMintTransaction(observedConnection, 'observed-signature', tree),
    ).resolves.toEqual({ result: 'pending', seenOnChain: true })
  })
})
