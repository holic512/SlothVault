'use client'

/**
 * @file markdown-content-editor.tsx
 * @project SlothVault
 * @module Markdown Editing Surface
 * @description Wraps React MD Editor with the SlothVault toolbar, theme bridge, and authenticated image upload command.
 * @logic Keep the editor controlled, dynamically load its browser-only surface, and insert uploaded image URLs at the active selection.
 * @dependencies @uiw/react-md-editor, next/dynamic, next-themes, lucide-react
 * @index_tags markdown,editor,upload,theme,react
 * @author holic512
 */
import { useMemo, useRef, useState } from 'react'

import type { ICommand, TextAreaTextApi } from '@uiw/react-md-editor'
import { commands } from '@uiw/react-md-editor'
import { ImageUp } from 'lucide-react'
import dynamic from 'next/dynamic'

import { useResolvedAppTheme } from '@/components/providers/app-theme-context'

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false })

export function MarkdownContentEditor({
  value,
  onChange,
  onUpload,
}: {
  value: string
  onChange: (value: string) => void
  onUpload: (files: File[]) => Promise<string[]>
}) {
  const resolvedTheme = useResolvedAppTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const textApiRef = useRef<TextAreaTextApi | null>(null)
  const [uploading, setUploading] = useState(false)

  const uploadCommand = useMemo<ICommand>(
    () => ({
      name: 'upload-image',
      keyCommand: 'upload-image',
      icon: <ImageUp size={13} />,
      buttonProps: {
        'aria-label': uploading ? 'Uploading image' : 'Upload image',
        title: uploading ? 'Uploading…' : 'Upload image',
        disabled: uploading,
      },
      execute: (_state, api) => {
        textApiRef.current = api
        inputRef.current?.click()
      },
    }),
    [uploading],
  )

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
      commands.hr,
    ],
    [uploadCommand],
  )

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !textApiRef.current) return
    setUploading(true)
    try {
      const urls = await onUpload(Array.from(files))
      if (urls.length) {
        textApiRef.current.replaceSelection(
          urls.map((url, index) => `![image-${index + 1}](${url})`).join('\n\n'),
        )
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div
      className="markdown-editor-shell"
      data-color-mode={resolvedTheme === 'light' ? 'light' : 'dark'}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <MDEditor
        value={value}
        onChange={(nextValue) => onChange(nextValue || '')}
        height={680}
        preview="live"
        visibleDragbar={false}
        commands={editorCommands}
        extraCommands={[commands.codeEdit, commands.codeLive, commands.codePreview, commands.fullscreen]}
      />
    </div>
  )
}
