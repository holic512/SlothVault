import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownView } from '@/components/markdown/markdown-view'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('MarkdownView mixed document rendering', () => {
  it('recognizes Mermaid fenced blocks and preserves escaped source until client rendering', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, { content: '```mermaid\nflowchart LR\n  A[<script>unsafe</script>] --> B\n```\n\n```js\nconst value = 1\n```' }))
    expect(html).toContain('data-mermaid-state="loading"')
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('class="language-js"')
  })
  it('defaults to reading presentation without changing caller classes', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      content: '# Document',
      className: 'embedded-preview',
    }))

    expect(html).toContain('data-presentation="reading"')
    expect(html).toContain('embedded-preview')
    expect(html).toContain('href="#document"')
  })

  it('supports explicit landing presentation for homepage preview parity', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      content: '# Homepage\n\nIntroduction',
      presentation: 'landing',
    }))

    expect(html).toContain('data-presentation="landing"')
    expect(html).toContain('<p>Introduction</p>')
  })

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

  it.each(['reading', 'landing'] as const)('preserves author typography in %s mode', (presentation) => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      content: '<p style="font-size: 80px; margin: 48px; color: red">Author formatting</p>',
      presentation,
    }))

    expect(html).toContain('style="font-size:80px;margin:48px;color:red"')
    expect(html).toContain('Author formatting')
  })

  it('retains all heading levels, nested lists, code, tables and responsive images', () => {
    const content = [
      '# 一级 Heading', '## 二级', '### 三级', '#### 四级', '##### 五级', '###### 六级',
      '- Parent\n  - Child',
      '```text\nlong_code_without_spaces\n```',
      '| Column | Value |\n| --- | --- |\n| 中文 | English |',
      '![Example](/example.png)',
    ].join('\n\n')
    const html = renderToStaticMarkup(createElement(MarkdownView, { content }))

    for (const level of [1, 2, 3, 4, 5, 6]) expect(html).toContain(`<h${level}`)
    expect(html).toContain('<ul>\n<li>Parent\n<ul>')
    expect(html).toContain('<pre><code')
    expect(html).toContain('<table>')
    expect(html).toContain('loading="lazy"')
  })

  it('keeps presentation on the oversized-content error surface', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      content: 'a'.repeat(500_001),
      presentation: 'landing',
    }))

    expect(html).toContain('data-presentation="landing"')
    expect(html).toContain('data-document-error="content-too-large"')
    expect(html).toContain('role="alert"')
  })
})
