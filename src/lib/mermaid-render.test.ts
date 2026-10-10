import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), sanitize: vi.fn((svg: string) => svg) }))
vi.mock('mermaid', () => ({ default: { initialize: mocks.initialize, render: mocks.render } }))
vi.mock('dompurify', () => ({ default: { sanitize: mocks.sanitize } }))
import { MERMAID_MAX_CHARACTERS, renderMermaid } from './mermaid-render'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.render.mockResolvedValue({ svg: '<svg />' })
  // SVG security is exercised in the browser; this suite isolates queue/config behavior.
  vi.stubGlobal('DOMParser', class {
    parseFromString(svg: string) {
      return { documentElement: { localName: 'svg', outerHTML: svg }, querySelector: () => null, querySelectorAll: () => [] }
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('bounded Mermaid renderer', () => {
  it('serializes theme changes, gives diagrams unique IDs and sanitizes every output', async () => {
    let release!: () => void
    mocks.render.mockImplementationOnce(() => new Promise<{ svg: string }>((resolve) => { release = () => resolve({ svg: '<svg>first</svg>' }) }))
    const first = renderMermaid('flowchart LR\nA-->B', false)
    const second = renderMermaid('sequenceDiagram\nA->>B: Hello', true)
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1))
    expect(mocks.initialize).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(mocks.initialize.mock.calls.map(([config]) => config.theme)).toEqual(['default', 'dark'])
    expect(mocks.render.mock.calls[0][0]).not.toBe(mocks.render.mock.calls[1][0])
    expect(mocks.initialize.mock.calls[0][0]).toMatchObject({ securityLevel: 'strict', htmlLabels: false, maxEdges: 500, startOnLoad: false })
    expect(mocks.initialize.mock.calls[0][0].secure).toEqual(expect.arrayContaining(['securityLevel', 'htmlLabels', 'maxTextSize', 'maxEdges', 'themeCSS', 'dompurifyConfig']))
    expect(mocks.sanitize).toHaveBeenCalledWith('<svg>first</svg>', expect.objectContaining({ FORBID_TAGS: ['foreignObject', 'a', 'image'] }))
  })
  it('rejects oversized source before loading/rendering and recovers its queue after syntax errors', async () => {
    await expect(renderMermaid('x'.repeat(MERMAID_MAX_CHARACTERS + 1), false)).rejects.toThrow('MERMAID_TOO_LARGE')
    expect(mocks.render).not.toHaveBeenCalled()
    mocks.render.mockRejectedValueOnce(new Error('syntax'))
    await expect(renderMermaid('invalid diagram', false)).rejects.toThrow('syntax')
    await expect(renderMermaid('flowchart LR\nA-->B', false)).resolves.toBe('<svg />')
  })
})
