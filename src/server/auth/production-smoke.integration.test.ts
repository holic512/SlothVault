/** Opt-in smoke test: requires npm run build, uses only a new temporary SQLite installation. */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'
import { createPendingDatabaseConfiguration, writeDatabaseConfiguration, resetDatabaseConfigurationCacheForTests } from '@/server/database/config-store'
import { resetMasterKeyCacheForTests } from '@/server/config/master-key'
import { hashPassword } from '@/server/auth/password'
import { CURRENT_SCHEMA_REVISION } from '@/server/database/schema-version'

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()))
  return address.port
}

it.runIf(process.env.RUN_AUTH_PRODUCTION_SMOKE === '1')('serves the built application with unified login, secure cookies, renewal and role guards', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sv-auth-production-'))
  let child: ChildProcess | undefined
  let output = ''
  try {
    vi.stubEnv('APP_DATA_PATH', root)
    vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64url'))
    resetMasterKeyCacheForTests(); resetDatabaseConfigurationCacheForTests()
    mkdirSync(join(root, 'database'), { recursive: true })
    const databasePath = join(root, 'database', 'slothvault.db')
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/providers/sqlite/schema.prisma'], {
      env: { ...process.env, SLOTHVAULT_PRISMA_PROVIDER: 'sqlite', SLOTHVAULT_PRISMA_DATABASE_URL: `file:${databasePath}` }, stdio: 'pipe', timeout: 60_000,
    })
    const password = randomUUID()
    const hash = await hashPassword(password)
    const db = new Database(databasePath)
    try {
      db.prepare('INSERT INTO system_installation(id,provider,status,schema_revision,installation_id) VALUES(1,?,?,?,?)').run('sqlite', 'INSTALLED', CURRENT_SCHEMA_REVISION, randomUUID())
      const insert = db.prepare('INSERT INTO auth_user(username,password,role) VALUES(?,?,?)')
      insert.run('smoke_admin', hash, 'ADMIN'); insert.run('smoke_user', hash, 'USER')
    } finally { db.close() }
    writeDatabaseConfiguration({ ...createPendingDatabaseConfiguration({ provider: 'sqlite', config: {} }), status: 'INSTALLED' })
    const standalone = resolve('.next/standalone')
    cpSync('.next/static', join(standalone, '.next/static'), { recursive: true })
    mkdirSync(join(standalone, 'public'), { recursive: true })
    if (existsSync('public/logo.png')) cpSync('public/logo.png', join(standalone, 'public/logo.png'))
    const port = await freePort(), base = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, [join(standalone, 'server.js')], {
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', SLOTHVAULT_AUTO_BOOTSTRAP: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const record = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-6000) }
    child.stdout!.on('data', record); child.stderr!.on('data', record)
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Production server exited: ${output}`)
      try { if ((await fetch(`${base}/api/auth/session`, { signal: AbortSignal.timeout(5000) })).ok) { ready = true; break } } catch { /* Wait for startup. */ }
      await delay(500)
    }
    if (!ready) throw new Error(`Production startup timed out: ${output}`)
    const request = (path: string, body?: unknown, cookie = '') => fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(15_000), redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
      headers: { origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const legacyPage = await request('/admin/auth/login')
    expect(legacyPage.status).toBe(307)
    expect(legacyPage.headers.get('location')).toBe('/login?next=/admin/mm')
    const anonymousAdmin = await request('/admin/mm')
    expect(anonymousAdmin.status).toBe(307)
    expect(anonymousAdmin.headers.get('location')).toBe('/login?next=/admin/mm')
    const html = await (await request('/login', undefined, 'sv_locale=en')).text()
    expect(html).toContain('Remember account')
    expect(html).toContain('Keep me signed in for up to 7 days')
    expect(html).not.toContain('Keep me signed in for 30 days')
    for (const role of ['user', 'admin']) {
      const response = await request('/api/auth/login', { identifier: `smoke_${role}`, password, remember: role === 'admin' })
      expect(response.status).toBe(200)
      const setCookie = response.headers.get('set-cookie')!
      expect(setCookie).toContain('Secure'); expect(setCookie).toContain('HttpOnly')
      expect(setCookie.includes('Expires=')).toBe(role === 'admin')
      const cookie = setCookie.split(';')[0]
      const page = await request('/admin/mm', undefined, cookie)
      expect(page.status).toBe(role === 'admin' ? 200 : 307)
      if (role === 'user') expect(page.headers.get('location')).toBe('/account')
      const renewed = await request('/api/auth/session/renew', {}, cookie)
      expect(renewed.status).toBe(200)
      expect(renewed.headers.get('cache-control')).toContain('no-store')
      expect((await renewed.json()).data.persistent).toBe(role === 'admin')
      expect((await request('/api/auth/logout', {}, cookie)).status).toBe(200)
      expect((await request('/api/auth/session/renew', {}, cookie)).status).toBe(401)
    }
    // Optional read-only browser inspection window; only the loopback address is printed.
    const browserWindow = Math.min(Number(process.env.AUTH_SMOKE_BROWSER_WINDOW_MS) || 0, 300_000)
    if (browserWindow > 0) {
      writeFileSync(join(root, 'browser-url'), `${base}/login`, { mode: 0o600 })
      const deadline = Date.now() + browserWindow
      while (Date.now() < deadline && !existsSync(join(root, 'browser-done'))) await delay(500)
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([new Promise<void>(resolveExit => child!.once('exit', () => resolveExit())), delay(5000)])
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise<void>(resolveExit => child!.once('exit', () => resolveExit())) }
    }
    resetMasterKeyCacheForTests(); resetDatabaseConfigurationCacheForTests(); vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
}, 420_000)
