import { commands } from '@uiw/react-md-editor'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { localizeEditorCommand } from './markdown-editor-commands'

describe('localized editor controls', () => {
  it('translates headings and preview controls without changing library commands or shortcuts', () => {
    const original = commands.bold.buttonProps?.title
    const bold = localizeEditorCommand(commands.bold, { bold: '粗体' }, true)
    expect(bold.buttonProps).toMatchObject({ title: '粗体', 'aria-label': '粗体', disabled: true })
    expect(bold.shortcuts).toBe(commands.bold.shortcuts)
    expect(bold.execute).toBe(commands.bold.execute)
    expect(commands.bold.buttonProps?.title).toBe(original)
    const headings = localizeEditorCommand(commands.group([commands.heading1, commands.heading2], { name: 'heading', buttonProps: { title: 'Heading' } }), { heading: '标题', heading1: '一级标题', heading2: '二级标题' })
    expect(headings.buttonProps?.title).toBe('标题')
    expect(Array.isArray(headings.children) && headings.children.map((command) => command.buttonProps?.title)).toEqual(['一级标题', '二级标题'])
    if (Array.isArray(headings.children)) expect(renderToStaticMarkup(headings.children[0].icon!)).toContain('一级标题')
    expect(localizeEditorCommand(commands.codePreview, { preview: '仅预览' }).buttonProps?.title).toBe('仅预览')
  })
})
