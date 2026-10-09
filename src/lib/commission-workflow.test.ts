import { describe, expect, it } from 'vitest'
import { extractVariables, synchronizeFields, renderSimpleTemplate } from './commission-workflow'
import { safeAuthReturn } from './auth-return'
describe('simple Markdown contracts', () => {
  it('extracts Chinese variables once in first appearance order', () => {
    expect(extractVariables('{{ 项目名称 }} {{金额_1}} {{项目名称}}')).toEqual(['项目名称', '金额_1'])
    expect(extractVariables('固定文本')).toEqual([])
    expect(renderSimpleTemplate('固定文本', [], {}, true)).toBe('固定文本')
  })
  it('preserves definitions and rejects expressions or prototype keys', () => {
    const fields = synchronizeFields('{{姓名}}', [{ key: '姓名', label: '客户', type: 'multiline', required: false }])
    expect(fields[0].label).toBe('客户')
    for (const body of ['{{constructor}}', '{{__proto__}}', '{{x.y}}', '{{#if x}}', '{{a + b}}', '{{未闭合']) expect(() => extractVariables(body)).toThrow()
  })
  it('blocks missing required fields at publish and escapes supplied markup', () => {
    const fields = synchronizeFields('{{姓名}}')
    expect(renderSimpleTemplate('{{姓名}}', fields, {})).toContain('待填写')
    expect(() => renderSimpleTemplate('{{姓名}}', fields, {}, true)).toThrow('请填写')
    expect(renderSimpleTemplate('{{姓名}}', fields, { 姓名: '<script>alert(1)</script> [x](javascript:alert(1))' }, true)).toContain('&#60;script&#62;')
  })
  it('keeps HTML entities, quotes, links and Markdown syntax as literal variable text', () => {
    const body = '{{内容}}', fields = synchronizeFields(body)
    const result = renderSimpleTemplate(body, fields, { 内容: '&copy; " onerror="alert(1) https://example.com **bold**' }, true)
    expect(result).toContain('&#38;copy&#59;')
    expect(result).toContain('&#34; onerror&#61;&#34;')
    expect(result).not.toContain('https://')
    expect(result).not.toContain('**bold**')
  })
  it('validates numbers, dates, money and select choices', () => {
    const fields = [{ key: '日期', label: '日期', type: 'date' as const, required: true }]
    expect(() => renderSimpleTemplate('{{日期}}', fields, { 日期: '2026-02-30' }, true)).toThrow()
    expect(renderSimpleTemplate('{{日期}}', fields, { 日期: '2026-10-09' }, true)).toBe('2026&#45;10&#45;09')
    expect(() => renderSimpleTemplate('{{金额}}', [{ key: '金额', label: '金额', type: 'money', required: true }], { 金额: '1.234' }, true)).toThrow()
  })
  it('only returns to a known invitation landing route', () => {
    const target = '/commission-invitations/' + 'a'.repeat(43)
    expect(safeAuthReturn(target)).toBe(target)
    for (const input of ['//evil.example', '/\\evil.example', 'https://evil.example', '/admin/mm', target + '?next=https://evil.example']) expect(safeAuthReturn(input)).toBe('/account')
  })
})
