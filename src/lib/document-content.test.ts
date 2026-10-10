import {
  DOCUMENT_CONTENT_MAX_CHARACTERS,
  DOCUMENT_IMAGE_MAX_BYTES,
  getDocumentContentStats,
  isDocumentContentWithinLimit,
  validateDocumentImages,
  validateDocumentUploads,
} from '@/lib/document-content'
import { sanitizeDocumentInlineStyle } from '@/lib/markdown-security'

describe('document content constraints', () => {
  it('counts mixed line endings and enforces the shared character limit', () => {
    expect(getDocumentContentStats('HTML\r\nMarkdown\n')).toEqual({ characters: 15, lines: 3 })
    expect(isDocumentContentWithinLimit('a'.repeat(DOCUMENT_CONTENT_MAX_CHARACTERS))).toBe(true)
    expect(isDocumentContentWithinLimit('a'.repeat(DOCUMENT_CONTENT_MAX_CHARACTERS + 1))).toBe(false)
  })

  it('rejects unsupported, oversized, and oversized-batch editor images', () => {
    expect(validateDocumentImages([{ name: 'notes.pdf', size: 1, type: 'application/pdf' }])).toMatchObject({
      code: 'unsupported-type',
    })
    expect(validateDocumentImages([{ name: 'large.png', size: DOCUMENT_IMAGE_MAX_BYTES + 1, type: 'image/png' }])).toMatchObject({
      code: 'file-too-large',
    })
    expect(validateDocumentImages([
      { name: 'one.png', size: 7 * 1024 * 1024, type: 'image/png' },
      { name: 'two.png', size: 7 * 1024 * 1024, type: 'image/png' },
      { name: 'three.png', size: 7 * 1024 * 1024, type: 'image/png' },
    ])).toMatchObject({ code: 'batch-too-large' })
  })

  it('validates ZIP as a download attachment while keeping image uploads separate', () => {
    const zip = { name: 'source.ZIP', size: 22, type: 'application/zip' }
    expect(validateDocumentUploads([zip], true)).toBeNull()
    expect(validateDocumentImages([zip])).toMatchObject({ code: 'unsupported-type' })
    expect(validateDocumentUploads([{ ...zip, name: 'program.exe' }], true)).toMatchObject({ code: 'unsupported-type' })
    expect(validateDocumentUploads([{ ...zip, size: DOCUMENT_IMAGE_MAX_BYTES + 1 }], true)).toMatchObject({ code: 'file-too-large' })
  })

  it('keeps bounded presentation styles and removes unsafe CSS capabilities', () => {
    expect(
      sanitizeDocumentInlineStyle(
        'text-align: center; padding: 12px 20px; color: var(--sv-text); position: fixed; background-image: url(https://example.com/a.png)',
      ),
    ).toBe('')
    expect(
      sanitizeDocumentInlineStyle(
        'text-align: center; padding: 12px 20px; color: var(--sv-text); position: fixed',
      ),
    ).toBe('text-align: center; padding: 12px 20px; color: var(--sv-text)')
  })
})
import { describe, expect, it } from 'vitest'
