'use client'

/**
 * @file markdown-content-editor.tsx
 * @project SlothVault
 * @module Mixed Document Editing Surface
 * @description Provides a fast Markdown workflow with safe HTML layout snippets, exact public-preview rendering, image upload, visible content constraints, optional host toolbar content, and a content-fit layout option.
 * @logic Keep the editor controlled, insert reusable mixed-content structures at the selection, validate pasted/dropped images, share the sanitized viewer for preview parity, let host workflows consolidate their title and actions into the editor header, and grow content-fit surfaces without a fixed maximum height.
 * @dependencies @uiw/react-md-editor, next/dynamic, next-intl, next-themes, lucide-react, MarkdownView
 * @index_tags markdown,html,editor,preview,upload,validation,accessibility
 * @author holic512
 */
import { useId, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, ReactNode } from 'react'

import type { ICommand } from '@uiw/react-md-editor'
import { commands, TextAreaTextApi } from '@uiw/react-md-editor'
import {
  Braces,
  CircleHelp,
  Columns3,
  ImageUp,
  ListCollapse,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'

import { MarkdownView } from '@/components/markdown/markdown-view'
import { useResolvedAppTheme } from '@/components/providers/app-theme-context'
import {
  DOCUMENT_CONTENT_MAX_CHARACTERS,
  type DocumentImageConstraintIssue,
  getDocumentContentStats,
  validateDocumentImages,
} from '@/lib/document-content'

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false })
const MEGABYTE = 1024 * 1024

function previewDocument(source: string) {
  return <MarkdownView content={source} className="markdown-editor-preview-content" />
}

function escapeMarkdownAlt(fileName: string, fallback: string) {
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, '').trim()
  return (nameWithoutExtension || fallback).replace(/[\[\]\\]/g, '').slice(0, 80)
}

function insertBlock(api: TextAreaTextApi, value: string) {
  api.replaceSelection(`\n\n${value.trim()}\n\n`)
}

