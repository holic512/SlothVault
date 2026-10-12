/**
 * @file scripts/docker-image-size.mjs
 * @project SlothVault
 * @module Container Release Metrics
 * @description Reads OCI manifests and reports architecture-specific compressed image sizes.
 * @logic Require both deployment platforms for new images, inspect image configs for single manifests, and allow historical partial baselines explicitly.
 * @dependencies Docker Buildx, node:child_process, node:fs/promises
 * @index_tags docker,buildx,oci,manifest,image-size,github-actions
 * @author holic512
 */
import { spawnSync } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const supportedPlatforms = ['linux/amd64', 'linux/arm64']

function digestFromReference(imageReference) {
  const digestStart = imageReference.lastIndexOf('@sha256:')
  return digestStart >= 0 ? imageReference.slice(digestStart + 1) : null
}

export function compressedLayerBytes(manifest) {
  return (manifest.layers ?? []).reduce(
    (total, layer) => total + Number(layer.size ?? 0),
    0,
  )
}

export async function inspectPlatformSizes(imageReference, inspectRaw, {
  platforms = supportedPlatforms,
  allowPartial = false,
  inspectConfig,
} = {}) {
  const index = JSON.parse(await inspectRaw(imageReference))
  if (Array.isArray(index.layers)) {
    if (!inspectConfig) throw new Error('Single-platform manifests require image config inspection')
    const config = await inspectConfig(imageReference)
    const platform = `${config.os}/${config.architecture}`
    if (!platforms.includes(platform)) throw new Error(`Unexpected image platform ${platform}`)
    if (!allowPartial && platforms.length !== 1) throw new Error('Image is missing required deployment platforms')
    return {
      [platform]: {
        bytes: compressedLayerBytes(index),
        digest: digestFromReference(imageReference),
        layers: index.layers.length,
      },
    }
  }
  const repositoryReference = imageReference.includes('@sha256:')
    ? imageReference.slice(0, imageReference.indexOf('@sha256:'))
    : imageReference
  const entries =
    (index.manifests ?? [])
      .filter((manifest) => manifest.platform?.os === 'linux' && platforms.includes(`linux/${manifest.platform.architecture}`))
      .map((manifest) => [
        `${manifest.platform.os}/${manifest.platform.architecture}`,
        manifest,
      ])
  const descriptors = new Map(entries)
  if (entries.length !== descriptors.size) throw new Error('Image index has duplicate platform descriptors')
  const result = {}

  for (const platform of platforms) {
    const descriptor = descriptors.get(platform)
    if (!descriptor) {
      if (allowPartial) continue
      throw new Error(`Image index is missing ${platform}`)
    }
    const manifest = JSON.parse(
      await inspectRaw(`${repositoryReference}@${descriptor.digest}`),
    )
    result[platform] = {
      bytes: compressedLayerBytes(manifest),
      digest: descriptor.digest,
      layers: manifest.layers?.length ?? 0,
    }
  }
  if (!Object.keys(result).length) throw new Error('Image has no supported deployment platforms')
  return result
}

export function formatMebibytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

export function dockerInspect(reference, format = '--raw') {
  const result = spawnSync(
    'docker',
    ['buildx', 'imagetools', 'inspect', reference, ...(format === '--raw' ? ['--raw'] : ['--format', format])],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
  )
  if (result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr.trim() ||
        `Unable to inspect ${reference}`,
    )
  }
  return result.stdout
}

export async function inspectWithRetry(reference, attempts = 5, options = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await inspectPlatformSizes(reference, dockerInspect, {
        inspectConfig: ref => JSON.parse(dockerInspect(ref, '{{json .Image}}')),
        ...options,
      })
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
      }
    }
  }
  throw lastError
}

async function writeGitHubOutputs(outputPath, sizes) {
  const lines = []
  for (const [platform, result] of Object.entries(sizes)) {
    const architecture = platform.split('/')[1]
    lines.push(`${architecture}_bytes=${result.bytes}`)
    lines.push(`${architecture}_mib=${formatMebibytes(result.bytes)}`)
    lines.push(`${architecture}_digest=${result.digest}`)
  }
  await appendFile(outputPath, `${lines.join('\n')}\n`)
}

async function main() {
  const imageReference = process.argv[2]
  const allowMissing = process.argv.includes('--allow-missing')
  const outputIndex = process.argv.indexOf('--github-output')
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined

  if (!imageReference) {
    throw new Error('Usage: node scripts/docker-image-size.mjs IMAGE_REFERENCE')
  }

  try {
    const sizes = await inspectWithRetry(imageReference, allowMissing ? 1 : 5, {
      allowPartial: process.argv.includes('--allow-partial'),
    })
    if (outputPath) await writeGitHubOutputs(outputPath, sizes)
    process.stdout.write(`${JSON.stringify(sizes, null, 2)}\n`)
  } catch (error) {
    if (!allowMissing) throw error
    process.stderr.write(`Image size unavailable: ${error.message}\n`)
    process.stdout.write('{}\n')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
