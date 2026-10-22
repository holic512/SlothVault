/**
 * @file market-data.ts
 * @project SlothVault
 * @module Shared Market Data Contract
 * @description Defines system-owned market sources and normalized SOL quotes.
 * @logic Share source defaults between settings and server adapters.
 * @dependencies None
 * @index_tags market,settings,quotes
 * @author holic512
 */
export type MarketProvider = 'okx' | 'bitget'
export type MarketQuote = { base: 'SOL'; quote: 'USDT'; price: string; provider: MarketProvider; observedAt: string; fetchedAt: string }
export const MARKET_SOURCES = ['primary', 'fallback'] as const
export type MarketSource = typeof MARKET_SOURCES[number]
export const MARKET_DEFAULTS = {
  MARKET_PRIMARY_PROVIDER: 'okx',
  MARKET_PRIMARY_URL: 'https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT',
  MARKET_FALLBACK_PROVIDER: 'bitget',
  MARKET_FALLBACK_URL: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=SOLUSDT',
} as const
export type MarketProbe = { source: MarketSource; ok: boolean; latencyMs: number; testedAt: string; quote?: MarketQuote; error?: string }
