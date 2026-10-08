import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import builtin from '@/server/commissions/builtin-template.json'
import type { TemplateField } from '@/types/commissions'
import { renderContractDocument, renderTemplate, derivedTemplateValues, validateTemplateDefinition } from './contract-template'
import { addWorkingDays, beijingDate, chineseMoney, paymentFacts, splitPayments, yuanToFen } from './commissions'
const fields = builtin.fields as TemplateField[]
import { completeAgreementValues } from '@/server/commissions/test-fixtures'
describe('supplied contract template and exact business rules', () => {
  it('retains 19 articles, three appendices, all original clause numbers and checkbox choices', () => {
    const source = readFileSync('src/server/commissions/software-development-contract.source.md', 'utf8')
    expect(createHash('sha256').update(source).digest('hex')).toBe(builtin.sourceSha256)
    expect(builtin.documents.AGREEMENT.match(/^## 第.+条/gm)).toHaveLength(19)
    const all = Object.values(builtin.documents).join('\n')
    for (const number of source.matchAll(/^\d+\.\d+/gm)) expect(all).toContain(number[0])
    for (const line of source.split('\n').filter((s) => s.includes('□') && !s.startsWith('|'))) {
      const text = line.replaceAll('□', '').replace(/_+/g, '').trim()
      if (text && !line.includes('___')) {
        const plain = all.replace(/{{[\s\S]*?}}/g, '').replaceAll('□', '').replaceAll('☑', '').trim()
        expect(plain).toContain(text)
      }
    }
    for (const body of [builtin.documents.REQUIREMENTS, builtin.documents.CHANGE, builtin.documents.ACCEPTANCE]) expect(body).toMatch(/附件[一二三]/)
    expect(all).not.toMatch(/_{3,}/)
    expect((builtin.defaults.modules).every((r) => r.included === false)).toBe(true)
    expect(() => validateTemplateDefinition(builtin.documents, fields)).not.toThrow()
  })
  it('keeps every fixed legal paragraph from the source', () => {
    const source = readFileSync('src/server/commissions/software-development-contract.source.md', 'utf8')
    const all = renderContractDocument(builtin.documents, fields, completeAgreementValues(), 'AGREEMENT') + '\n' + builtin.documents.CHANGE + '\n' + builtin.documents.ACCEPTANCE
    const paragraphs = source.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s && !s.includes('_') && !s.includes('□') && !s.startsWith('|') && !s.startsWith('#'))
    for (const paragraph of paragraphs) expect(all).toContain(paragraph)
  })
  it('renders a full agreement package, selected table rows, exact installments and Chinese uppercase', () => {
    const values = completeAgreementValues(), body = renderContractDocument(builtin.documents, fields, values, 'AGREEMENT', true)
    expect(body).toContain('订单管理'); expect(body).toContain('附件一'); expect(body).not.toContain('附件二')
    expect(body).not.toContain('{{'); expect(body).toContain('壹仟元零壹分')
    const d = derivedTemplateValues(values)
    expect(BigInt(String(d.startFen)) + BigInt(String(d.progressFen)) + BigInt(String(d.finalFen))).toBe(100001n)
    expect(d.startFen).toBe('30000'); expect(d.progressFen).toBe('40000'); expect(d.finalFen).toBe('30001')
  })
  it('requires explicit rights, scope and free adjustment allowance before issue', () => {
    const values = completeAgreementValues()
    expect(() => renderContractDocument(builtin.documents, fields, { ...values, ipMode: undefined }, 'AGREEMENT', true)).toThrow('知识产权')
    expect(() => renderContractDocument(builtin.documents, fields, { ...values, modules: builtin.defaults.modules }, 'AGREEMENT', true)).toThrow('功能模块')
    expect(() => renderContractDocument(builtin.documents, fields, { ...values, adjustmentRounds: undefined, adjustmentWorkload: '' }, 'AGREEMENT', true)).toThrow('免费调整')
    expect(() => renderContractDocument(builtin.documents, fields, { ...values, ipMode: 'B' }, 'AGREEMENT', true)).toThrow('许可')
  })
  it('rejects executable syntax, unknown hidden references and prototype paths while escaping user Markdown', () => {
    expect(() => renderTemplate('{{process.exit()}}', {})).toThrow()
    expect(() => renderTemplate('{{constructor.name}}', {})).toThrow()
    expect(() => validateTemplateDefinition({ ...builtin.documents, CHANGE: '{{#if projectName}}{{unknown}}{{/if}}' }, fields)).toThrow('未定义')
    expect(renderTemplate('| {{name}} |', { name: '<script>alert(1)</script>|x\n# forged' })).toContain('\\<script\\>')
    expect(renderTemplate('| {{name}} |', { name: 'a|b\nc' })).toBe('| a\\|b<br />c |')
  })
  it('uses integer fen, accepts only bounded ratios and handles uppercase zero groups', () => {
    expect(yuanToFen('0.01')).toBe('1'); expect(yuanToFen('123.40')).toBe('12340')
    expect(() => yuanToFen('1.234')).toThrow(); expect(() => splitPayments(100n, 6000, 5000)).toThrow()
    expect(chineseMoney('0')).toBe('零元整'); expect(chineseMoney('100100100')).toBe('壹佰万壹仟零壹元整')
    expect(chineseMoney('100000001')).toBe('壹佰万元零壹分')
  })
  it('counts only confirmed receipts and refunds, keeping pending proof distinct', () => {
    const plan = { amountFen: '10000' }, entries = [{ amountFen: '3000', status: 'CONFIRMED', kind: 'RECEIPT' }, { amountFen: '2000', status: 'PENDING', kind: 'RECEIPT' }]
    expect(paymentFacts(plan, entries)).toMatchObject({ receivedFen: '3000', netFen: '3000', remainingFen: '7000', status: 'PENDING' })
    expect(paymentFacts(plan, [...entries.filter((p) => p.status !== 'PENDING'), { amountFen: '1000', status: 'CONFIRMED', kind: 'REFUND' }])).toMatchObject({ netFen: '2000', remainingFen: '8000', status: 'PARTIAL' })
  })
  it('uses Beijing dates and supports holidays and compensating working weekends', () => {
    const date = new Date('2026-10-08T16:30:00Z')
    expect(beijingDate(date)).toBe('2026-10-09')
    expect(beijingDate(addWorkingDays(date, 2, { holidays: ['2026-10-12'], workdays: ['2026-10-10'] }))).toBe('2026-10-13')
  })
})
