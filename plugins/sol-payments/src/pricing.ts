export function decimal(value: string) {
  if (!/^\d{1,16}(\.\d{1,18})?$/.test(value)) throw new Error('INVALID_PRICE')
  const [integer, fraction = ''] = value.split('.')
  const units = BigInt(integer + fraction)
  if (units <= 0n) throw new Error('INVALID_PRICE')
  return { units, scale: 10n ** BigInt(fraction.length) }
}
export function paymentLamports(points: number, rate: string, price: string) {
  if (!Number.isSafeInteger(points) || points < 1 || points > 1_000_000) throw new Error('INVALID_POINTS')
  const r = decimal(rate), s = decimal(price)
  const numerator = BigInt(points) * 1_000_000_000n * r.scale * s.scale, denominator = r.units * s.units
  const amount = (numerator + denominator - 1n) / denominator
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PAYMENT_AMOUNT_TOO_LARGE')
  return amount.toString()
}
export function formatSol(lamports: string) {
  const value = BigInt(lamports)
  return `${value / 1_000_000_000n}.${(value % 1_000_000_000n).toString().padStart(9, '0')}`
}
