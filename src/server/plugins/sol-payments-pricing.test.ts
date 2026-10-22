import { describe, expect, it } from 'vitest'
import { decimal, formatSol, paymentLamports } from '../../../plugins/sol-payments/src/pricing'
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
})
