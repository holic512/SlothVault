/**
 * @file market-data.ts
 * @project SlothVault
 * @module System Market Data
 * @description Fetches fresh public SOL/USDT quotes through configured primary and fallback sources.
 * @logic Pin validated public DNS addresses, bound response lifetime and size, fail closed, and only coalesce in-flight requests.
 * @dependencies node:https, node:dns, system-config, market-data types
 * @index_tags market,quotes,ssrf,failover,settings
 * @author holic512
 */
import 'server-only'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { getConfigValue } from './system-config'
import { HttpError } from '@/server/http/errors'
import { MARKET_DEFAULTS, type MarketProvider, type MarketQuote, type MarketSource, type MarketProbe } from '@/types/market-data'

const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix)
// Only ordinary global unicast IPv6; exclude transition and special-purpose ranges.
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(address, prefix, 'ipv6')
export function isPublicMarketAddress(address: string) {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
export function validateMarketUrl(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new HttpError('Invalid market source URL', 400) }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !isPublicMarketAddress(host))) throw new HttpError('Market sources require a public HTTPS endpoint', 400)
  return url
}
export async function fetchMarketJson(endpoint: string, signal: AbortSignal): Promise<unknown> {
  const url = validateMarketUrl(endpoint)
  // DNS is resolved inside the request's lookup callback: the timeout covers DNS,
  // TLS and the whole response, and the connection uses exactly the validated IP.
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, agent: false, headers: { Accept: 'application/json', 'User-Agent': 'SlothVault-Market/1' }, lookup: (hostname, options, callback) => {
      void lookup(hostname, { all: true }).then(addresses => {
        if (!addresses.length || addresses.some(item => !isPublicMarketAddress(item.address))) { callback(new Error('Non-public market source'), '', 4); return }
        const selected = addresses[0]
        if (options.all) callback(null, [selected])
        else callback(null, selected.address, selected.family)
      }).catch(error => callback(error, '', 4))
    } }, response => {
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > 64 * 1024) { response.destroy(); reject(new Error('Market source HTTP failure')); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 64 * 1024) { response.destroy(new Error('Market response too large')); return }; chunks.push(chunk) })
      response.on('error', reject)
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Invalid market JSON')) } })
    })
    req.on('error', reject); req.end()
  })
}
export function parseMarketQuote(provider: MarketProvider, value: unknown, now = Date.now()): MarketQuote {
  const data = value as { code?: unknown; data?: Record<string, unknown>[] }
  const row = Array.isArray(data?.data) && data.data.length === 1 ? data.data[0] : undefined
  const ok = provider === 'okx' ? data?.code === '0' && row?.instId === 'SOL-USDT' : data?.code === '00000' && row?.symbol === 'SOLUSDT'
  const price = row?.[provider === 'okx' ? 'last' : 'lastPr']
  const timestamp = Number(row?.ts)
  if (!ok || typeof price !== 'string' || !/^\d{1,16}(\.\d{1,18})?$/.test(price) || Number(price) <= 0 || !Number.isSafeInteger(timestamp) || now - timestamp > 60_000 || timestamp - now > 5_000) throw new HttpError('PRICE_UNAVAILABLE', 503)
  return { base: 'SOL', quote: 'USDT', price, provider, observedAt: new Date(timestamp).toISOString(), fetchedAt: new Date(now).toISOString() }
}
export async function marketSourceConfig(source: MarketSource) {
  const prefix = source === 'primary' ? 'MARKET_PRIMARY' : 'MARKET_FALLBACK'
  const [provider, url] = await Promise.all([getConfigValue(`${prefix}_PROVIDER`), getConfigValue(`${prefix}_URL`)])
  const selected = provider || MARKET_DEFAULTS[`${prefix}_PROVIDER`]
  if (selected !== 'okx' && selected !== 'bitget') throw new HttpError('Invalid market provider', 400)
  return { provider: selected as MarketProvider, url: url || MARKET_DEFAULTS[`${prefix}_URL`] }
}
export async function probeMarketSource(source: MarketSource, outerSignal?: AbortSignal): Promise<MarketProbe> {
  const start = Date.now()
  try {
    const config = await marketSourceConfig(source)
    const timeout = AbortSignal.timeout(3000)
    const quote = parseMarketQuote(config.provider, await fetchMarketJson(config.url, outerSignal ? AbortSignal.any([timeout, outerSignal]) : timeout))
    return { source, ok: true, latencyMs: Date.now() - start, testedAt: new Date().toISOString(), quote }
  } catch { return { source, ok: false, latencyMs: Date.now() - start, testedAt: new Date().toISOString(), error: 'PRICE_UNAVAILABLE' } }
}
let inFlight: Promise<MarketQuote> | undefined
export function getMarketQuote(): Promise<MarketQuote> {
  if (!inFlight) inFlight = (async () => {
    for (const source of ['primary', 'fallback'] as const) { const result = await probeMarketSource(source); if (result.quote) return result.quote }
    throw new HttpError('PRICE_UNAVAILABLE', 503, 503, { reason: 'PRICE_UNAVAILABLE' })
  })().finally(() => { inFlight = undefined })
  return inFlight
}
