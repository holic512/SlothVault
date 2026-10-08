/**
 * @file contract-template.ts
 * @project SlothVault
 * @module Deterministic Contract Templates
 * @description Renders bounded Markdown variables, choices, conditions and rows without executing template code.
 * @logic Validate typed fields, derive exact payment terms, walk a restricted syntax tree, and escape customer-supplied Markdown.
 * @dependencies lib/commissions, types/commissions
 * @index_tags contracts,templates,render,snapshots,validation
 * @author holic512
 */
import { chineseMoney, formatFen, parseMoneyFen, splitPayments } from '@/lib/commissions'
import type { CommissionDocumentType } from '@/lib/commissions'
import type { TemplateDocuments, TemplateField } from '@/types/commissions'

const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const keyPattern = /^[A-Za-z][A-Za-z0-9_.]*$/
export function validateFieldDefinitions(fields: TemplateField[], depth = 0) {
  if (depth > 3 || fields.length > 120) throw new Error('模板字段层级或数量超出限制')
  const keys = new Set<string>()
  for (const field of fields) {
    if (!keyPattern.test(field.key) || field.key.split('.').some((p) => forbidden.has(p)) || keys.has(field.key)) throw new Error('模板字段标识不合法或重复')
    keys.add(field.key)
    if (field.type === 'rows') validateFieldDefinitions(field.fields || [], depth + 1)
    if (field.options && new Set(field.options.map((o) => o.value)).size !== field.options.length) throw new Error('模板选项值重复')
    if (['select', 'multiselect'].includes(field.type) && !field.options?.length) throw new Error('选择字段必须配置选项')
  }
}
const derivedKeys = new Set(['amountUppercase', 'startFen', 'progressFen', 'finalFen', 'startBpsPercent', 'progressBpsPercent', 'finalBpsPercent', 'sourceIncluded', 'databaseIncluded', 'deploymentIncluded', 'videoIncluded', 'screenshotsIncluded', 'manualIncluded'])
/** Validates all branches, including variables hidden by conditions or empty loops. */
export function validateTemplateDefinition(documents: TemplateDocuments, fields: TemplateField[]) {
  validateFieldDefinitions(fields)
  const byKey = new Map(fields.map((f) => [f.key, f]))
  for (const [key, type] of Object.entries({ totalFen: 'money', startBps: 'number', progressBps: 'number', maintenanceDays: 'number', adjustmentDays: 'number', durationUnit: 'select', acceptanceDays: 'number', supplementalDays: 'number', paymentReminderDays: 'number', projectName: 'text', partyAName: 'text', partyBName: 'text', ipMode: 'select', modules: 'rows', changeFen: 'money', extensionDays: 'number', acceptanceResult: 'select' })) {
    const field = byKey.get(key)
    if (!field || field.type !== type || !field.required) throw new Error(`业务字段 ${key} 必须保留类型 ${type} 并设为必填`)
  }
  const visit = (nodes: Node[], rowFields?: TemplateField[]) => {
    const resolveField = (path: string) => {
      if (path === 'index' || derivedKeys.has(path)) return undefined
      if (path.startsWith('this.')) { const field = rowFields?.find((f) => f.key === path.slice(5)); if (!field) throw new Error(`未定义的表格列：${path}`); return field }
      const field = byKey.get(path)
      if (!field) throw new Error(`未定义的模板变量：${path}`)
      return field
    }
    for (const node of nodes) {
      if (node.type === 'text') continue
      if (node.type === 'value') {
        const path = /^(?:money|date|check) ([\w.]+)/.exec(node.value)?.[1] || node.value
        const field = resolveField(path)
        if (node.value.startsWith('check ')) { const option = /^check [\w.]+ (".*")$/.exec(node.value); if (!option || !((field?.type === 'boolean' || derivedKeys.has(path)) ? ['true', 'false'].includes(JSON.parse(option[1])) : field?.options?.some((o) => o.value === JSON.parse(option[1])))) throw new Error(`勾选项与字段选项不一致：${node.value}`) }
      } else {
        const field = resolveField(node.key)
        if (node.type === 'each' && field?.type !== 'rows') throw new Error('循环变量必须是重复表格字段')
        visit(node.children, node.type === 'each' ? field?.fields : rowFields); visit(node.alternate, rowFields)
      }
    }
  }
  for (const body of Object.values(documents)) visit(parseTemplate(body))
  for (const field of fields) if (field.when && !byKey.has(field.when.key)) throw new Error(`未定义的条件字段：${field.when.key}`)
}
function lookup(context: Record<string, unknown>, path: string): unknown {
  if (!keyPattern.test(path) || path.split('.').some((part) => forbidden.has(part))) throw new Error('不支持的模板变量')
  let value: unknown = context
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}
function escaped(value: unknown, inTable: boolean) {
  if (value === undefined || value === null || value === '') return '不适用'
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('清单或对象必须使用循环输出')
  return String(value).replace(/[\\`*_{}\[\]<>#]/g, '\\$&').replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', inTable ? '<br />' : '\n\n')
}
type Node = { type: 'text'; value: string } | { type: 'value'; value: string; inTable: boolean } | { type: 'if' | 'each'; key: string; children: Node[]; alternate: Node[] }
function parseTemplate(source: string): Node[] {
  if (source.length > 100_000) throw new Error('模板正文过长')
  const root: Node[] = [], stack: Array<{ type: string; children: Node[]; node?: Extract<Node, { type: 'if' | 'each' }> }> = [{ type: 'root', children: root }]
  let last = 0
  for (const match of source.matchAll(/{{([\s\S]*?)}}/g)) {
    const current = stack[stack.length - 1]
    current.children.push({ type: 'text', value: source.slice(last, match.index) })
    const tag = match[1].trim()
    if (tag.startsWith('#if ') || tag.startsWith('#each ')) {
      const [type, key] = tag.slice(1).split(/\s+/)
      if (!key || !keyPattern.test(key) || stack.length > 4) throw new Error('模板条件或循环不合法')
      const node: Extract<Node, { type: 'if' | 'each' }> = { type: type as 'if' | 'each', key, children: [], alternate: [] }
      current.children.push(node); stack.push({ type, node, children: node.children })
    } else if (tag === 'else') {
      if (current.type !== 'if' || current.children === current.node!.alternate) throw new Error('模板 else 不匹配')
      current.children = current.node!.alternate
    } else if (tag.startsWith('/')) {
      if (current.type !== tag.slice(1)) throw new Error('模板闭合标签不匹配')
      stack.pop()
    } else {
      if (!/^(?:[A-Za-z][\w.]*|(?:money|date) [A-Za-z][\w.]*|check [A-Za-z][\w.]* "[^"\n]*")$/.test(tag)) throw new Error('模板仅支持变量、money、date、check、if 和 each')
      const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index)
      current.children.push({ type: 'value', value: tag, inTable: line.startsWith('|') })
    }
    last = match.index! + match[0].length
  }
  if (stack.length !== 1 || source.slice(last).includes('{{') || source.slice(last).includes('}}')) throw new Error('模板存在未闭合变量')
  stack[0].children.push({ type: 'text', value: source.slice(last) })
  return root
}
export function renderTemplate(source: string, values: Record<string, unknown>) {
  function render(nodes: Node[], context: Record<string, unknown>): string {
    return nodes.map((node) => {
      if (node.type === 'text') return node.value
      if (node.type === 'if') return render(lookup(context, node.key) ? node.children : node.alternate, context)
      if (node.type === 'each') {
        const rows = lookup(context, node.key)
        if (!Array.isArray(rows) || rows.length > 100) throw new Error('重复清单必须是最多 100 行的数组')
        return rows.map((row, index) => render(node.children, { ...context, this: row, index: index + 1 })).join('')
      }
      if (node.type !== 'value') throw new Error('模板节点不合法')
      const check = /^check ([\w.]+) (".*")$/.exec(node.value)
      if (check) { const actual = lookup(context, check[1]), wanted = JSON.parse(check[2]); return (Array.isArray(actual) ? actual.includes(wanted) : String(actual) === wanted) ? '☑' : '□' }
      const helper = /^(money|date) ([\w.]+)$/.exec(node.value)
      if (helper) {
        const value = lookup(context, helper[2])
        if (value === undefined || value === '') return '待填写'
        if (helper[1] === 'money') return formatFen(String(value))
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期必须为 YYYY-MM-DD')
        return value.replace(/^(\d+)-(\d+)-(\d+)$/, '$1年$2月$3日')
      }
      return escaped(lookup(context, node.value), node.inTable)
    }).join('')
  }
  const result = render(parseTemplate(source), values)
  if (result.length > 100_000 || /{{|}}/.test(result)) throw new Error('生成文件过长或有未解析变量')
  return result
}
export function validateTemplateValues(fields: TemplateField[], values: Record<string, unknown>, kind: CommissionDocumentType, strict: boolean) {
  validateFieldDefinitions(fields)
  const check = (field: TemplateField, context: Record<string, unknown>) => {
    if (field.documents && !field.documents.includes(kind)) return
    if (field.when && String(lookup(context, field.when.key)) !== field.when.value) return
    const value = lookup(context, field.key)
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    if (empty) { if (strict && field.required) throw new Error(`请填写：${field.label}`); return }
    if (field.type === 'rows') {
      if (!Array.isArray(value) || value.length > 100) throw new Error(`${field.label}最多 100 行`)
      for (const row of value) { if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('清单行格式错误'); for (const child of field.fields || []) check(child, row) }
    } else if (field.type === 'money') parseMoneyFen(String(value))
    else if (field.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000) throw new Error(`${field.label}必须是有效非负数字`) }
    else if (field.type === 'boolean') { if (typeof value !== 'boolean') throw new Error(`${field.label}必须为是或否`) }
    else if (field.type === 'select' || field.type === 'multiselect') {
      const items = field.type === 'multiselect' ? value : [value]
      if (!Array.isArray(items) || items.some((item) => typeof item !== 'string' || !field.options?.some((o) => o.value === item)) || new Set(items).size !== items.length) throw new Error(`${field.label}包含无效选项`)
    } else if (typeof value !== 'string' || value.length > 10000) throw new Error(`${field.label}文本格式错误或过长`)
    if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new Error(`${field.label}日期错误`)
  }
  for (const field of fields) check(field, values)
  if (strict && kind === 'AGREEMENT' && Object.hasOwn(values, 'totalFen')) {
    if (parseMoneyFen(String(values.totalFen)) === 0n) throw new Error('合同总价必须大于零')
    if (!values.adjustmentRounds && !String(values.adjustmentWorkload || '').trim()) throw new Error('请明确免费调整次数或工作量')
    if (!Array.isArray(values.modules) || !values.modules.some((row) => row && typeof row === 'object' && row.included)) throw new Error('请至少明确一项包含的功能模块')
    for (const key of ['durationDays', 'maintenanceDays', 'adjustmentDays', 'adjustmentRounds']) {
      if (values[key] !== undefined && !Number.isInteger(values[key])) throw new Error('工期、维护期和调整次数必须是整数')
      if (Number(values[key]) > 36500) throw new Error('工期、维护期和调整次数不能超过 36500')
    }
    for (const key of ['acceptanceDays', 'paymentReminderDays', 'supplementalDays']) if (!(values[key] === undefined && !fields.some((f) => f.key === key)) && (!Number.isInteger(values[key]) || Number(values[key]) < (key === 'supplementalDays' ? 3 : 1) || Number(values[key]) > 365)) throw new Error('验收和付款提醒期限须为 1—365 个工作日，补充反馈期限至少 3 个工作日')
    if (values.startDate && values.deliveryDate && String(values.deliveryDate) < String(values.startDate)) throw new Error('预计交付日期不能早于开发开始日期')
  }
}
export function derivedTemplateValues(input: Record<string, unknown>) {
  const values = { ...input }
  if (values.totalFen !== undefined && values.totalFen !== '') {
    const total = parseMoneyFen(String(values.totalFen))
    const startBps = Number(values.startBps ?? 3000), progressBps = Number(values.progressBps ?? 4000)
    const parts = splitPayments(total, startBps, progressBps)
    Object.assign(values, { totalFen: total.toString(), amountUppercase: chineseMoney(total.toString()), startFen: parts.start.toString(), progressFen: parts.progress.toString(), finalFen: parts.final.toString(), startBps, progressBps, startBpsPercent: startBps / 100, progressBpsPercent: progressBps / 100, finalBpsPercent: (10000 - startBps - progressBps) / 100 })
  }
  const included = Array.isArray(values.deliverables) ? values.deliverables : []
  Object.assign(values, { sourceIncluded: included.includes('前端源代码') || included.includes('后端源代码'), databaseIncluded: included.includes('数据库建表或初始化脚本'), deploymentIncluded: included.includes('部署配置及运行说明'), videoIncluded: included.includes('约定的视频演示'), screenshotsIncluded: included.includes('约定的项目截图'), manualIncluded: included.includes('项目操作说明') })
  return values
}
export function renderContractDocument(documents: TemplateDocuments, fields: TemplateField[], values: Record<string, unknown>, kind: CommissionDocumentType, strict = false) {
  validateTemplateValues(fields, values, kind, strict)
  const derived = derivedTemplateValues(values)
  return renderTemplate(documents[kind], derived) + (kind === 'AGREEMENT' ? '\n---\n\n' + renderTemplate(documents.REQUIREMENTS, derived) : '')
}
