/**
 * @file mcp-connection-config.ts
 * @project SlothVault
 * @module Native MCP Connection Configuration
 * @description Generates validated direct HTTP configurations for Codex and Claude Code without storing credentials.
 * @logic Prefer an explicitly configured external base URL, otherwise use the browser origin, validate before normalization, and escape TOML and POSIX shell arguments independently.
 * @dependencies URL
 * @index_tags mcp,native-client,endpoint,toml,shell,credentials
 * @author holic512
 */

export type McpConnectionConfig = {
  endpoint: string
  codexToml: string
  claudeCommand: string
}

export const MCP_KEY_PLACEHOLDER = 'SLOTHVAULT_MCP_KEY_EXAMPLE_ONLY'

function invalidEndpoint(): never {
  throw new Error('Invalid MCP endpoint')
}

function validUrl(value: string) {
  // Validate the source before URL normalizes dot segments, backslashes, or whitespace.
  if (!/^https?:\/\/[^/]/i.test(value) || /[\u0000-\u0020\u007f-\u009f\\"'`<>|{};$?#]/u.test(value)) invalidEndpoint()
  try {
    const path = value.replace(/^https?:\/\/[^/]+/i, '')
    const decoded = decodeURIComponent(path)
    if (/[\u0000-\u001f\u007f-\u009f\\"'`<>|{};$?#%]/u.test(decoded)) invalidEndpoint()
    if (/%2f/i.test(path) || decoded.split('/').some((segment) => segment === '.' || segment === '..')) invalidEndpoint()
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) invalidEndpoint()
    return url
  } catch {
    return invalidEndpoint()
  }
}

export function resolveMcpEndpoint(input: { configuredBaseUrl?: string; pageOrigin: string }) {
  const configured = input.configuredBaseUrl !== undefined && input.configuredBaseUrl !== ''
  const url = validUrl(configured ? input.configuredBaseUrl! : input.pageOrigin)
  // The fallback is an origin, never a locale or administration page URL.
  if (!configured && url.pathname !== '/') invalidEndpoint()
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/mcp') ? path : `${path}/mcp`
  return url.href
}

export function tomlString(value: string) {
  if (/\p{Surrogate}/u.test(value)) throw new Error('Invalid configuration string')
  const escapes: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' }
  return `"${Array.from(value, (character) => {
    if (escapes[character]) return escapes[character]
    const point = character.codePointAt(0)!
    return point < 0x20 || point === 0x7f ? `\\u${point.toString(16).padStart(4, '0')}` : character
  }).join('')}"`
}

export function quotePosixShellArgument(value: string) {
  if (value.includes('\0')) throw new Error('Invalid shell argument')
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

export function createMcpConnectionConfig(input: { configuredBaseUrl?: string; pageOrigin: string; key: string }): McpConnectionConfig {
  if (!input.key || /[\u0000-\u0020\u007f-\u009f]/u.test(input.key)) throw new Error('Invalid MCP key')
  const endpoint = resolveMcpEndpoint(input)
  const authorization = `Authorization: Bearer ${input.key}`
  return {
    endpoint,
    codexToml: [
      '[mcp_servers.slothvault]',
      `url = ${tomlString(endpoint)}`,
      `http_headers = { Authorization = ${tomlString(`Bearer ${input.key}`)} }`,
      'default_tools_approval_mode = "auto"',
      'tool_timeout_sec = 120',
    ].join('\n'),
    // --header is variadic: put it after the two positional arguments.
    claudeCommand: `claude mcp add --transport http --scope user slothvault ${quotePosixShellArgument(endpoint)} --header ${quotePosixShellArgument(authorization)}`,
  }
}
