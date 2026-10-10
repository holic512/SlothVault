import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolDirectory = path.join(projectRoot, 'src', 'server', 'mcp', 'tools')
const outputPath = path.join(projectRoot, 'docs', 'MCP_REGISTRY.md')

const EXPECTED_TOOL_COUNT = 71
const TOOL_ANNOTATION_METADATA = {
  READ_ONLY_ANNOTATIONS: { risk: 'read', idempotency: 'idempotent' },
  CREATE_ANNOTATIONS: { risk: 'write', idempotency: 'non-idempotent' },
  UPDATE_ANNOTATIONS: { risk: 'write', idempotency: 'non-idempotent' },
  IDEMPOTENT_CREATE_ANNOTATIONS: { risk: 'write', idempotency: 'idempotent' },
  IDEMPOTENT_UPDATE_ANNOTATIONS: { risk: 'write', idempotency: 'idempotent' },
}

/** Reads Tool names and their authoritative annotation metadata from declaration modules. */
function readToolDeclarations() {
  const declarations = []
  for (const fileName of fs.readdirSync(toolDirectory).filter((name) => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(toolDirectory, fileName), 'utf8')
    const matches = [...source.matchAll(/defineTool\(\s*'([^']+)'/g)]
    for (const [index, match] of matches.entries()) {
      const declarationSource = source.slice(match.index, matches[index + 1]?.index ?? source.length)
      const annotations = [...declarationSource.matchAll(/annotations:\s*([A-Z][A-Z0-9_]*)/g)]
      if (annotations.length !== 1) {
        throw new Error(`Tool ${match[1]} must declare exactly one supported annotations constant`)
      }
      const annotationName = annotations[0][1]
      const metadata = TOOL_ANNOTATION_METADATA[annotationName]
      if (!metadata) {
        throw new Error(`Tool ${match[1]} uses unsupported annotations: ${annotationName}`)
      }
      declarations.push({ name: match[1], ...metadata })
    }
  }
  if (declarations.length !== EXPECTED_TOOL_COUNT) {
    throw new Error(`Expected ${EXPECTED_TOOL_COUNT} MCP Tools, found ${declarations.length}`)
  }
  if (new Set(declarations.map(({ name }) => name)).size !== declarations.length) {
    throw new Error('MCP Tool names must be unique')
  }
  return declarations
}

/** Reads the structured Resource catalog shared with runtime registration. */
function readResources() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'src', 'server', 'mcp', 'resource-catalog.json'),
    'utf8',
  )
  return JSON.parse(source)
}

/** Returns the declared Resource permission inferred by the runtime registry. */
function resourcePermissionFor(name) {
  if (name === 'content.file.get') return 'managed-file:read'
  if (name === 'admin.contract.attachment.get') return 'contract-attachment:read'
  return '-'
}

/** Renders the deterministic registry inventory. */
function render() {
  const tools = readToolDeclarations()
  const resources = readResources()
  const lines = [
    '# MCP Registry (generated)',
    '',
    '<!-- GENERATED FILE: run `npm run mcp:docs` after changing MCP declarations. -->',
    '',
    `Tool count: **${tools.length}**`,
    '',
    '| Tool | Domain | Risk | Idempotency | Resource permission |',
    '| --- | --- | --- | --- | --- |',
    ...tools.map(({ name, risk, idempotency }) => {
      const parts = name.split('.')
      const domain = parts.slice(0, -1).join('.')
      return `| \`${name}\` | \`${domain}\` | ${risk} | ${idempotency} | ${resourcePermissionFor(name)} |`
    }),
    '',
    `Resource count: **${resources.length}**`,
    '',
    '| Resource | URI | MIME | Filename limit | Maximum bytes |',
    '| --- | --- | --- | ---: | ---: |',
    ...resources.map((resource) =>
      `| \`${resource.name}\` | \`${resource.uriTemplate}\` | \`${resource.mimeType}\` | ${resource.maxNameLength} | ${resource.maxBytes} |`),
    '',
    'This document is generated from the declaration registry. CI must run `npm run mcp:docs:check` and fail when the checked-in output is stale.',
    '',
    '## 笔记标签',
    '',
    '`content.note.list`、`content.note.get` 和笔记写入工具均返回 `tags: string[]`。',
    '`content.note.create`、`content.note.update` 接受可选的 `tags` 数组：创建时省略表示无标签，更新时省略保留原值，传入 `[]` 清空。',
    '标签去除首尾空白、忽略空项，按大小写敏感文本去重并保留输入顺序；每篇最多 10 个，每个最多 30 个字符。',
    '标签属于笔记元数据，同一笔记的正文版本共用标签。修改标签要求项目版本未发布，复制为草稿时保留标签。',
    '标签不参与发布清单和正文存证哈希计算。',
    '单标签操作优先使用 `content.note.tag.list/add/rename/remove`，全部返回 `{ noteId, tags }`。写操作在事务中保留其他标签，要求所属项目版本未发布。',
    '`list` 接受 `{ noteId }`；`add`、`remove` 接受 `{ noteId, tag }`；`rename` 接受 `{ noteId, tag, newTag }`。标签名称去首尾空白、不能为空，大小写敏感。',
    '重复添加和移除不存在的标签均返回当前列表；改名保持原顺序，原标签不存在返回 404，新名称被其他标签占用返回 409。',
  ]
  return `${lines.join('\n')}\n`
}

const rendered = render()
if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
  if (current !== rendered) {
    console.error('MCP registry documentation is stale. Run: npm run mcp:docs')
    process.exitCode = 1
  }
} else {
  fs.writeFileSync(outputPath, rendered, 'utf8')
}
