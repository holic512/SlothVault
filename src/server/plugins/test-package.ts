import { createHash } from 'node:crypto'
import { Writable } from 'node:stream'
import archiver from 'archiver'
import { Open } from 'unzipper'

/** Test-only publisher; repack to exercise actual integrity validation and workers. */
export async function editTestPackage(bytes: Buffer, edit: (files: Map<string, Buffer>) => void, rewriteHashes = true) {
  const zip = await Open.buffer(bytes)
  const files = new Map(await Promise.all(zip.files.filter(f => f.type === 'File' && f.path !== 'hashmanifest.json').map(async f => [f.path, await f.buffer()] as const)))
  edit(files)
  files.set('hashmanifest.json', rewriteHashes ? Buffer.from(JSON.stringify({ algorithm: 'sha256', files: Object.fromEntries([...files].map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) })) : await zip.files.find(file => file.path === 'hashmanifest.json')!.buffer())
  const chunks: Buffer[] = []
  const archive = archiver('zip', { zlib: { level: 6 } })
  const done = new Promise<Buffer>((resolve, reject) => {
    const sink = new Writable({ write(chunk, _encoding, next) { chunks.push(Buffer.from(chunk)); next() } })
    sink.on('finish', () => resolve(Buffer.concat(chunks))); sink.on('error', reject); archive.on('error', reject); archive.pipe(sink)
  })
  for (const [name, data] of files) archive.append(data, { name })
  await archive.finalize()
  return done
}
