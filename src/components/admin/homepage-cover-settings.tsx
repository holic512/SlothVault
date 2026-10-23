'use client'

/**
 * @file homepage-cover-settings.tsx
 * @project SlothVault
 * @module Homepage Cover Administration
 * @description Provides independent, explicit-save cover settings with responsive crop previews for the system homepage.
 * @logic Load the published cover on opening, upload a single managed image, retain disabled artwork and focal position, guard unsaved drafts, and publish changes only on save.
 * @dependencies React, Ant Design, next-intl, api-client, homepage-cover, document-content
 * @index_tags admin,homepage,cover,upload,crop,preview,draft
 * @author holic512
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Alert, App, Button, Drawer, Skeleton, Slider, Switch } from 'antd'
import { ImageUp, Monitor, RotateCcw, Smartphone, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'

import { formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import { DOCUMENT_IMAGE_MAX_BYTES } from '@/lib/document-content'
import { DEFAULT_HOMEPAGE_COVER, homepageCoverUrl, type HomepageCover } from '@/lib/homepage-cover'
import styles from '@/styles/modules/homepage-cover-settings.module.css'

const ENDPOINT = '/api/admin/mm/homepage-cover'
const COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function coversEqual(left: HomepageCover, right: HomepageCover) {
  return left.enabled === right.enabled && left.filePath === right.filePath
    && left.positionX === right.positionX && left.positionY === right.positionY
}

export function HomepageCoverSettings() {
  const t = useTranslations('HomepageCover')
  const errorT = useTranslations('AdminMM.errors')
  const { message, modal } = App.useApp()
  const controlId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const loadController = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<HomepageCover>(DEFAULT_HOMEPAGE_COVER)
  const [baseline, setBaseline] = useState<HomepageCover>(DEFAULT_HOMEPAGE_COVER)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = open && !loading && !loadError && !coversEqual(draft, baseline)
  const busy = uploading || saving
  const previewUrl = homepageCoverUrl(draft)

  useEffect(() => () => loadController.current?.abort(), [])

  useEffect(() => {
    if (!dirty && !uploading) return
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const preventNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const destination = new URL(link.href, window.location.href)
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return
      if (!window.confirm(t('discardDescription'))) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', preventUnload)
    document.addEventListener('click', preventNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', preventUnload)
      document.removeEventListener('click', preventNavigation, true)
    }
  }, [dirty, t, uploading])

  const load = async () => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoading(true)
    setLoadError(null)
    setNotice(null)
    try {
      const cover = await apiFetch<HomepageCover>(ENDPOINT, { signal: controller.signal })
      if (controller.signal.aborted) return
      setDraft(cover)
      setBaseline(cover)
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(formatAdminError(error, errorT))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const close = () => {
    if (busyRef.current) return
    const discard = () => {
      loadController.current?.abort()
      setDraft(baseline)
      setNotice(null)
      setOpen(false)
    }
    if (!dirty) { discard(); return }
    modal.confirm({
      title: t('discardTitle'),
      content: t('discardDescription'),
      okText: t('discard'),
      cancelText: t('keepEditing'),
      okButtonProps: { danger: true },
      onOk: discard,
    })
  }

  const upload = async (file?: File) => {
    if (!file || busyRef.current) return
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) || (file.type && !COVER_TYPES.has(file.type.toLowerCase())) || !file.size || file.size > DOCUMENT_IMAGE_MAX_BYTES) {
      setNotice(t('invalidImage'))
      return
    }
    busyRef.current = true
    setUploading(true)
    setNotice(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const files = await apiFetch<{ url: string }[]>('/api/admin/mm/file?businessType=Markdown', { method: 'POST', body })
      if (!files[0]?.url) throw new Error(t('uploadFailed'))
      const filePath = files[0].url.replace(/^\/+/, '')
      setDraft((current) => ({ ...current, enabled: current.filePath ? current.enabled : true, filePath, positionX: 50, positionY: 50 }))
    } catch (error) {
      setNotice(formatAdminError(error, errorT))
    } finally {
      busyRef.current = false
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const save = useCallback(async () => {
    if (busyRef.current || !dirty || (draft.enabled && !draft.filePath)) return
    busyRef.current = true
    setSaving(true)
    setNotice(null)
    try {
      const saved = await apiFetch<HomepageCover>(ENDPOINT, { method: 'PUT', body: JSON.stringify(draft) })
      setBaseline(saved)
      setDraft(saved)
      message.success(t('saved'))
    } catch (error) {
      setNotice(formatAdminError(error, errorT))
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }, [dirty, draft, errorT, message, t])

  useEffect(() => {
    if (!open) return
    const saveCover = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      event.stopImmediatePropagation()
      void save()
    }
    document.addEventListener('keydown', saveCover, true)
    return () => document.removeEventListener('keydown', saveCover, true)
  }, [open, save])

  return <>
    <Button icon={<ImageUp size={14} aria-hidden="true" />} onClick={() => { setOpen(true); void load() }}>{t('title')}</Button>
    <Drawer
      rootClassName={styles.drawer}
      title={t('title')}
      open={open}
      size="min(640px, 100vw)"
      onClose={close}
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
      footer={<div className={styles.footer}>
        <span className={styles['save-hint']} role="status">{dirty ? t('unsaved') : t('saveHint')}</span>
        <div className={styles['footer-actions']}>
          <Button disabled={busy} onClick={close}>{t('cancel')}</Button>
          <Button type="primary" loading={saving} disabled={loading || Boolean(loadError) || uploading || !dirty || (draft.enabled && !draft.filePath)} onClick={() => void save()}>{t('save')}</Button>
        </div>
      </div>}
    >
      {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : loadError ? <Alert showIcon type="error" title={t('loadFailed')} description={loadError} action={<Button onClick={() => void load()}>{t('retry')}</Button>} /> : <div className={styles.content}>
        <div className={styles['enable-row']}>
          <div><label className={styles.label} htmlFor={`${controlId}-enabled`}>{t('enabled')}</label><p className={styles.help}>{t('enabledHint')}</p></div>
          <Switch id={`${controlId}-enabled`} checked={draft.enabled} disabled={busy || !draft.filePath} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
        </div>
        {notice ? <Alert showIcon type="error" title={notice} description={t('retryHint')} /> : null}
        <section aria-labelledby={`${controlId}-image`} className={styles.section}>
          <h3 id={`${controlId}-image`} className={styles['section-title']}>{t('image')}</h3>
          {!draft.filePath ? <div className={styles.empty}>
            <ImageUp size={26} aria-hidden="true" />
            <p>{t('empty')}</p>
            <Button loading={uploading} disabled={saving} onClick={() => inputRef.current?.click()}>{t('upload')}</Button>
          </div> : <div className={styles['image-actions']}>
            <Button icon={<ImageUp size={15} aria-hidden="true" />} loading={uploading} disabled={saving} onClick={() => inputRef.current?.click()}>{t('replace')}</Button>
            <Button icon={<Trash2 size={15} aria-hidden="true" />} danger disabled={busy} onClick={() => { setDraft({ ...DEFAULT_HOMEPAGE_COVER }); setNotice(null) }}>{t('remove')}</Button>
          </div>}
          <input ref={inputRef} className={styles['file-input']} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" tabIndex={-1} aria-label={t('upload')} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} />
          <p className={styles.help}>{t('imageHint')}</p>
        </section>
        {previewUrl ? <>
          <section aria-labelledby={`${controlId}-preview`} className={styles.section}>
            <h3 id={`${controlId}-preview`} className={styles['section-title']}>{t('preview')}</h3>
            {!draft.enabled ? <p className={styles['disabled-hint']}>{t('disabledHint')}</p> : null}
            <div className={styles.previews}>
              {(['desktop', 'mobile'] as const).map((device) => <figure key={device} className={device === 'mobile' ? styles['mobile-figure'] : styles['desktop-figure']}>
                <figcaption className={styles['preview-label']}>{device === 'desktop' ? <Monitor size={15} aria-hidden="true" /> : <Smartphone size={15} aria-hidden="true" />}<span>{t(device)}</span><span className={styles['preview-dimensions']}>{device === 'desktop' ? '1440 × 259' : '390 × 180'}</span></figcaption>
                <div className={`${styles.preview} ${device === 'mobile' ? styles['mobile-preview'] : styles['desktop-preview']}`}>
                  <Image key={previewUrl} src={previewUrl} alt={t('previewAlt', { device: t(device) })} fill unoptimized sizes={device === 'desktop' ? '592px' : '260px'} style={{ objectFit: 'cover', objectPosition: `${draft.positionX}% ${draft.positionY}%` }} onError={() => setNotice(t('previewFailed'))} />
                  <div className={styles['preview-nav']} aria-hidden="true"><span>SlothVault</span><span className={styles['nav-placeholder']} /></div>
                </div>
              </figure>)}
            </div>
            <p className={styles.help}>{t('previewHint')}</p>
          </section>
          <section aria-labelledby={`${controlId}-focus`} className={styles.section}>
            <div className={styles['focus-heading']}><h3 id={`${controlId}-focus`} className={styles['section-title']}>{t('focus')}</h3><Button type="text" size="small" icon={<RotateCcw size={13} aria-hidden="true" />} disabled={busy || (draft.positionX === 50 && draft.positionY === 50)} onClick={() => setDraft((current) => ({ ...current, positionX: 50, positionY: 50 }))}>{t('reset')}</Button></div>
            <div className={styles['focus-control']}>
              <div className={styles['axis-label']}><span id={`${controlId}-horizontal`}>{t('horizontal')}</span><output>{draft.positionX}%</output></div>
              <Slider min={0} max={100} value={draft.positionX} ariaLabelledByForHandle={`${controlId}-horizontal`} disabled={busy} onChange={(positionX) => setDraft((current) => ({ ...current, positionX }))} />
              <div className={styles['axis-ends']} aria-hidden="true"><span>{t('left')}</span><span>{t('right')}</span></div>
            </div>
            <div className={styles['focus-control']}>
              <div className={styles['axis-label']}><span id={`${controlId}-vertical`}>{t('vertical')}</span><output>{draft.positionY}%</output></div>
              <Slider min={0} max={100} value={draft.positionY} ariaLabelledByForHandle={`${controlId}-vertical`} disabled={busy} onChange={(positionY) => setDraft((current) => ({ ...current, positionY }))} />
              <div className={styles['axis-ends']} aria-hidden="true"><span>{t('top')}</span><span>{t('bottom')}</span></div>
            </div>
            <p className={styles.help}>{t('focusHint')}</p>
          </section>
        </> : null}
      </div>}
    </Drawer>
  </>
}
