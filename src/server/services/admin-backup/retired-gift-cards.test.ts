import { describe, expect, it } from 'vitest'
import { discardRetiredCardPayload } from './retired-gift-cards'
describe('retired card backup conversion', () => {
  it('drops legacy card state while preserving other plugins and financial receipts', () => {
    const receipt = { pluginId: 'slothvault.gift-cards', sourceKey: 'old-credit' }
    const result = discardRetiredCardPayload({ giftCards: [{ id: '1' }], giftCardBatches: [{ id: '2' }], pluginInstallations: [{ pluginId: 'slothvault.gift-cards' }, { pluginId: 'test.other' }], pluginTables: [{ pluginId: 'slothvault.gift-cards' }], pluginMigrations: [], pluginRows: [], pluginPointReceipts: [receipt], pointTransactions: [{ id: '3' }] })
    expect(result.giftCards).toEqual([])
    expect(result.giftCardBatches).toEqual([])
    expect(result).toMatchObject({ pluginInstallations: [{ pluginId: 'test.other' }], pluginTables: [], pluginPointReceipts: [receipt], pointTransactions: [{ id: '3' }] })
  })
})
