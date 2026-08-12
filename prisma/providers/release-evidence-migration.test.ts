import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const providers = ['postgresql', 'mysql', 'sqlite'] as const

describe('release transaction evidence migrations', () => {
  it.each(providers)('%s removes legacy runtime state and creates portable evidence constraints', (provider) => {
    const sql = readFileSync(resolve(process.cwd(), `prisma/providers/${provider}/migrations/20260813000000_release_transaction_evidence/migration.sql`), 'utf8')
    expect(sql).toContain('solana_compressed_nft')
    expect(sql).toContain('solana_merkle_tree')
    expect(sql).toContain('system_runtime_lock')
    expect(sql).toContain('release_credential')
    expect(sql).toContain('release_credential_attempt')
    expect(sql).toContain('uq_release_credential_version_network')
    expect(sql).toContain('uq_release_credential_transaction_signature')
    expect(sql).toContain('FILEBASE_SECRET_KEY')
  })
})
