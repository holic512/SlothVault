import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownView } from '@/components/markdown/markdown-view'

describe('MarkdownView mixed document rendering', () => {
  it('renders Markdown inside supported HTML structures with stable heading links', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      content: '# Heading\n\n<section class="sloth-callout sloth-callout-note">\n\n**Mixed** content\n\n</section>',
    }))

    expect(html).toContain('href="#heading"')
    expect(html).toContain('class="sloth-callout sloth-callout-note"')
    expect(html).toContain('<strong>Mixed</strong> content')
  })

  it('removes executable HTML and unsafe attributes while retaining bounded styles', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      content: '<div class="sloth-content-card unrelated" onclick="alert(1)" style="text-align: center; padding: 12px; position: fixed">Safe<script>alert(1)</script></div>\n\n[bad](javascript:alert(1))',
    }))

    expect(html).toContain('class="sloth-content-card"')
    expect(html).toContain('style="text-align:center;padding:12px"')
    expect(html).not.toContain('unrelated')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('position')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
  })
})
