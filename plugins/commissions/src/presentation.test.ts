import { describe, expect, it } from 'vitest'
import { initialDraft, pageUrl, renderBody, errorText } from './presentation'
import { DEFAULT_TEMPLATES } from './templates'
import type { CommissionDetail } from './domain'
const detail = { commission: { title: '客户后台', maintenanceDays: 60, contracts: [{ id: 'main-42', kind: 'MAIN', effectiveAt: '2026-10-23' }] }, contractDefaults: { customerName: '客户名称', providerName: '服务方名称' } } as CommissionDetail

describe('commission presentation contracts', () => {
  it('links to actual host extension surfaces with encoded queries', () => {
    expect(pageUrl(true, 'templates')).toBe('/admin/mm/extensions/slothvault.commissions/templates')
    expect(pageUrl(false, undefined, { commissionId: 'a&b' })).toBe('/account/extensions/slothvault.commissions/account?commissionId=a%26b')
  })
  it('prefills known parties, maintenance and the effective main contract only', () => {
    const draft = initialDraft(detail, DEFAULT_TEMPLATES[7])
    expect(draft.fields).toMatchObject({ projectName: '客户后台', maintenanceDays: 60, customerName: '客户名称', providerName: '服务方名称', baseContractId: 'main-42' })
    expect(draft.fields.amount).toBeUndefined()
    expect(draft.body).toContain('【待填写：')
  })
  it('escapes user input in generated Markdown', () => {
    expect(renderBody({ ...DEFAULT_TEMPLATES[0], body: '{{projectName}}' }, { projectName: '<script>*hello*</script>' })).toBe('\\<script\\>\\*hello\\*\\</script\\>')
  })
})

it('explains cancelled wallets and revision conflicts without raw internal codes', () => {
  expect(errorText(new Error('WALLET_CANCELLED'))).toContain('冻结内容仍然保留')
  expect(errorText(new Error('STALE_REVISION: refresh the commission'))).toContain('刷新详情')
  expect(errorText(new Error('insufficient balance'))).toContain('手续费')
})
