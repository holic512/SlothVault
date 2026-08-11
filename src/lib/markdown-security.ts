/**
 * @file markdown-security.ts
 * @project SlothVault
 * @module Mixed Document Security
 * @description Filters administrator-authored inline CSS before sanitized Markdown and HTML are rendered.
 * @logic Retain a small layout-and-typography style vocabulary while dropping overlay, network, executable, and unbounded CSS values.
 * @dependencies HAST-compatible tree shape, rehype-sanitize pipeline
 * @index_tags markdown,html,css,sanitize,security,rehype
 * @author holic512
 */

type HastLikeNode = {
  children?: HastLikeNode[]
  properties?: Record<string, unknown>
}

type StyleValidator = (value: string) => boolean

const COLOR_NAMES = new Set([
  'black',
  'currentcolor',
  'gray',
  'green',
  'inherit',
  'navy',
  'red',
  'transparent',
  'white',
])
const DISPLAY_VALUES = new Set(['block', 'flex', 'grid', 'inline', 'inline-block'])
const FLEX_ALIGNMENT_VALUES = new Set([
  'baseline',
  'center',
  'end',
  'flex-end',
  'flex-start',
  'space-around',
  'space-between',
  'space-evenly',
  'start',
  'stretch',
])
const SAFE_TOKEN_PATTERN = /^[a-z0-9#%(),.\s-]+$/i
const SAFE_VARIABLE_PATTERN = /^var\(--sv-[a-z0-9-]+\)$/i

function isSafeNumber(value: string, minimum: number, maximum: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum
}

function isSafeLength(value: string, maximumPixels = 2_000, allowPercent = true) {
  if (value === '0') return true
  const match = /^(\d+(?:\.\d+)?)(px|rem|em|ch|vw|vh|%)$/i.exec(value)
  if (!match) return false
  const numeric = Number(match[1])
  const unit = match[2].toLocaleLowerCase()
  if (!Number.isFinite(numeric)) return false
  if (unit === 'px') return numeric <= maximumPixels
  if (unit === 'rem' || unit === 'em') return numeric <= 100
  if (unit === 'ch') return numeric <= 240
  return allowPercent && numeric <= 100
}

function isSafeSpacing(value: string, allowAuto = false) {
  const tokens = value.trim().split(/\s+/)
  return (
    tokens.length <= 4 &&
    tokens.every((token) => (allowAuto && token === 'auto') || isSafeLength(token, 240))
  )
}

function isSafeColor(value: string) {
  const normalized = value.toLocaleLowerCase()
  if (COLOR_NAMES.has(normalized) || SAFE_VARIABLE_PATTERN.test(normalized)) return true
  if (/^#[0-9a-f]{3,8}$/i.test(normalized)) return true
  if (!SAFE_TOKEN_PATTERN.test(normalized)) return false
  return /^(?:rgb|rgba|hsl|hsla)\([\d.%\s,]+\)$/i.test(normalized)
}

const STYLE_VALIDATORS: Record<string, StyleValidator> = {
  'align-items': (value) => FLEX_ALIGNMENT_VALUES.has(value),
  'background-color': isSafeColor,
  'border-color': isSafeColor,
  'border-radius': (value) => isSafeSpacing(value),
  'border-style': (value) => ['dashed', 'dotted', 'double', 'none', 'solid'].includes(value),
  'border-width': (value) => isSafeLength(value, 12, false),
  color: isSafeColor,
  display: (value) => DISPLAY_VALUES.has(value),
  'flex-direction': (value) => ['column', 'column-reverse', 'row', 'row-reverse'].includes(value),
  'flex-wrap': (value) => ['nowrap', 'wrap', 'wrap-reverse'].includes(value),
  'font-size': (value) => isSafeLength(value, 160),
  'font-style': (value) => ['italic', 'normal'].includes(value),
  'font-weight': (value) => ['400', '500', '600', '700', '800', 'bold', 'normal'].includes(value),
  gap: (value) => isSafeSpacing(value),
  'justify-content': (value) => FLEX_ALIGNMENT_VALUES.has(value),
  'line-height': (value) => isSafeNumber(value, 0.8, 3) || isSafeLength(value, 160),
  margin: (value) => isSafeSpacing(value, true),
  'margin-block': (value) => isSafeSpacing(value, true),
  'margin-inline': (value) => isSafeSpacing(value, true),
  'max-width': (value) => value === 'none' || isSafeLength(value),
  padding: (value) => isSafeSpacing(value),
  'padding-block': (value) => isSafeSpacing(value),
  'padding-inline': (value) => isSafeSpacing(value),
  'text-align': (value) => ['center', 'end', 'justify', 'left', 'right', 'start'].includes(value),
  'text-decoration': (value) => ['line-through', 'none', 'underline'].includes(value),
  width: (value) => value === 'auto' || value === 'fit-content' || isSafeLength(value),
}

export const SAFE_DOCUMENT_CLASS_NAME = /^sloth-[a-z0-9-]{1,48}$/

export function sanitizeDocumentInlineStyle(style: string) {
  if (style.length > 1_000 || /[\\{}]|\/\*|!important|expression|javascript:|url\s*\(/i.test(style)) {
    return ''
  }

  const declarations: string[] = []
  for (const rawDeclaration of style.split(';').slice(0, 20)) {
    const separator = rawDeclaration.indexOf(':')
    if (separator < 1) continue
    const property = rawDeclaration.slice(0, separator).trim().toLocaleLowerCase()
    const value = rawDeclaration.slice(separator + 1).trim().toLocaleLowerCase()
    const validator = STYLE_VALIDATORS[property]
    if (validator?.(value)) declarations.push(`${property}: ${value}`)
  }
  return declarations.join('; ')
}

export function rehypeSafeDocumentStyles() {
  return (tree: HastLikeNode) => {
    const visit = (node: HastLikeNode) => {
      if (node.properties && 'style' in node.properties) {
        const rawStyle = node.properties.style
        const safeStyle = typeof rawStyle === 'string' ? sanitizeDocumentInlineStyle(rawStyle) : ''
        if (safeStyle) node.properties.style = safeStyle
        else delete node.properties.style
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
