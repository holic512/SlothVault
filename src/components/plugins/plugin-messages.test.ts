import { createTranslator, type MessageKeys, type NestedKeyOf } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import { messages as solMessages } from '../../../plugins/sol-payments/src/messages'
import { messages as giftMessages } from '../../../plugins/gift-cards/src/messages'

function messageKeys<T>(messages: T): Array<MessageKeys<T, NestedKeyOf<T>>> {
  const visit = (value: unknown, prefix = ''): string[] => {
    if (typeof value === 'string') return [prefix]
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => visit(child, prefix ? `${prefix}.${key}` : key))
  }
  return visit(messages) as Array<MessageKeys<T, NestedKeyOf<T>>>
}

describe('independently bundled plugin messages', () => {
  it.each([['SOL', solMessages], ['Gift cards', giftMessages]] as const)('%s includes matching Chinese and English catalogs', (_, messages) => {
    expect(messageKeys(messages.zh).sort()).toEqual(messageKeys(messages.en).sort())
  })

  it.each(['zh', 'en'] as const)('%s renders every bundled plugin message', locale => {
    const messages = { Plugins: { ...solMessages[locale].Plugins, ...giftMessages[locale].Plugins } }
    const onError = vi.fn()
    const t = createTranslator({ locale, messages, onError })
    for (const key of messageKeys(messages)) {
      expect(t(key, { points: '100', value: '100', min: '1', max: '1000000' })).not.toEqual(key)
    }
    expect(onError).not.toHaveBeenCalled()
  })

  it('provides distinct connected-wallet actions and explains paused orders in both languages', () => {
    for (const locale of ['zh', 'en'] as const) {
      const c = solMessages[locale].Plugins.solPayments
      expect(c.switchWallet).not.toEqual(c.connect)
      expect(c.paused).toBeTruthy()
      expect(c.walletMismatch).toBeTruthy()
      expect(c.errors.WALLET_CANCELLED).toBeTruthy()
    }
  })
})
