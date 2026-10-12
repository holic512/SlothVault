import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { renderContentTag } from '@/components/tags/content-tag-render'
import { getContentTagColor } from '@/theme/tag-colors'

describe('content tag selection rendering', () => {
  const props = {
    label: '<script>', value: '<script>', disabled: false, closable: true,
    onClose: vi.fn(), isMaxTag: false, index: 0,
  }

  it('shares the reader color, escapes labels, and retains the close action', () => {
    const html = renderToStaticMarkup(renderContentTag(props))
    expect(html).toContain(`ant-tag-${getContentTagColor(props.value)}`)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('aria-label="Close"')
    expect(renderContentTag(props).props.onClose).toBe(props.onClose)
  })

  it.each([[true, false], [false, true], [true, true]])(
    'disables tags and hides close actions for option disabled %s and selection disabled %s',
    (disabled, selectionDisabled) => {
      const html = renderToStaticMarkup(renderContentTag({ ...props, disabled }, selectionDisabled))
      expect(html).toContain('ant-tag-disabled')
      expect(html).not.toContain('aria-label="Close"')
    },
  )
})
