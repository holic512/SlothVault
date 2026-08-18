import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const providers = ['postgresql', 'mysql', 'sqlite'] as const

describe('contract evidence migrations', () => {
  it.each(providers)('%s creates frozen contract and independent evidence tables', (provider) => {
    const sql = readFileSync(resolve(process.cwd(), `prisma/providers/${provider}/migrations/20260818000000_contract_evidence/migration.sql`), 'utf8')
    expect(sql).toContain('contract_credential')
    expect(sql).toContain('contract_credential_attempt')
    expect(sql).toContain('contract_admin_audit')
    expect(sql).toContain('party_commitment')
    expect(sql).toContain('attachment_hash')
    expect(sql).toContain('uq_contract_credential_contract_network')
  })
})
