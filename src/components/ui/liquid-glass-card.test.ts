import { readFileSync } from 'node:fs'

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

// Material contracts belong to the glass surfaces, not the opaque Ant Design palette.
// Browser checks must additionally verify compositing; SSR cannot render a backdrop.
const glassCss = readFileSync(new URL('../../styles/modules/liquid-glass-card.module.css', import.meta.url), 'utf8')
const navCss = readFileSync(new URL('../../styles/modules/navigation-shell.module.css', import.meta.url), 'utf8')
const sharedCss = readFileSync(new URL('../../styles/shared.css', import.meta.url), 'utf8')
const accountCss = readFileSync(new URL('../../styles/modules/account.module.css', import.meta.url), 'utf8')

function declarations(css: string, selector: string) {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const block = blocks.find((match) => match[1].trim() === selector)
  if (!block) throw new Error(`Missing CSS rule: ${selector}`)
  return Object.fromEntries([...block[2].matchAll(/([\w-]+):\s*([^;]+);/g)]
    .map((match) => [match[1], match[2].trim()]))
}

describe('liquid glass material contracts', () => {
  it('keeps shared refractive surfaces transparent in both color modes', () => {
    expect(declarations(glassCss, '.root')['--sv-liquid-glass-tint']).toBe('rgb(255 255 255 / 14%)')
    expect(declarations(glassCss, ':global(.dark) .root')['--sv-liquid-glass-tint']).toBe('rgb(18 20 24 / 38%)')
    expect(declarations(glassCss, '.root[data-refraction="enabled"]')).toMatchObject({
      background: 'var(--sv-liquid-glass-tint)',
      'backdrop-filter': 'var(--sv-liquid-glass-filter)',
    })
    // Navigation and account wrappers must not replace the shared tint with a solid scrim.
    for (const css of [navCss, accountCss]) {
      expect(css).not.toMatch(/--sv-liquid-glass-(?:tint|fallback)\s*:/)
    }
  })

  it('gives menu surfaces a readable but translucent tint without replacing the fallback', () => {
    expect(declarations(sharedCss, '.nav-popup-surface[data-glass-enabled="true"]')['--sv-liquid-glass-tint'])
      .toBe('rgb(255 255 255 / 72%)')
    expect(declarations(sharedCss, '.dark .nav-popup-surface[data-glass-enabled="true"]')['--sv-liquid-glass-tint'])
      .toBe('rgb(18 20 24 / 76%)')
    expect(sharedCss).not.toContain('--sv-liquid-glass-fallback')
  })

  it('keeps a separate frosted fallback before refraction is available', () => {
    expect(declarations(glassCss, '.root')).toMatchObject({
      background: 'color-mix(in srgb, var(--sv-bg-solid) 78%, transparent)',
      'backdrop-filter': 'blur(14px) saturate(1.12)',
    })
  })

  it('leaves content sharp and inner navigation and portal surfaces transparent', () => {
    expect(declarations(glassCss, '.content')).not.toHaveProperty('filter')
    expect(declarations(glassCss, '.content')).not.toHaveProperty('backdrop-filter')
    expect(declarations(navCss, '.liquid')).toMatchObject({
      background: 'transparent', 'backdrop-filter': 'none', 'box-shadow': 'none',
    })
    expect(declarations(sharedCss, '.theme-controls-popup.ant-popover .ant-popover-container'))
      .toMatchObject({ background: 'transparent', 'box-shadow': 'none' })
    for (const selector of ['.root :global(.account-card)', '.root :global(.account-card-content)', '.root :global(.account-card-body)']) {
      expect(declarations(accountCss, selector)).not.toHaveProperty('background')
      expect(declarations(accountCss, selector)).not.toHaveProperty('backdrop-filter')
    }
  })

  it('disables both refraction and decorative highlights when glass is off', () => {
    expect(declarations(glassCss, '.root[data-glass-enabled="false"]')).toMatchObject({
      background: 'var(--sv-bg-solid)', 'backdrop-filter': 'none', 'box-shadow': 'none',
    })
    expect(declarations(glassCss, '.root[data-glass-enabled="false"]::after').display).toBe('none')
  })

  it('keeps opaque accessible alternatives even after refraction has been enabled', () => {
    const reduced = glassCss.split('@media (prefers-reduced-transparency: reduce)')[1].split('@media')[0]
    const forced = glassCss.split('@media (forced-colors: active)')[1]
    const selector = '.root,\n  .root[data-refraction="enabled"]'
    expect(declarations(reduced, selector)).toMatchObject({
      background: 'var(--sv-bg-solid)', 'backdrop-filter': 'none',
    })
    expect(declarations(forced, selector)).toMatchObject({
      background: 'Canvas', color: 'CanvasText', 'backdrop-filter': 'none',
    })
    expect(declarations(forced, '.root::after').display).toBe('none')
  })
})
