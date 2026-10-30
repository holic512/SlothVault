import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { contentLinkEdits, replaceContentLinks } from './markdown-links'

const old = '/project/501/v/502/docs/503'
const target = '/project/05d49877-7fc1-4d5f-b258-a681f6b48269'
function rewrite(source: string) {
  const edits = contentLinkEdits(source)
  return replaceContentLinks(source, edits, new Map(edits.map(edit => [edit.url, edit.url.replace(old, target)])))
}

describe('rendered content link targets', () => {
  it('locates raw Markdown destinations independently of decoded entities and escapes', () => {
    const source = `[Read](${old}?x=1&amp;y=2)\n\n[Escaped](${old}?path=a\\(b\\))\n\n[Angle](<${old}?x=1&amp;y=2>)\n\n[Reference][ref]\n\n[ref]: ${old}?x=1&amp;y=2 "Title"`
    expect(contentLinkEdits(source)).toHaveLength(4)
    const result = rewrite(source)
    const tree = unified().use(remarkParse).parse(result)
    const urls: string[] = []
    const collect = (node: unknown) => {
      const item = node as { url?: string; children?: unknown[] }
      if (item.url) urls.push(item.url)
      item.children?.forEach(collect)
    }
    collect(tree)
    expect(urls).toEqual([`${target}?x=1&y=2`, `${target}?path=a(b)`, `${target}?x=1&y=2`, `${target}?x=1&y=2`])
  })

  it('converts actual HTML attributes and leaves code, comments and attribute text unchanged', () => {
    const examples = `<pre><code>&lt;a href="${old}"&gt;</code></pre>\n\n<!-- <a href="${old}"> -->\n\n\`[Code](${old})\`\n\n\`\`\`html\n<a href="${old}">\n\`\`\``
    expect(rewrite(examples)).toBe(examples)
    const html = `<aside><a title=' href="${old}"' href="${old}?x=1&amp;y=2">Link</a></aside>`
    expect(rewrite(html)).toBe(`<aside><a title=' href="${old}"' href="${target}?x=1&amp;y=2">Link</a></aside>`)
  })
})
