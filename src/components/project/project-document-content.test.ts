import { describe, expect, it } from 'vitest'

import { readDocumentHeadings } from '@/components/project/project-document-content'

describe('project document outline', () => {
  it('uses rendered anchors and heading levels, including duplicate and Chinese headings', () => {
    const root = {
      querySelectorAll: () => [
        { id: '项目概览', textContent: ' 项目概览 ', tagName: 'H1' },
        { id: '项目概览-1', textContent: '项目概览', tagName: 'H2' },
        { id: 'nested-heading', textContent: 'Nested heading', tagName: 'H6' },
        { id: 'empty', textContent: '  ', tagName: 'H2' },
      ],
    } as unknown as ParentNode

    expect(readDocumentHeadings(root)).toEqual([
      { id: '项目概览', title: '项目概览', level: 1 },
      { id: '项目概览-1', title: '项目概览', level: 2 },
      { id: 'nested-heading', title: 'Nested heading', level: 6 },
    ])
  })

  it('does not create an outline when there are no rendered headings', () => {
    const root = { querySelectorAll: () => [] } as unknown as ParentNode
    expect(readDocumentHeadings(root)).toEqual([])
  })
})
