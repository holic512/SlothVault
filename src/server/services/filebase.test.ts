import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/services/system-config', () => ({
  CONFIG_KEYS: {
    FILEBASE_ACCESS_KEY: 'FILEBASE_ACCESS_KEY',
    FILEBASE_SECRET_KEY: 'FILEBASE_SECRET_KEY',
    FILEBASE_BUCKET: 'FILEBASE_BUCKET',
    FILEBASE_ENDPOINT: 'FILEBASE_ENDPOINT',
  },
  getConfigValue: vi.fn(async () => ''),
}))

import {
  deleteFilebaseObject,
  isFilebaseConfigured,
  uploadImageToFilebase,
  uploadMetadataToFilebase,
  uploadToFilebase,
} from '@/server/services/filebase'

type StoredObject = {
  body: Buffer
  contentType: string
}

type ObservedRequest = {
  method: string
  path: string
  authorization: string
}

const objects = new Map<string, StoredObject>()
const requests: ObservedRequest[] = []
let includeCid = true
let endpoint = ''
const runFilebaseS3 = process.env.RUN_FILEBASE_S3_SMOKE === '1'

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const server = createServer(async (request, response) => {
  const method = request.method || 'GET'
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const key = decodeURIComponent(url.pathname)
  requests.push({
    method,
    path: key,
    authorization: request.headers.authorization || '',
  })
  response.setHeader('x-amz-request-id', 'slothvault-filebase-test')

  if (method === 'PUT') {
    objects.set(key, {
      body: await readBody(request),
      contentType: request.headers['content-type'] || 'application/octet-stream',
    })
    response.statusCode = 200
    response.setHeader('etag', '"slothvault-test-etag"')
    response.end()
    return
  }

  if (method === 'HEAD') {
    const object = objects.get(key)
    if (!object) {
      response.statusCode = 404
      response.end()
      return
    }
    response.statusCode = 200
    response.setHeader('content-length', object.body.length.toString())
    response.setHeader('content-type', object.contentType)
    response.setHeader('etag', '"slothvault-test-etag"')
    if (includeCid) response.setHeader('x-amz-meta-cid', 'bafySlothVaultCid123')
    response.end()
    return
  }

  if (method === 'DELETE') {
    objects.delete(key)
    response.statusCode = 204
    response.end()
    return
  }

  response.statusCode = 404
  response.end()
})

beforeAll(async () => {
  if (!runFilebaseS3) return
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  endpoint = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  if (!runFilebaseS3 || !server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

beforeEach(() => {
  if (!runFilebaseS3) return
  objects.clear()
  requests.length = 0
  includeCid = true
  process.env.FILEBASE_ENDPOINT = endpoint
  process.env.FILEBASE_ACCESS_KEY = 'test-access-key'
  process.env.FILEBASE_SECRET_KEY = 'test-secret-key'
  process.env.FILEBASE_BUCKET = 'test-bucket'
})

describe.runIf(runFilebaseS3)('Filebase S3 integration', () => {
  it('uploads, reads Filebase CID metadata, and deletes the object', async () => {
    expect(await isFilebaseConfigured()).toBe(true)

    const uploaded = await uploadToFilebase(
      Buffer.from('{"hello":"world"}', 'utf8'),
      'metadata/example.json',
      'application/json',
    )

    expect(uploaded).toEqual({
      cid: 'bafySlothVaultCid123',
      ipfsUri: 'ipfs://bafySlothVaultCid123',
      gatewayUrl: 'https://ipfs.filebase.io/ipfs/bafySlothVaultCid123',
      key: 'metadata/example.json',
    })
    expect(objects.has('/test-bucket/metadata/example.json')).toBe(true)
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'PUT /test-bucket/metadata/example.json',
      'HEAD /test-bucket/metadata/example.json',
    ])
    expect(requests.every(({ authorization }) => authorization.startsWith('AWS4-HMAC-SHA256 ')))
      .toBe(true)

    await deleteFilebaseObject('metadata/example.json')
    expect(objects.has('/test-bucket/metadata/example.json')).toBe(false)
    expect(requests.at(-1)).toMatchObject({
      method: 'DELETE',
      path: '/test-bucket/metadata/example.json',
    })
  })

  it('generates bounded image and metadata object keys', async () => {
    const image = await uploadImageToFilebase(
      Buffer.from('image-bytes', 'utf8'),
      '../PNG',
      'image/png',
    )
    const metadata = await uploadMetadataToFilebase({ name: 'SlothVault QA' })

    expect(image.key).toMatch(/^images\/[0-9a-f-]+\.bin$/)
    expect(metadata.key).toMatch(/^metadata\/[0-9a-f-]+\.json$/)
    expect(requests.filter(({ method }) => method === 'PUT')).toHaveLength(2)
    expect(requests.filter(({ method }) => method === 'HEAD')).toHaveLength(2)
  })

  it('rejects a storage response without Filebase CID metadata', async () => {
    includeCid = false

    await expect(
      uploadToFilebase(Buffer.from('missing-cid'), 'metadata/missing.json', 'application/json'),
    ).rejects.toMatchObject({
      message: 'Filebase did not return an IPFS CID',
      status: 502,
      code: 502,
    })
  })

  it('rejects incomplete or unsafe runtime configuration', async () => {
    process.env.FILEBASE_SECRET_KEY = ''
    expect(await isFilebaseConfigured()).toBe(false)
    await expect(
      uploadToFilebase(Buffer.from('x'), 'metadata/x.json', 'application/json'),
    ).rejects.toMatchObject({ status: 400, code: 400 })

    process.env.FILEBASE_SECRET_KEY = 'test-secret-key'
    process.env.FILEBASE_ENDPOINT = 'file:///tmp/not-an-http-endpoint'
    await expect(
      uploadToFilebase(Buffer.from('x'), 'metadata/x.json', 'application/json'),
    ).rejects.toMatchObject({ status: 500, code: 500 })
  })

  it('ignores unsafe compensation keys without contacting storage', async () => {
    await deleteFilebaseObject('../metadata/object.json')
    await deleteFilebaseObject('/metadata/object.json')
    await deleteFilebaseObject('metadata\\object.json')
    expect(requests).toEqual([])
  })
})
