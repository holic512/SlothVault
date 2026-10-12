/**
 * @file files-import.ts
 * @project SlothVault
 * @module Backup Entry Extraction
 * @description Extracts validated ZIP entries into a private staging directory.
 * @logic Stream regular files and verify declared lengths and CRC before any live file switch.
 * @dependencies Node filesystem and streams, ZIP validation, contained path checks
 * @index_tags backup,staging,crc,integrity
 * @author holic512
 */
import 'server-only'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { HttpError } from '@/server/http/errors'
import { resolveWithin } from './files-common'
import { isFileSystemFailure, updateCrc32, type ValidatedZipEntry } from './zip-validation'

export async function extractZipToStaging(entries: ValidatedZipEntry[], stagingDirectory: string) {
  let filesImported = 0

  for (const item of entries) {
    const targetPath = resolveWithin(stagingDirectory, ...item.segments)
    if (item.kind === 'directory') {
      await mkdir(targetPath, { recursive: true })
      continue
    }

    await mkdir(dirname(targetPath), { recursive: true })
    let entryBytes = 0
    let crc = 0xffffffff
    const limiter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        entryBytes += buffer.length
        if (entryBytes > item.declaredSize) {
          callback(new HttpError('ZIP entry size or checksum mismatch', 400, 400))
          return
        }
        crc = updateCrc32(crc, buffer)
        callback(null, buffer)
      },
    })

    try {
      await pipeline(
        item.entry.stream(),
        limiter,
        createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
      )
    } catch (error) {
      if (error instanceof HttpError || isFileSystemFailure(error)) throw error
      throw new HttpError('Invalid or corrupted ZIP archive', 400, 400)
    }

    const checksum = (crc ^ 0xffffffff) >>> 0
    if (entryBytes !== item.declaredSize || checksum !== (item.entry.crc32 >>> 0)) {
      throw new HttpError('ZIP entry size or checksum mismatch', 400, 400)
    }
    filesImported += 1
  }
  return filesImported
}
