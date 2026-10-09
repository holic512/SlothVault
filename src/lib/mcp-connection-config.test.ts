import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { createMcpConnectionConfig, MCP_KEY_PLACEHOLDER, quotePosixShellArgument, resolveMcpEndpoint, tomlString } from './mcp-connection-config'

describe('native MCP configuration', () => {
  it.each([
    ['https://vault.example', 'https://vault.example/mcp'],
    ['https://vault.example:8443/', 'https://vault.example:8443/mcp'],
    ['http://localhost:3000', 'http://localhost:3000/mcp'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/mcp'],
    ['http://[::1]:3000', 'http://[::1]:3000/mcp'],
    ['https://vault.example/vault/', 'https://vault.example/vault/mcp'],
    ['https://vault.example/vault/mcp/', 'https://vault.example/vault/mcp'],
    ['https://vault.example/mcp', 'https://vault.example/mcp'],
    ['https://vault.example/%E8%B5%84%E6%96%99', 'https://vault.example/%E8%B5%84%E6%96%99/mcp'],
  ])('preserves the configured base %s', (configuredBaseUrl, endpoint) => {
    expect(resolveMcpEndpoint({ configuredBaseUrl, pageOrigin: 'http://localhost:3000' })).toBe(endpoint)
  })

  it('falls back only to the page origin', () => {
    expect(resolveMcpEndpoint({ pageOrigin: 'http://localhost:3000' })).toBe('http://localhost:3000/mcp')
    expect(() => resolveMcpEndpoint({ pageOrigin: 'https://vault.example/zh/admin/mm/mcp' })).toThrow()
  })

  it.each([
    'file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@vault.example',
    'https://vault.example?x=1', 'https://vault.example#fragment', 'https://vault.example?',
    'https://vault.example\\evil', ' https://vault.example', 'https://vault.example/\n',
    'https://vault.example/../evil', 'https://vault.example/%2e%2e/evil', 'https://vault.example/%2fadmin',
    'https://vault.example/%252e%252e', 'https://vault.example/%5c', 'https://vault.example/%00',
    'https://vault.example/%0a', 'https://vault.example/%24%28id%29', 'https://vault.example/$(id)',
    'https://vault.example/";echo', 'https://vault.example/%', 'https://vault.example:99999',
  ])('rejects unsafe configured addresses before creating a Key: %s', (configuredBaseUrl) => {
    expect(() => resolveMcpEndpoint({ configuredBaseUrl, pageOrigin: 'https://safe.example' })).toThrow('Invalid MCP endpoint')
  })

  it('round trips TOML strings and the actual template through a TOML parser', () => {
    const key = `${MCP_KEY_PLACEHOLDER}_"\\'\u00e9`
    const config = createMcpConnectionConfig({ pageOrigin: 'https://vault.example:8443', key })
    const result = spawnSync('python3', ['-c', 'import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: config.codexToml, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ mcp_servers: { slothvault: {
      url: config.endpoint, http_headers: { Authorization: `Bearer ${key}` },
      default_tools_approval_mode: 'auto', tool_timeout_sec: 120,
    } } })
    const value = 'quote" slash\\ backspace\b tab\t newline\n form\f carriage\r control\u0001 DEL\u007f emoji😀'
    const escaped = spawnSync('python3', ['-c', 'import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())["value"]))'], { input: `value = ${tomlString(value)}`, encoding: 'utf8' })
    expect(escaped.status, escaped.stderr).toBe(0)
    expect(JSON.parse(escaped.stdout)).toBe(value)
    expect(() => tomlString('\ud800')).toThrow()
  })

  it('captures exact POSIX arguments without evaluating token metacharacters', () => {
    const key = `${MCP_KEY_PLACEHOLDER}'\";$(printf INJECTED)\`printf INJECTED\`&|<>`.replaceAll(' ', '_')
    const config = createMcpConnectionConfig({ pageOrigin: 'http://localhost:3000', key })
    const result = spawnSync('/bin/sh', ['-c', `claude() { printf '%s\\0' "$@"; }; ${config.claudeCommand}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', NODE_ENV: 'test' } })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.split('\0').slice(0, -1)).toEqual([
      'mcp', 'add', '--transport', 'http', '--scope', 'user', 'slothvault', config.endpoint,
      '--header', `Authorization: Bearer ${key}`,
    ])
    expect(() => quotePosixShellArgument('a\0b')).toThrow()
  })

  it.each(['', 'TOKEN\nINJECTION', 'TOKEN WITH SPACE'])('rejects invalid Key input', (key) => {
    expect(() => createMcpConnectionConfig({ pageOrigin: 'https://vault.example', key })).toThrow()
  })
})
