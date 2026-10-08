/**
 * @file commissions.ts
 * @project SlothVault
 * @module Commission Shared Business Rules
 * @description Defines independent project stages, exact currency calculations, and the Beijing working calendar.
 * @logic Derive payment facts from confirmed ledger entries without changing the administrator's project stage.
 * @dependencies none
 * @index_tags commissions,stages,payments,currency,calendar
 * @author holic512
 */
export const COMMISSION_STAGES = {
  ASSESSMENT: '待评估', REQUIREMENTS: '需求确认', CONTRACT: '待签约', READY: '待启动',
  DEVELOPMENT: '开发中', ACCEPTANCE: '待验收', RECTIFICATION: '整改中', DELIVERY: '待交付',
  MAINTENANCE: '售后中', COMPLETED: '已完成', PAUSED: '暂停', TERMINATED: '终止',
} as const
export type CommissionStage = keyof typeof COMMISSION_STAGES
export const DOCUMENT_TYPES = ['AGREEMENT', 'CHANGE', 'ACCEPTANCE'] as const
export type CommissionDocumentType = typeof DOCUMENT_TYPES[number]
export type WorkingCalendar = { holidays?: string[]; workdays?: string[] }
export const MAX_MONEY_FEN = 999_999_999_999_99n

export function parseMoneyFen(value: string): bigint {
  if (!/^\d{1,14}$/.test(value)) throw new Error('金额必须是以分为单位的非负整数')
  const amount = BigInt(value)
  if (amount > MAX_MONEY_FEN) throw new Error('金额超出支持范围')
  return amount
}
export function yuanToFen(value: string): string {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error('请输入最多两位小数的人民币金额')
  return parseMoneyFen((BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'))).toString()).toString()
}
export function formatFen(value: string | bigint): string {
  const amount = typeof value === 'bigint' ? value : parseMoneyFen(value)
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`
}
export function splitPayments(total: bigint, startBps = 3000, progressBps = 4000) {
  if (!Number.isInteger(startBps) || !Number.isInteger(progressBps) || startBps < 0 || progressBps < 0 || startBps + progressBps > 10000) throw new Error('付款比例合计不能超过 100%')
  const start = total * BigInt(startBps) / 10000n
  const progress = total * BigInt(progressBps) / 10000n
  return { start, progress, final: total - start - progress }
}
export function chineseMoney(value: string): string {
  const amount = parseMoneyFen(value)
  const digits = '零壹贰叁肆伍陆柒捌玖'
  const groupUnits = ['', '万', '亿', '万亿']
  function group(n: number) {
    let text = '', zero = false
    for (let i = 3; i >= 0; i--) {
      const divisor = 10 ** i, d = Math.floor(n / divisor) % 10
      if (d) { if (zero && text) text += '零'; text += digits[d] + ['', '拾', '佰', '仟'][i]; zero = false }
      else if (text) zero = true
    }
    return text
  }
  let integer = amount / 100n, whole = '', needsZero = false, position = 0
  while (integer > 0n) {
    const n = Number(integer % 10000n)
    if (n) {
      whole = group(n) + groupUnits[position] + (needsZero && whole ? '零' : '') + whole
      needsZero = n < 1000
    } else if (whole) needsZero = true
    integer /= 10000n; position++
  }
  const jiao = Number(amount / 10n % 10n), fen = Number(amount % 10n)
  return (whole || '零') + '元' + (jiao ? digits[jiao] + '角' : fen && whole ? '零' : '') + (fen ? digits[fen] + '分' : !jiao ? '整' : '')
}
const beijingDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
export function beijingDate(date: Date): string { return beijingDateFormatter.format(date) }
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}
export function addWorkingDays(date: Date, days: number, calendar: WorkingCalendar = {}): Date {
  if (!Number.isInteger(days) || days < 0 || days > 36500) throw new Error('工作日数须为 0—36500 的整数')
  let current = new Date(date), remaining = days
  while (remaining > 0) {
    current = addCalendarDays(current, 1)
    const key = beijingDate(current)
    const weekday = new Date(`${key}T12:00:00+08:00`).getUTCDay()
    if (calendar.workdays?.includes(key) || (!calendar.holidays?.includes(key) && weekday !== 0 && weekday !== 6)) remaining--
  }
  return current
}
export function paymentFacts(plan: { amountFen: string }, payments: Array<{ amountFen: string; kind: string; status: string }>) {
  let received = 0n, refunded = 0n
  for (const entry of payments) {
    if (entry.status !== 'CONFIRMED') continue
    if (entry.kind === 'REFUND') refunded += BigInt(entry.amountFen)
    else received += BigInt(entry.amountFen)
  }
  const net = received - refunded, amount = BigInt(plan.amountFen)
  return {
    receivedFen: received.toString(), refundedFen: refunded.toString(), netFen: net.toString(),
    remainingFen: (amount > net ? amount - net : 0n).toString(),
    status: payments.some((p) => p.status === 'PENDING') ? 'PENDING' : net >= amount ? 'PAID' : net > 0n ? 'PARTIAL' : 'UNPAID',
  }
}