export function MarkdownContentEditor({
  value,
  onChange,
  onUpload,
  readOnly = false,
  fitContent = false,
  header,
  headerActions,
}: {
  value: string
  onChange: (value: string) => void
  onUpload: (files: File[]) => Promise<string[]>
  readOnly?: boolean
  fitContent?: boolean
  header?: ReactNode
  headerActions?: ReactNode
}) {
  const t = useTranslations('DocumentEditor')
  const locale = useLocale()
  const resolvedTheme = useResolvedAppTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const textApiRef = useRef<TextAreaTextApi | null>(null)
  const [uploading, setUploading] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null)
  const editorId = useId().replace(/:/g, '')
  const guideId = `${editorId}-guide`
  const statusId = `${editorId}-status`
  const stats = useMemo(() => getDocumentContentStats(value), [value])
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const editorHeight = useMemo(() => {
    if (!fitContent) return 680
    const lineCount = Math.max(value.split(/\r?\n/).length, 4)
    return lineCount * 26 + 96
  }, [fitContent, value])

  const fileIssueMessage = (issue: DocumentImageConstraintIssue) => {
    switch (issue.code) {
      case 'too-many-files':
        return t('messages.tooManyFiles', { maximum: issue.maximum })
      case 'empty-file':
        return t('messages.emptyFile', { name: issue.fileName })
      case 'unsupported-type':
        return t('messages.unsupportedType', { name: issue.fileName })
      case 'file-too-large':
        return t('messages.fileTooLarge', {
          name: issue.fileName,
          maximum: Math.round(issue.maximumBytes / MEGABYTE),
        })
      case 'batch-too-large':
        return t('messages.batchTooLarge', {
          maximum: Math.round(issue.maximumBytes / MEGABYTE),
        })
    }
  }

  const handleFiles = async (files: File[], api = textApiRef.current) => {
    if (!files.length || !api || uploading) return
    const issue = validateDocumentImages(files)
    if (issue) {
      setNotice({ tone: 'error', text: fileIssueMessage(issue) })
      return
    }
    if (value.length + files.length * 4_096 > DOCUMENT_CONTENT_MAX_CHARACTERS) {
      setNotice({ tone: 'error', text: t('messages.uploadWouldExceedLimit') })
      return
    }

    textApiRef.current = api
    setNotice(null)
    setUploading(true)
    try {
      const urls = await onUpload(files)
      if (!urls.length) {
        setNotice({ tone: 'error', text: t('messages.uploadFailed') })
        return
      }

      const insertion = urls
        .map((url, index) => {
          const file = files[index]
          const alt = escapeMarkdownAlt(file?.name || '', t('imageFallbackAlt', { index: index + 1 }))
          const destination = encodeURI(url).replace(/[()\\]/g, '\\$&')
          return `![${alt}](${destination})`
        })
        .join('\n\n')
      const selectedLength = api.textArea.selectionEnd - api.textArea.selectionStart
      if (api.textArea.value.length - selectedLength + insertion.length > DOCUMENT_CONTENT_MAX_CHARACTERS) {
        setNotice({ tone: 'error', text: t('messages.uploadedButNotInserted') })
        return
      }
      api.replaceSelection(insertion)
      if (urls.length < files.length) {
        setNotice({ tone: 'warning', text: t('messages.partialUpload') })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : t('messages.uploadFailed'),
      })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const uploadCommand = useMemo<ICommand>(
    () => ({
      name: 'upload-image',
      keyCommand: 'upload-image',
      icon: <ImageUp size={13} />,
      buttonProps: {
        'aria-label': uploading ? t('uploading') : t('uploadImage'),
        title: uploading ? t('uploading') : t('uploadImage'),
        disabled: uploading,
      },
      execute: (_state, api) => {
        textApiRef.current = api
        inputRef.current?.click()
      },
    }),
    [t, uploading],
  )

  const htmlCommand = useMemo<ICommand>(() => {
    const callout: ICommand = {
      name: 'html-callout',
      keyCommand: 'html-callout',
      icon: <MessageSquareText size={13} />,
      buttonProps: { 'aria-label': t('snippets.callout'), title: t('snippets.callout') },
      execute: (state, api) => {
        const body = state.selectedText.trim() || t('snippets.calloutBody')
        insertBlock(
          api,
          `<section class="sloth-callout sloth-callout-note">\n\n**${t('snippets.calloutLabel')}**\n\n${body}\n\n</section>`,
        )
      },
    }
    const disclosure: ICommand = {
      name: 'html-disclosure',
      keyCommand: 'html-disclosure',
      icon: <ListCollapse size={13} />,
      buttonProps: { 'aria-label': t('snippets.disclosure'), title: t('snippets.disclosure') },
      execute: (state, api) => {
        const body = state.selectedText.trim() || t('snippets.disclosureBody')
        insertBlock(
          api,
          `<details class="sloth-disclosure">\n<summary>${t('snippets.disclosureSummary')}</summary>\n\n${body}\n\n</details>`,
        )
      },
    }
    const columns: ICommand = {
      name: 'html-columns',
      keyCommand: 'html-columns',
      icon: <Columns3 size={13} />,
      buttonProps: { 'aria-label': t('snippets.columns'), title: t('snippets.columns') },
      execute: (state, api) => {
        const firstBody = state.selectedText.trim() || t('snippets.columnBodyOne')
        insertBlock(
          api,
          `<div class="sloth-content-grid">\n\n<section class="sloth-content-card">\n\n### ${t('snippets.columnTitleOne')}\n\n${firstBody}\n\n</section>\n\n<section class="sloth-content-card">\n\n### ${t('snippets.columnTitleTwo')}\n\n${t('snippets.columnBodyTwo')}\n\n</section>\n\n</div>`,
        )
      },
    }

    return commands.group([callout, disclosure, columns], {
      name: 'html-snippets',
      icon: <Braces size={13} />,
      buttonProps: { 'aria-label': t('htmlSnippets'), title: t('htmlSnippets') },
    })
  }, [t])

  const editorCommands = useMemo<ICommand[]>(
    () => [
      commands.bold,
      commands.italic,
      commands.strikethrough,
      commands.divider,
      commands.title,
      commands.quote,
      commands.unorderedListCommand,
      commands.orderedListCommand,
      commands.checkedListCommand,
      commands.divider,
      commands.code,
      commands.codeBlock,
      commands.link,
      uploadCommand,
      commands.table,
      htmlCommand,
      commands.hr,
    ],
    [htmlCommand, uploadCommand],
  )

  const rememberTextApi = (target: HTMLTextAreaElement) => {
    textApiRef.current = new TextAreaTextApi(target)
  }
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    const api = new TextAreaTextApi(event.currentTarget)
    void handleFiles(files, api)
  }
  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    event.preventDefault()
    const api = new TextAreaTextApi(event.currentTarget)
    void handleFiles(files, api)
  }
  const handleValueChange = (nextValue: string) => {
    if (
      nextValue.length > DOCUMENT_CONTENT_MAX_CHARACTERS &&
      !(value.length > DOCUMENT_CONTENT_MAX_CHARACTERS && nextValue.length <= value.length)
    ) {
      setNotice({ tone: 'error', text: t('messages.contentLimitReached') })
      return
    }
    setNotice(null)
    onChange(nextValue)
  }

  const overLimit = stats.characters > DOCUMENT_CONTENT_MAX_CHARACTERS
  const nearLimit = stats.characters >= DOCUMENT_CONTENT_MAX_CHARACTERS * 0.9
  const statusTone = notice?.tone || (overLimit ? 'error' : nearLimit ? 'warning' : 'neutral')
  let statusText = t('ready')
  if (nearLimit) statusText = t('messages.nearContentLimit')
  if (overLimit) statusText = t('messages.existingContentTooLarge')
  if (notice) statusText = notice.text
  if (uploading) statusText = t('uploading')

  return (
    <div
      className={`markdown-editor-shell ${fitContent ? 'markdown-editor-shell--content-fit' : 'markdown-editor-shell--fill'}`}
      data-color-mode={resolvedTheme === 'light' ? 'light' : 'dark'}
      data-uploading={uploading || undefined}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/gif,image/jpeg,image/png,image/webp"
        multiple
        onChange={(event) => void handleFiles(Array.from(event.target.files || []))}
      />

      <div className="document-editor-intro">
        {header || (
          <div className="document-editor-mode">
            <span className="document-editor-mode-icon" aria-hidden="true"><Braces size={15} /></span>
            <span>
              <strong>{t('title')}</strong>
              <small>{t('description')}</small>
            </span>
          </div>
        )}
        <div className="document-editor-intro-actions">
          {headerActions}
          <button
            className="document-editor-guide-toggle"
            type="button"
            aria-expanded={guideOpen}
            aria-controls={guideId}
            onClick={() => setGuideOpen((current) => !current)}
          >
            <CircleHelp size={14} />
            {guideOpen ? t('hideGuide') : t('showGuide')}
          </button>
        </div>
      </div>

      {guideOpen ? (
        <div className="document-editor-guide" id={guideId}>
          <div>
            <strong>{t('guide.fastTitle')}</strong>
            <span>{t('guide.fastDescription')}</span>
          </div>
          <div>
            <strong>{t('guide.layoutTitle')}</strong>
            <span>{t('guide.layoutDescription')}</span>
          </div>
          <div>
            <strong><ShieldCheck size={13} /> {t('guide.safetyTitle')}</strong>
            <span>{t('guide.safetyDescription')}</span>
          </div>
        </div>
      ) : null}

      <MDEditor
        value={value}
        onChange={(nextValue) => handleValueChange(nextValue || '')}
        height={editorHeight}
        preview="live"
        visibleDragbar={false}
        commands={readOnly ? [] : editorCommands}
        extraCommands={readOnly ? [commands.codePreview, commands.fullscreen] : [commands.codeEdit, commands.codeLive, commands.codePreview, commands.fullscreen]}
        components={{ preview: previewDocument }}
        textareaProps={{
          'aria-label': t('textareaLabel'),
          'aria-describedby': `${guideOpen ? `${guideId} ` : ''}${statusId}`,
          readOnly: uploading || readOnly,
          spellCheck: true,
          onClick: (event) => rememberTextApi(event.currentTarget),
          onKeyUp: (event) => rememberTextApi(event.currentTarget),
          onSelect: (event) => rememberTextApi(event.currentTarget),
          onPaste: handlePaste,
          onDrop: handleDrop,
          onDragOver: (event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          },
        }}
      />

      <div className="document-editor-status" id={statusId} data-tone={statusTone} role="status" aria-live="polite">
        <span>{statusText}</span>
        <span>
          {t('stats', {
            characters: numberFormatter.format(stats.characters),
            limit: numberFormatter.format(DOCUMENT_CONTENT_MAX_CHARACTERS),
            lines: numberFormatter.format(stats.lines),
          })}
        </span>
      </div>
    </div>
  )
}
