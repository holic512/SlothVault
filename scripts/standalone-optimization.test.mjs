import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  pruneSharpRuntimePackages,
  removeSourceMaps,
} from './standalone-optimization.mjs'

const temporaryDirectories = []

async function temporaryDirectory() {
  const directory = await mkdtemp(resolve(tmpdir(), 'slothvault-standalone-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('standalone optimization', () => {
  it('removes source maps recursively without touching runtime files', async () => {
    const root = await temporaryDirectory()
    const nested = resolve(root, '.next', 'server', 'chunks')
    await mkdir(nested, { recursive: true })
    await writeFile(resolve(root, 'server.js'), 'runtime')
    await writeFile(resolve(nested, 'route.js.map'), '1234')
    await writeFile(resolve(nested, 'vendor.js.map'), '123456')
    await writeFile(resolve(nested, 'route.js'), 'compiled')

    await expect(removeSourceMaps(root)).resolves.toEqual({ bytes: 10, files: 2 })
    await expect(readFile(resolve(root, 'server.js'), 'utf8')).resolves.toBe('runtime')
    await expect(readFile(resolve(nested, 'route.js'), 'utf8')).resolves.toBe('compiled')
    await expect(readFile(resolve(nested, 'route.js.map'), 'utf8')).rejects.toThrow()
  })

  it('keeps only the current musl Sharp packages on Linux', async () => {
    const root = await temporaryDirectory()
    const imagePackages = resolve(root, 'node_modules', '@img')
    const packages = [
      'colour',
      'sharp-linux-arm64',
      'sharp-linuxmusl-arm64',
      'sharp-linuxmusl-x64',
      'sharp-libvips-linux-arm64',
      'sharp-libvips-linuxmusl-arm64',
      'sharp-libvips-linuxmusl-x64',
      'sharp-wasm32',
    ]
    for (const packageName of packages) {
      await mkdir(resolve(imagePackages, packageName), { recursive: true })
      await writeFile(resolve(imagePackages, packageName, 'payload'), packageName)
    }

    const result = await pruneSharpRuntimePackages(root, {
      platform: 'linux',
      architecture: 'arm64',
      libc: 'musl',
    })

    expect(result.packages).toEqual([
      'sharp-libvips-linux-arm64',
      'sharp-libvips-linuxmusl-x64',
      'sharp-linux-arm64',
      'sharp-linuxmusl-x64',
      'sharp-wasm32',
    ])
    await expect(
      readFile(resolve(imagePackages, 'sharp-linuxmusl-arm64', 'payload'), 'utf8'),
    ).resolves.toBe('sharp-linuxmusl-arm64')
    await expect(
      readFile(
        resolve(imagePackages, 'sharp-libvips-linuxmusl-arm64', 'payload'),
        'utf8',
      ),
    ).resolves.toBe('sharp-libvips-linuxmusl-arm64')
    await expect(
      readFile(resolve(imagePackages, 'colour', 'payload'), 'utf8'),
    ).resolves.toBe('colour')
  })

  it('does not prune Sharp packages outside a confirmed Alpine musl build', async () => {
    const root = await temporaryDirectory()
    const packagePath = resolve(
      root,
      'node_modules',
      '@img',
      'sharp-libvips-linux-arm64',
    )
    await mkdir(packagePath, { recursive: true })
    await writeFile(resolve(packagePath, 'payload'), 'keep')

    await expect(
      pruneSharpRuntimePackages(root, {
        platform: 'darwin',
        architecture: 'arm64',
        libc: 'unknown',
      }),
    ).resolves.toEqual({ bytes: 0, packages: [] })
    await expect(readFile(resolve(packagePath, 'payload'), 'utf8')).resolves.toBe('keep')
  })
})
