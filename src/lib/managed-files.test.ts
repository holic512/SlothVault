import { describe, expect, it } from 'vitest'
import { contextualFileUrl, extractManagedFiles, managedUploadPath } from './managed-files'

describe('managed file reference parsing', () => {
  it('indexes Markdown, reference links and sanitized HTML with distinct capabilities', () => {
    const markdown = '![diagram](/uploads/docs/a.png)\n[file][f]\n\n[f]: /uploads/docs/source.zip\n\n<img src="/uploads/docs/b.webp"><a href="/uploads/docs/readme.md">code</a>\n[copy image](/uploads/docs/a.png)'
    expect(extractManagedFiles(markdown)).toEqual(expect.arrayContaining([
      { filePath: 'uploads/docs/a.png', usage: 'READ_MEDIA' },
      { filePath: 'uploads/docs/a.png', usage: 'DOWNLOAD' },
      { filePath: 'uploads/docs/source.zip', usage: 'DOWNLOAD' },
      { filePath: 'uploads/docs/b.webp', usage: 'READ_MEDIA' },
      { filePath: 'uploads/docs/readme.md', usage: 'DOWNLOAD' },
    ]))
  })
  it('does not grant references for code, comments, scripts or external URLs', () => {
    expect(extractManagedFiles('`[file](/uploads/a.zip)`\n\n```md\n![x](/uploads/a.png)\n```\n<!-- <a href="/uploads/a.zip">hidden</a> -->\n<script><a href="/uploads/a.zip">x</a></script>\n[file](https://external.example/uploads/a.zip)')).toEqual([])
  })
  it.each(['/uploads/%2e%2e/a.zip', '/uploads/a/%2e%2e/%2e%2e/x', '/uploads/a%5Cb.zip', '/uploads/%00x', '/uploads//a', '/uploads/%ZZ'])('rejects unsafe paths %s', (path) => expect(managedUploadPath(path)).toBeNull())
  it('recognizes absolute same-site addresses only for the configured origin', () => {
    expect(managedUploadPath('https://vault.example/uploads/a.zip', 'https://vault.example')).toBe('uploads/a.zip')
    expect(managedUploadPath('https://external.example/uploads/a.zip', 'https://vault.example')).toBeNull()
  })
  it('adds verified project context to rendered links without rewriting signed source', () => {
    const source = '[file](/uploads/docs/source.zip)\r\n'
    expect(contextualFileUrl('/uploads/docs/source.zip', '3', true)).toBe('/uploads/docs/source.zip?projectId=3&download=1')
    expect(contextualFileUrl('https://external.example/a.zip', '3', true)).toBe('https://external.example/a.zip')
    extractManagedFiles(source)
    expect(source).toBe('[file](/uploads/docs/source.zip)\r\n')
  })
})
