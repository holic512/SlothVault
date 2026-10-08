/**
 * @file project-document-content.tsx
 * @project SlothVault
 * @module Project Document Outline
 * @description Adds a responsive heading outline to the public Markdown reader.
 * @logic Read headings from the rendered document, reuse their anchors, and track the current section while scrolling.
 * @dependencies React, MarkdownView
 * @index_tags project,markdown,outline,navigation
 * @author holic512
 */
'use client'

import { useEffect, useRef, useState } from 'react'

import { MarkdownView } from '@/components/markdown/markdown-view'
import styles from '@/styles/modules/document-outline.module.css'

type DocumentHeading = { id: string; title: string; level: number }

export function readDocumentHeadings(root: ParentNode): DocumentHeading[] {
  return Array.from(root.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
    .filter((heading) => heading.textContent?.trim())
    .map((heading) => ({
      id: heading.id,
      title: heading.textContent!.trim(),
      level: Number(heading.tagName.slice(1)),
    }))
}

export function ProjectDocumentContent({ content, outlineLabel, projectId, canDownload, downloadMessage }: { content: string; outlineLabel: string; projectId?: string; canDownload?: boolean; downloadMessage?: string }) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [headings, setHeadings] = useState<DocumentHeading[]>([])
  const [activeId, setActiveId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const root = documentRef.current
    if (!root) return
    const entries = readDocumentHeadings(root)
    setHeadings(entries)
    const elements = Array.from(root.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
      .filter((heading) => heading.textContent?.trim())
    let frame = 0
    const updateActiveHeading = () => {
      frame = 0
      const offset = Number.parseFloat(getComputedStyle(elements[0] || root).scrollMarginTop) || 128
      let current = elements[0]?.id || ''
      for (const element of elements) {
        if (element.getBoundingClientRect().top > offset + 1) break
        current = element.id
      }
      setActiveId(current)
    }
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateActiveHeading)
    }
    updateActiveHeading()
    window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true })
    window.addEventListener('resize', scheduleUpdate)
    root.addEventListener('load', scheduleUpdate, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
      root.removeEventListener('load', scheduleUpdate, true)
    }
  }, [content])

  const minimumLevel = Math.min(...headings.map((heading) => heading.level))
  return (
    <div className={styles.root}>
      {headings.length > 0 && (
        <details
          className={styles.outline}
          open={pinned || hovered || focused}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse' && window.matchMedia('(min-width: 1101px)').matches) setHovered(true)
          }}
          onPointerLeave={() => setHovered(false)}
          onFocus={(event) => {
            if (event.target !== event.currentTarget.querySelector('summary')) setFocused(true)
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
          }}
        >
          <summary className={styles.trigger} aria-label={outlineLabel} onClick={(event) => {
            event.preventDefault()
            setPinned(!pinned)
          }}>
            <span className={styles['mobile-label']}>{outlineLabel}</span>
            <span className={styles.rail} aria-hidden="true">
              {headings.map((heading) => (
                <span key={heading.id} data-active={heading.id === activeId} style={{ width: `${24 - (heading.level - minimumLevel) * 3}px` }} />
              ))}
            </span>
          </summary>
          <nav className={styles.panel} aria-label={outlineLabel}>
            <strong className={styles.label}>{outlineLabel}</strong>
            <ul>
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    aria-current={heading.id === activeId ? 'location' : undefined}
                    style={{ paddingInlineStart: `${12 + (heading.level - minimumLevel) * 12}px` }}
                    onClick={(event) => {
                      const target = Array.from(documentRef.current?.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]') || [])
                        .find((element) => element.id === heading.id)
                      if (!target) return
                      event.preventDefault()
                      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
                      window.history.replaceState(null, '', `#${encodeURIComponent(heading.id)}`)
                      target.tabIndex = -1
                      target.focus({ preventScroll: true })
                      setActiveId(heading.id)
                    }}
                  >
                    {heading.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      )}
      <div ref={documentRef}><MarkdownView content={content} projectId={projectId} canDownload={canDownload} downloadMessage={downloadMessage} /></div>
    </div>
  )
}
