import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDocumentationDraftSchema, changelogContainsVersion, remapDocumentationLinks, sourceBaselineSchema } from './project-documentation'
afterEach(() => vi.unstubAllEnvs())
describe('documentation contracts', () => {
  it('rejects credentials in repository identities and path traversal', () => {
    expect(sourceBaselineSchema.safeParse({ repositoryIdentity: 'https://account:secret@host/repo', version: '1.0.0', commit: 'a'.repeat(40) }).success).toBe(false)
    expect(applyDocumentationDraftSchema.safeParse({ projectVersionId: '1', expectedRevision: 0, changes: [{ type: 'note', key: 'x', sourcePaths: ['../secret'] }] }).success).toBe(false)
  })
  it('matches exact changelog entries outside examples or comments', () => {
    expect(changelogContainsVersion('# 日志\n## 1.0.0（日期）', '1.0.0')).toBe(true)
    expect(changelogContainsVersion('# 日志\n## [v1.0.0](https://example.invalid)', '1.0.0')).toBe(true)
    expect(changelogContainsVersion('## 1.0.01', '1.0.0')).toBe(false)
    expect(changelogContainsVersion('```markdown\n## 1.0.0\n```\n<!--\n## 1.0.0\n-->', '1.0.0')).toBe(false)
  })
  it('remaps relative links without rewriting examples or other instances', () => {
    const link = '[Guide](/project/1/v/2/docs/3)'
    const source = `${link}\n\`\`${link}\`\`\n~~~markdown\n${link}\n~~~\n[Other](https://example.invalid/project/1/v/2/docs/3)`
    const result = remapDocumentationLinks(source, 1, 2, 5, new Map([[3, 7]]))
    expect(result.split('\n')[0]).toBe('[Guide](/preview/project/1/v/5/docs/7)')
    expect(result).toContain('~~~markdown\n' + link + '\n~~~')
    expect(result).toContain('`' + '`' + link + '`' + '`')
    expect(result).toContain('[Other](https://example.invalid/project/1/v/2/docs/3)')
  })
  it('remaps same-origin absolute source links and preserves external links and suffixes', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_ORIGIN', 'https://vault.example')
    const source = '[Local](https://vault.example/project/1/v/2/docs/3?x=1#part) [Other](https://other.example/project/1/v/2/docs/3)'
    expect(remapDocumentationLinks(source, 1, 2, 5, new Map([[3, 7]]), new Map([['/project/1/v/2/docs/3', '/project/public-clone']]))).toBe('[Local](/project/public-clone?x=1#part) [Other](https://other.example/project/1/v/2/docs/3)')
  })
})
