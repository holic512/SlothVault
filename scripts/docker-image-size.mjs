/**
 * @file scripts/docker-image-size.mjs
 * @project SlothVault
 * @module Container Release Metrics
 * @description Reads a pushed OCI image index and reports compressed layer sizes for the supported deployment platforms.
 * @logic Inspect the index and each platform manifest through Buildx, total compressed layer bytes, and optionally publish stable GitHub Actions outputs.
 * @dependencies Docker Buildx, node:child_process, node:fs/promises
 * @index_tags docker,buildx,oci,manifest,image-size,github-actions
 * @author holic512
 */
import { spawnSync } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const supportedPlatforms = ['linux/amd64', 'linux/arm64']

export function compressedLayerBytes(manifest) {
  return (manifest.layers ?? []).reduce(
    (total, layer) => total + Number(layer.size ?? 0),
    0,
  )
}

export async function inspectPlatformSizes(imageReference, inspectRaw) {
  const index = JSON.parse(await inspectRaw(imageReference))
  const repositoryReference = imageReference.includes('@sha256:')
    ? imageReference.slice(0, imageReference.indexOf('@sha256:'))
    : imageReference
  const descriptors = new Map(
    (index.manifests ?? [])
      .filter((manifest) => manifest.platform?.os && manifest.platform?.architecture)
      .map((manifest) => [
        `${manifest.platform.os}/${manifest.platform.architecture}`,
        manifest,
      ]),
  )
  const result = {}

  for (const platform of supportedPlatforms) {
    const descriptor = descriptors.get(platform)
    if (!descriptor) {
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

  return result
}

export function formatMebibytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

async function dockerInspectRaw(reference) {
  const result = spawnSync(
    'docker',
    ['buildx', 'imagetools', 'inspect', reference, '--raw'],
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

async function inspectWithRetry(reference, attempts = 5) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await inspectPlatformSizes(reference, dockerInspectRaw)
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
    const sizes = await inspectWithRetry(imageReference, allowMissing ? 1 : 5)
    if (outputPath) await writeGitHubOutputs(outputPath, sizes)
    process.stdout.write(`${JSON.stringify(sizes, null, 2)}\n`)
  } catch (error) {
    if (!allowMissing) throw error
    process.stderr.write(`Image size unavailable: ${error.message}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
