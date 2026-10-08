import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getNavigationPopupContainer, NavigationShell } from './navigation-shell'

const scenario = vi.hoisted(() => ({ appearance: 'standard', containerResolver: undefined as unknown }))

vi.mock('antd', () => ({
  ConfigProvider: ({ children, getPopupContainer }: { children: ReactNode; getPopupContainer: unknown }) => {
    scenario.containerResolver = getPopupContainer
    return children
  },
}))

vi.mock('@/components/providers/public-nav-style-context', () => ({
  usePublicNavStyle: () => ({ publicNavStyle: scenario.appearance }),
}))

vi.mock('@/components/ui/liquid-glass-card', () => ({
  LiquidGlassCard: ({ children }: { children: ReactNode }) => createElement('div', { 'data-glass-surface': true }, children),
}))

describe('fixed navigation popup container', () => {
  afterEach(() => {
    scenario.appearance = 'standard'
    vi.unstubAllGlobals()
  })

  it.each(['standard', 'liquid-glass'])('mounts the popup host outside the %s surface', (appearance) => {
    scenario.appearance = appearance
    const html = renderToStaticMarkup(createElement(NavigationShell, {
      kind: 'public', brand: 'Brand', links: 'Links', actions: 'Actions',
    }))

    expect(html).toContain('data-navigation-shell="public"')
    expect(html).toMatch(/<\/nav><\/div><div[^>]*data-navigation-popup-host="true"><\/div><\/header>$/)
    expect(scenario.containerResolver).toBe(getNavigationPopupContainer)
  })

  it('resolves the host belonging to the trigger navigation', () => {
    const host = {} as HTMLElement
    const querySelector = vi.fn(() => host)
    const closest = vi.fn(() => ({ querySelector }))
    const trigger = { closest } as unknown as HTMLElement

    expect(getNavigationPopupContainer(trigger)).toBe(host)
    expect(closest).toHaveBeenCalledWith('[data-navigation-shell]')
    expect(querySelector).toHaveBeenCalledWith('[data-navigation-popup-host]')
  })

  it('falls back to the trigger document outside navigation', () => {
    const body = {} as HTMLElement
    const trigger = { closest: () => null, ownerDocument: { body } } as unknown as HTMLElement
    expect(getNavigationPopupContainer(trigger)).toBe(body)
  })

  it('supports components that request a container without a trigger', () => {
    const body = {} as HTMLElement
    vi.stubGlobal('document', { body })
    expect(getNavigationPopupContainer()).toBe(body)
  })
})
