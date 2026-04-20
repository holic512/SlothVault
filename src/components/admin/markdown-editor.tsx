'use client'

import dynamic from 'next/dynamic'

const Editor = dynamic(
  () => import('md-editor-rt').then((mod) => mod.MdEditor),
  { ssr: false }
)

type Props = {
  value?: string
  modelValue?: string
  onChange?: (value: string) => void
}

export function MarkdownEditor({ value, modelValue, onChange }: Props) {
  return <Editor modelValue={modelValue ?? value ?? ''} onChange={(next) => onChange?.(next)} />
}
