'use client'

/**
 * @file document-images.tsx
 * @project SlothVault
 * @module Markdown Image Preview
 * @description Groups visible document images and loads originals only in the shared lightbox.
 * @logic Delegate image activation from the article while preserving authored links and focus restoration.
 * @dependencies React, antd Image, next-intl, managed-file-paths
 * @index_tags markdown,images,lightbox,thumbnail
 * @author holic512
 */
import { cloneElement, useRef, useState, type ImgHTMLAttributes, type ReactNode, type ReactElement } from 'react'
import { Image } from 'antd'
import { useTranslations } from 'next-intl'
import { contextualFileUrl, managedUploadPath } from '@/lib/managed-file-paths'

export function DocumentImages({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const t = useTranslations('MarkdownExtensions')
  const [naturalSize, setNaturalSize] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const [preview, setPreview] = useState<{ items: { src: string; alt: string }[]; current: number; open: boolean }>({ items: [], current: 0, open: false })
  const open = (target: HTMLElement) => {
    const container = target.closest('[data-image-preview]')
    const image = container?.querySelector<HTMLImageElement>('img[data-original-src]')
    if (!image || target.closest('a')) return
    const images = [...ref.current!.querySelectorAll<HTMLImageElement>('img[data-original-src]')].filter(img => img.getClientRects().length > 0)
    const current = images.indexOf(image)
    if (current < 0) return
    setNaturalSize(false)
    opener.current = target.closest<HTMLElement>('button') || target
    setPreview({ open: true, current, items: images.map(img => ({ src: img.dataset.originalSrc!, alt: img.alt })) })
  }
  return <div ref={ref} className="sloth-document-images" onClick={event => open(event.target as HTMLElement)}>{children}{preview.items.length > 0 && <Image.PreviewGroup items={preview.items} preview={{ open: preview.open, current: preview.current, onChange: current => { setNaturalSize(false); setPreview(value => ({ ...value, current })) }, imageRender: (original, info) => <PreviewImage key={info.image.url} original={original as ReactElement<ImgHTMLAttributes<HTMLImageElement>>} naturalSize={naturalSize} />, actionsRender: (original, info) => <>{original}<button type="button" className="sloth-preview-size" onClick={() => { info.actions.onReset(); setNaturalSize(value => !value) }}>{naturalSize ? t('fitWindow') : t('originalSize')}</button></>, onOpenChange: open => { setPreview(value => ({ ...value, open })); if (!open) requestAnimationFrame(() => opener.current?.focus()) } }} />}</div>
}
export function DocumentImage({ projectId, linked = false, ...props }: ImgHTMLAttributes<HTMLImageElement> & { projectId?: string; linked?: boolean }) {
  const t = useTranslations('MarkdownExtensions')
  const original = contextualFileUrl(typeof props.src === 'string' ? props.src : undefined, projectId)
  const thumbnail = original && managedUploadPath(original) ? `${original}${original.includes('?') ? '&' : '?'}variant=markdown-thumbnail` : original
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const image = <ImageElement {...props} key={attempt} src={thumbnail} original={original} onError={() => setFailed(true)} />
  if (linked) return image
  return <span className="sloth-document-image" data-image-preview="true"><button type="button" className="sloth-image-trigger" aria-label={t('viewImage', { alt: props.alt || t('image') })}>{image}</button>{failed && <span role="status">{t('imageFailed')} <button type="button" onClick={event => { event.stopPropagation(); setFailed(false); setAttempt(value => value + 1) }}>{t('retry')}</button></span>}</span>
}
function ImageElement({ original, ...props }: ImgHTMLAttributes<HTMLImageElement> & { original?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} data-image-sized={Boolean(props.width || props.height || props.style?.width || props.style?.height) || undefined} style={{ ...props.style, width: props.style?.width ?? props.width, height: props.style?.height ?? props.height }} data-original-src={original} alt={props.alt || ''} decoding="async" loading="lazy" referrerPolicy="no-referrer" />
}

export function ImagePreviewAction() {
  const t = useTranslations('MarkdownExtensions')
  return <button className="sloth-image-open" type="button">{t('viewFull')}</button>
}

function PreviewImage({ original, naturalSize }: { original: ReactElement<ImgHTMLAttributes<HTMLImageElement>>; naturalSize: boolean }) {
  const t = useTranslations('MarkdownExtensions')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return <>{cloneElement(original, { key: attempt, style: naturalSize ? { ...original.props.style, maxWidth: 'none', maxHeight: 'none', width: 'auto', height: 'auto' } : original.props.style, onError: event => { original.props.onError?.(event); setFailed(true) } })}{failed && <div className="sloth-preview-error" role="status">{t('imageFailed')} <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>{t('retry')}</button></div>}</>
}
