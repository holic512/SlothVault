'use client'

/**
 * @file markdown-insert-dialog.tsx
 * @project SlothVault
 * @module Markdown Preset Authoring
 * @description Configures data-only extension presets with the production Markdown preview.
 * @logic Preserve the editor selection until one validated undoable insertion is confirmed.
 * @dependencies antd, extension registry, MarkdownView, next-intl
 * @index_tags markdown,editor,presets,preview
 * @author holic512
 */
import { useMemo, useState } from 'react'
import { Modal } from 'antd'
import { useTranslations } from 'next-intl'
import { markdownPresets } from '@/lib/markdown/contract'
import { validateMarkdown } from '@/lib/markdown/processor'
import { MarkdownView, type MarkdownPresentation } from '@/components/markdown/markdown-view'

export function MarkdownInsertDialog({ selection, onClose, onInsert, disabled, presentation, projectId, canDownload, downloadMessage }: { selection: string; onClose: () => void; onInsert: (source: string) => string | undefined; disabled: boolean; presentation: MarkdownPresentation; projectId?: string; canDownload?: boolean; downloadMessage?: string }) {
  const t = useTranslations('MarkdownExtensions')
  const [presetId, setPresetId] = useState(markdownPresets[0].id)
  const [source, setSource] = useState(markdownPresets[0].source)
  const [notice, setNotice] = useState('')
  const result = useMemo(() => validateMarkdown(source), [source])
  const preset = markdownPresets.find(item => item.id === presetId)!
  const choose = (id: string) => {
    const next = markdownPresets.find(item => item.id === id)!
    setPresetId(id)
    setSource(next.source.replace('{{selection}}', selection || t('bodyPlaceholder')))
    setNotice('')
  }
  return <Modal open title={t('insertTitle')} width={1040} onCancel={onClose} onOk={() => { const error = onInsert(source); if (error) setNotice(error); else onClose() }} okText={t('insert')} cancelText={t('cancel')} okButtonProps={{ disabled: disabled || !result.valid || !source.trim() }} className="markdown-insert-modal">
    <div className="markdown-insert-controls"><label>{t('category')}<select value={preset.category} onChange={event => choose(markdownPresets.find(item => item.category === event.target.value)!.id)}>{['charts', 'motion', 'layout'].map(category => <option key={category} value={category}>{t(category)}</option>)}</select></label><label>{t('preset')}<select value={presetId} onChange={event => choose(event.target.value)}>{markdownPresets.filter(item => item.category === preset.category).map(item => <option key={item.id} value={item.id}>{t(`presets.${item.label}`)}</option>)}</select></label></div>
    <div className="markdown-insert-grid"><label>{t('configuration')}<textarea value={source} onChange={event => setSource(event.target.value)} spellCheck={false} /></label><section aria-label={t('preview')}><MarkdownView content={source} presentation={presentation} projectId={projectId} canDownload={canDownload} downloadMessage={downloadMessage} /></section></div>
    <p className="markdown-insert-help">{t('sourceHelp')}</p>{(!result.valid || notice) && <p role="alert">{notice || `${result.issues[0].line}:${result.issues[0].column} ${result.issues[0].code}`}</p>}
  </Modal>
}
