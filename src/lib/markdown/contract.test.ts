import { describe, expect, it } from 'vitest'
import { markdownCapabilities, markdownPresets, parseConfiguration } from './contract'
import { validateMarkdown } from './processor'
import { extractManagedFiles } from '../managed-files'
import { contentLinkEdits, replaceContentLinks } from '../markdown-links'

describe('shared Markdown capabilities', () => {
  it('validates every shipped preset', () => {
    for (const preset of markdownPresets) expect(validateMarkdown(preset.source.replace('{{selection}}', '**Body**')), preset.id).toEqual({ valid: true, issues: [] })
    expect(markdownCapabilities('echarts').extensions.map(item => item.id)).toEqual(['echarts'])
  })
  it.each([
    { series: [{ type: 'custom', renderItem: 'x' }] },
    { tooltip: { formatter: '<img src=x>' } },
    { title: { link: 'javascript:alert(1)' } },
    { graphic: [{ type: 'image' }] },
    { tooltip: { renderMode: 'html' } },
    { series: [{ type: 'line', data: Array(5001).fill(1) }] },
    { series: Array(11).fill({ type: 'line', data: [] }) },
    { series: [{ type: 'line', symbol: 'image://https://example.com/x' }] },
  ])('rejects unsafe or oversized chart configuration %j', option => {
    expect(() => parseConfiguration('echarts', JSON.stringify({ version: 1, option }))).toThrow()
  })
  it('reports line positions and isolates invalid blocks', () => {
    const report = validateMarkdown('# Heading\n\n```echarts\n{bad}\n```\n\n:::motion{duration="99999"}\n\nBody\n\n:::')
    expect(report.valid).toBe(false)
    expect(report.issues.map(issue => [issue.line, issue.extensionId])).toEqual([[3, 'echarts'], [7, 'motion']])
    expect(validateMarkdown(':::tab{title="X"}\n\nBody\n\n:::').valid).toBe(false)
  })
  it('finds and rewrites managed links inside containers', () => {
    const source = '::::tabs\n\n:::tab{title="Images"}\n\n![Image](/uploads/notes/image.png)\n\n[Link](/project/old)\n\n:::\n\n::::'
    expect(extractManagedFiles(source)).toEqual([{ filePath: 'uploads/notes/image.png', usage: 'READ_MEDIA' }])
    const edits = contentLinkEdits(source)
    expect(replaceContentLinks(source, edits, new Map([['/project/old', '/project/new']]))).toContain('[Link](/project/new)')
  })
})
