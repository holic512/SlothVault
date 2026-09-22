import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { LiquidGlassCard, type LiquidGlassCardProps } from '@/components/ui/liquid-glass-card'

describe('LiquidGlassCard', () => {
  it('renders independent filters for multiple instances', () => {
    const firstProps: LiquidGlassCardProps = { 'aria-label': 'First liquid card', children: 'First' }
    const secondProps: LiquidGlassCardProps = { 'aria-label': 'Second liquid card', children: 'Second' }
    const html = renderToStaticMarkup(createElement('div', null,
      createElement(LiquidGlassCard, firstProps),
      createElement(LiquidGlassCard, secondProps),
    ))
    const filterIds = [...html.matchAll(/<filter id="([^"]+)"/g)].map((match) => match[1])

    expect(filterIds).toHaveLength(2)
    expect(new Set(filterIds).size).toBe(2)
  })

  it('preserves content, root attributes, custom classes, and typed layout variables', () => {
    const onPointerMove = vi.fn()
    const props: LiquidGlassCardProps = {
      'aria-label': 'Project summary',
      id: 'project-summary',
      className: 'consumer-root',
      contentClassName: 'consumer-content',
      width: 320,
      height: 180,
      minWidth: 240,
      minHeight: 120,
      padding: 18,
      margin: 12,
      outerRadius: 28,
      innerRadius: 20,
      refraction: 18,
      blur: 10,
      quality: 'high',
      onPointerMove,
      children: createElement('button', { type: 'button' }, 'Open details'),
    }
    const html = renderToStaticMarkup(createElement(LiquidGlassCard, props))

    expect(html).toContain('aria-label="Project summary"')
    expect(html).toContain('id="project-summary"')
    expect(html).toContain('consumer-root')
    expect(html).toContain('consumer-content')
    expect(html).toContain('<button type="button">Open details</button>')
    expect(html).toContain('--sv-liquid-glass-width:320px')
    expect(html).toContain('--sv-liquid-glass-height:180px')
    expect(html).toContain('--sv-liquid-glass-min-width:240px')
    expect(html).toContain('--sv-liquid-glass-min-height:120px')
    expect(html).toContain('--sv-liquid-glass-padding:18px')
    expect(html).toContain('--sv-liquid-glass-margin:12px')
    expect(html).toContain('--sv-liquid-glass-outer-radius:28px')
    expect(html).toContain('--sv-liquid-glass-inner-radius:20px')
    expect(onPointerMove).not.toHaveBeenCalled()
  })
})
