import { describe, expect, it } from 'vitest'

import {
  compressedLayerBytes,
  formatMebibytes,
  inspectPlatformSizes,
} from './docker-image-size.mjs'

describe('Docker image size reporter', () => {
  it('totals compressed layers for the supported platform', async () => {
    const index = {
      manifests: [
        {
          digest: 'sha256:amd64',
          platform: { architecture: 'amd64', os: 'linux' },
        },
        {
          digest: 'sha256:arm64',
          platform: { architecture: 'arm64', os: 'linux' },
        },
        {
          digest: 'sha256:attestation',
          platform: { architecture: 'unknown', os: 'unknown' },
        },
      ],
    }
    const manifests = {
      'image@example@sha256:amd64': { layers: [{ size: 10 }, { size: 20 }] },
      'image@example@sha256:arm64': { layers: [{ size: 40 }] },
    }
    const inspectRaw = async (reference) =>
      JSON.stringify(reference === 'image@example' ? index : manifests[reference])

    await expect(inspectPlatformSizes('image@example', inspectRaw)).resolves.toEqual({
      'linux/amd64': { bytes: 30, digest: 'sha256:amd64', layers: 2 },
      'linux/arm64': { bytes: 40, digest: 'sha256:arm64', layers: 1 },
    })
  })

  it('reads a single-platform image manifest without an index', async () => {
    const manifest = {
      layers: [{ size: 10 }, { size: 20 }],
    }
    const inspectRaw = async () => JSON.stringify(manifest)

    await expect(
      inspectPlatformSizes('image@example@sha256:amd64', inspectRaw, {
        allowPartial: true,
        inspectConfig: async () => ({ os: 'linux', architecture: 'amd64' }),
      }),
    ).resolves.toEqual({
      'linux/amd64': { bytes: 30, digest: 'sha256:amd64', layers: 2 },
    })
  })

  it('rejects incomplete multi-platform indexes', async () => {
    const inspectRaw = async () => JSON.stringify({ manifests: [] })
    await expect(inspectPlatformSizes('image@example', inspectRaw)).rejects.toThrow(
      'Image index is missing linux/amd64',
    )
  })

  it('uses the repository reference when the index is addressed by digest', async () => {
    const references = []
    const inspectRaw = async (reference) => {
      references.push(reference)
      if (reference === 'registry.example/app@sha256:index') {
        return JSON.stringify({
          manifests: [
            {
              digest: 'sha256:amd64',
              platform: { architecture: 'amd64', os: 'linux' },
            },
            {
              digest: 'sha256:arm64',
              platform: { architecture: 'arm64', os: 'linux' },
            },
          ],
        })
      }
      return JSON.stringify({ layers: [] })
    }

    await inspectPlatformSizes('registry.example/app@sha256:index', inspectRaw)
    expect(references).toEqual([
      'registry.example/app@sha256:index',
      'registry.example/app@sha256:amd64',
      'registry.example/app@sha256:arm64',
    ])
  })

  it('formats byte counts as mebibytes', () => {
    expect(compressedLayerBytes({ layers: [{ size: 1048576 }, { size: 524288 }] }))
      .toBe(1572864)
    expect(formatMebibytes(1572864)).toBe('1.5')
  })

  it('allows an amd64-only historical index without losing its baseline', async () => {
    const inspect = async ref => JSON.stringify(ref === 'old-image' ? {
      manifests: [{ digest: 'sha256:old', platform: { os: 'linux', architecture: 'amd64' } }],
    } : { layers: [{ size: 123 }] })
    await expect(inspectPlatformSizes('old-image', inspect)).rejects.toThrow('linux/arm64')
    await expect(inspectPlatformSizes('old-image', inspect, { allowPartial: true })).resolves.toEqual({
      'linux/amd64': { bytes: 123, digest: 'sha256:old', layers: 1 },
    })
  })

  it('reads single ARM manifests from actual config and rejects missing or ambiguous platforms', async () => {
    const inspect = async () => JSON.stringify({ layers: [{ size: 50 }] })
    await expect(inspectPlatformSizes('arm@sha256:arm', inspect)).rejects.toThrow('config inspection')
    await expect(inspectPlatformSizes('arm@sha256:arm', inspect, {
      allowPartial: true, inspectConfig: async () => ({ os: 'linux', architecture: 'arm64' }),
    })).resolves.toEqual({ 'linux/arm64': { bytes: 50, digest: 'sha256:arm', layers: 1 } })
    await expect(inspectPlatformSizes('arm', inspect, {
      inspectConfig: async () => ({ os: 'linux', architecture: 'arm64' }),
    })).rejects.toThrow('missing required')
    const duplicate = async () => JSON.stringify({ manifests: [1, 2].map(() => ({
      digest: 'sha256:duplicate', platform: { os: 'linux', architecture: 'arm64' },
    })) })
    await expect(inspectPlatformSizes('duplicate', duplicate)).rejects.toThrow('duplicate')
  })
})
