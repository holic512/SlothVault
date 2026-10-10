/**
 * @file mermaid-render.ts
 * @project SlothVault
 * @module Safe Mermaid Rendering
 * @description Lazily renders untrusted diagrams with bounded, fixed site configuration.
 * @logic Serialize theme initialization and rendering, lock security configuration, and sanitize SVG before display.
 * @dependencies mermaid, dompurify
 * @index_tags markdown,mermaid,security,theme
 * @author holic512
 */
import type { MermaidConfig } from 'mermaid'

export const MERMAID_MAX_CHARACTERS = 50_000
export const MERMAID_MAX_EDGES = 500
let queue: Promise<unknown> = Promise.resolve()
let sequence = 0

/** Diagram CSS can use local markers but must not load external resources. */
function unsafeSvgStyle(value: string) {
  if (/\\|@import|@font-face/i.test(value)) return true
  return [...value.matchAll(/url\s*\(([^)]*)\)/gi)].some((match) => {
    const destination = match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
    return !/^#[\w-]+$/.test(destination)
  })
}

export function mermaidConfig(dark: boolean): MermaidConfig {
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: dark ? 'dark' : 'default',
    maxTextSize: MERMAID_MAX_CHARACTERS,
    maxEdges: MERMAID_MAX_EDGES,
    suppressErrorRendering: true,
    fontFamily: 'inherit',
  }
  return { ...config, secure: [...Object.keys(config), 'secure', 'themeCSS', 'themeVariables', 'dompurifyConfig'] }
}

export function renderMermaid(source: string, dark: boolean) {
  if (source.length > MERMAID_MAX_CHARACTERS) return Promise.reject(new Error('MERMAID_TOO_LARGE'))
  const work = queue.then(async () => {
    const [{ default: mermaid }, { default: purifier }] = await Promise.all([import('mermaid'), import('dompurify')])
    mermaid.initialize(mermaidConfig(dark))
    const { svg } = await mermaid.render(`sloth-mermaid-${++sequence}`, source)
    const sanitized = purifier.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'a', 'image'],
      FORBID_ATTR: ['href', 'xlink:href'],
    })
    const document = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('MERMAID_INVALID_SVG')
    for (const style of document.querySelectorAll('style')) {
      if (unsafeSvgStyle(style.textContent || '')) style.remove()
    }
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        if (unsafeSvgStyle(attribute.value)) element.removeAttribute(attribute.name)
      }
    }
    return document.documentElement.outerHTML
  })
  queue = work.catch(() => undefined)
  return work
}
