import { describe, expect, it } from 'vitest'
import { decimal, formatSol, formatPayment, paymentLamports, paymentTokenAmount } from '../../../plugins/sol-payments/src/pricing'
describe('locked quote arithmetic', () => {
  it('prices integers in lamports and rounds upward without floating point', () => {
    expect(paymentLamports(1000, '100', '100')).toBe('100000000')
    expect(paymentLamports(1, '3', '1')).toBe('333333334')
    expect(paymentLamports(999999, '0.00000001', '9999999999999999.999999999999999999')).toBe('9999991')
    expect(formatSol('100000001')).toBe('0.100000001')
  })
  it.each(['0','-1','NaN','Infinity','1e6','1.1234567890123456789'])('rejects unsafe decimal %s', value => expect(()=>decimal(value)).toThrow())
  it('rejects invalid points and excessive transfers',()=>{
    expect(()=>paymentLamports(1.2,'1','1')).toThrow()
    expect(()=>paymentLamports(1000001,'1','1')).toThrow()
    expect(()=>paymentLamports(1000000,'0.00000001','0.00000001')).toThrow()
  })
  it('prices USDT directly in six-decimal units, rounds up and supports amounts beyond safe floating-point integers', () => {
    expect(paymentTokenAmount(1000, '100')).toBe('10000000')
    expect(paymentTokenAmount(1, '3')).toBe('333334')
    expect(paymentTokenAmount(1, '1000000000')).toBe('1')
    expect(paymentTokenAmount(10000, '0.00000001')).toBe('1000000000000000000')
  })
  it('rejects invalid points and USDT amounts outside the token u64 range', () => {
    expect(() => paymentTokenAmount(1.2, '1')).toThrow('INVALID_POINTS')
    expect(() => paymentTokenAmount(1000001, '1')).toThrow('INVALID_POINTS')
    expect(() => paymentTokenAmount(1000000, '0.00000001')).toThrow('PAYMENT_AMOUNT_TOO_LARGE')
    expect(paymentTokenAmount(10000, '0.00000001')).toBe('1000000000000000000')
  })
  it('formats exact token amounts without converting them to floating point', () => {
    expect(formatPayment('333334', 'USDT')).toBe('0.333334')
    expect(formatPayment('1', 'USDT')).toBe('0.000001')
    expect(formatPayment('18446744073709551615', 'USDT')).toBe('18446744073709.551615')
    expect(formatPayment('100000001', 'SOL')).toBe('0.100000001')
  })
})
