'use client'

/**
 * @file mermaid-diagram.tsx
 * @project SlothVault
 * @module Markdown Diagram Surface
 * @description Displays Mermaid diagrams with shared theme, loading and source fallbacks.
 * @logic Debounce content changes, discard stale renders and preserve escaped source on failures.
 * @dependencies mermaid-render, app-theme-context, next-intl
 * @index_tags markdown,mermaid,preview,accessibility
 * @author holic512
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useResolvedAppTheme } from '@/components/providers/app-theme-context'
import { MERMAID_MAX_CHARACTERS, renderMermaid } from '@/lib/mermaid-render'

export function MermaidDiagram({ source }: { source: string }) {
  const theme = useResolvedAppTheme()
  const t = useTranslations('MarkdownView.mermaid')
  const [result, setResult] = useState<{ source: string; theme: string; svg?: string; failed?: boolean }>()
  const tooLarge = source.length > MERMAID_MAX_CHARACTERS
  const current = result?.source === source && result.theme === theme ? result : undefined
  useEffect(() => {
    if (tooLarge) return
    let active = true
    const timer = window.setTimeout(() => {
      void renderMermaid(source, theme === 'dark').then(
        (svg) => { if (active) setResult({ source, theme, svg }) },
        () => { if (active) setResult({ source, theme, failed: true }) },
      )
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [source, theme, tooLarge])

  return (
    <div className="sloth-mermaid" data-mermaid-state={tooLarge || current?.failed ? 'error' : current?.svg ? 'ready' : 'loading'}>
      {current?.svg ? (
        <div className="sloth-mermaid-graphic" role="img" aria-label={t('diagramLabel')} dangerouslySetInnerHTML={{ __html: current.svg }} />
      ) : (
        <>
          <p role="status">{tooLarge ? t('tooLarge', { maximum: MERMAID_MAX_CHARACTERS }) : current?.failed ? t('failed') : t('loading')}</p>
          <pre><code className="language-mermaid">{source}</code></pre>
        </>
      )}
    </div>
  )
}
