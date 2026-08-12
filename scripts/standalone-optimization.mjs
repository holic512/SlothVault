/**
 * @file scripts/standalone-optimization.mjs
 * @project SlothVault
 * @module Production Standalone Optimization
 * @description Removes production-only diagnostic files and non-runtime Sharp binaries from a completed Next.js standalone tree.
 * @logic Delete source maps recursively, detect Alpine musl builds, and retain only the Sharp packages matching the current Linux CPU and libc.
 * @dependencies node:fs/promises, node:path, Node.js process report
 * @index_tags nextjs,standalone,docker,source-map,sharp,musl
 * @author holic512
 */
import { access, readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const supportedSharpArchitectures = new Set(['arm64', 'x64'])
const sharpRuntimePackagePattern = /^sharp(?:-libvips)?-/

async function pathSize(path) {
  const metadata = await stat(path)
  if (!metadata.isDirectory()) return metadata.size

  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(
    entries.map((entry) => pathSize(resolve(path, entry.name))),
  )
  return sizes.reduce((total, size) => total + size, 0)
}

export async function removeSourceMaps(root) {
  let bytes = 0
  let files = 0

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(path)
          return
        }
        if (!entry.isFile() || !entry.name.endsWith('.map')) return

        const metadata = await stat(path)
        bytes += metadata.size
        files += 1
        await rm(path, { force: true })
      }),
    )
  }

  await visit(root)
  return { bytes, files }
}

export async function detectLinuxLibc({
  platform = process.platform,
  report = process.report,
} = {}) {
  if (platform !== 'linux') return 'unknown'

  try {
    await access('/etc/alpine-release')
    return 'musl'
  } catch {
    const runtimeReport = report?.getReport?.()
    return runtimeReport?.header?.glibcVersionRuntime ? 'glibc' : 'unknown'
  }
}

export async function pruneSharpRuntimePackages(
  standaloneRoot,
  {
    platform = process.platform,
    architecture = process.arch,
    libc,
  } = {},
) {
  const runtimeLibc = libc ?? await detectLinuxLibc({ platform })
  if (
    platform !== 'linux' ||
    runtimeLibc !== 'musl' ||
    !supportedSharpArchitectures.has(architecture)
  ) {
    return { bytes: 0, packages: [] }
  }

  const imagePackagesRoot = resolve(standaloneRoot, 'node_modules', '@img')
  try {
    await access(imagePackagesRoot)
  } catch {
    return { bytes: 0, packages: [] }
  }

  const retainedPackages = new Set([
    `sharp-linuxmusl-${architecture}`,
    `sharp-libvips-linuxmusl-${architecture}`,
  ])
  const entries = await readdir(imagePackagesRoot, { withFileTypes: true })
  const removable = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      sharpRuntimePackagePattern.test(entry.name) &&
      !retainedPackages.has(entry.name),
  )

  let bytes = 0
  for (const entry of removable) {
    const path = resolve(imagePackagesRoot, entry.name)
    bytes += await pathSize(path)
    await rm(path, { recursive: true, force: true })
  }

  return {
    bytes,
    packages: removable.map((entry) => entry.name).sort(),
  }
}

export function formatBinaryBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
