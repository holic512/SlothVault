/**
 * @file scripts/docker-smoke.mjs
 * @project SlothVault
 * @module Native production image verification
 * @description Exercises native packages, release identity and first-install HTTP behavior in a disposable container.
 * @logic Run SQLite, Argon2, Sharp and Prisma on the runner CPU, start an isolated application, poll installation status, and remove only the task-owned container.
 * @dependencies Docker Engine, built SlothVault image, Node.js
 * @index_tags docker,smoke-test,arm64,native,release
 * @author holic512
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const [image, platform, version, tag, sha] = process.argv.slice(2)
if (!image || !['linux/amd64', 'linux/arm64'].includes(platform) || !version || !tag || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
  throw new Error('Usage: docker-smoke.mjs IMAGE PLATFORM VERSION TAG COMMIT_SHA')
}
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] })
const nativeChecks = `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import sharp from 'sharp';
assert.equal(process.platform, 'linux');
assert.equal(process.arch, process.env.EXPECTED_ARCH);
assert.equal(process.env.SLOTHVAULT_APP_VERSION, process.env.EXPECTED_VERSION);
assert.equal(process.env.SLOTHVAULT_RELEASE_TAG, process.env.EXPECTED_TAG);
assert.equal(process.env.SLOTHVAULT_RELEASE_COMMIT_SHA, process.env.EXPECTED_SHA);
const db = new Database(':memory:');
db.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
db.prepare('INSERT INTO smoke VALUES (?)').run('native-ok');
assert.equal(db.prepare('SELECT value FROM smoke').get().value, 'native-ok');
db.close();
const encoded = await argon2.hash('ephemeral-smoke-input');
assert.equal(await argon2.verify(encoded, 'ephemeral-smoke-input'), true);
const pixels = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer();
assert.equal((await sharp(pixels).metadata()).width, 2);
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', '--version'], { timeout: 30000, stdio: 'pipe' });
console.log('Native SQLite, Argon2, Sharp, Prisma and release identity: passed');
`
const nativeResult = execFileSync('docker', ['run', '--rm', '-i', '--platform', platform, '--entrypoint', 'node',
  '-e', `EXPECTED_ARCH=${platform === 'linux/amd64' ? 'x64' : 'arm64'}`, '-e', `EXPECTED_VERSION=${version}`,
  '-e', `EXPECTED_TAG=${tag}`, '-e', `EXPECTED_SHA=${sha}`, image, '--input-type=module', '-'],
{ input: nativeChecks, encoding: 'utf8', timeout: 60_000 })
process.stdout.write(nativeResult)
const name = `slothvault-smoke-${randomUUID()}`
let started = false
try {
  docker(['run', '--detach', '--name', name, '--platform', platform, '--publish', '127.0.0.1::3000', image])
  started = true
  const address = docker(['port', name, '3000/tcp']).trim()
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Unexpected smoke container port')
  const deadline = Date.now() + 120_000
  let lastError
  let ready = false
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${address}/api/install/status`, { signal: AbortSignal.timeout(2000) })
      if (!response.ok) throw new Error(`Installation status returned HTTP ${response.status}`)
      const body = await response.json()
      if (body.code !== 0 || body.data?.status !== 'UNCONFIGURED') throw new Error('Unexpected first-install state')
      ready = true
      break
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  if (!ready) throw new Error(`Application did not become ready: ${lastError?.message}`)
  console.log(`${platform} application installation status: passed`)
} catch (error) {
  if (started) process.stderr.write(docker(['logs', '--tail', '60', name]))
  throw error
} finally {
  // A unique name ensures cleanup cannot affect another task's application.
  try { docker(['rm', '--force', '--volumes', name]) } catch { /* Container creation may have failed. */ }
}
