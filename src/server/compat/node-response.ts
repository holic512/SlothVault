import { Writable } from 'stream'

export class NodeResponseCapture extends Writable {
  statusCode = 200
  private readonly headers = new Headers()
  private readonly chunks: Buffer[] = []
  finished = false

  override _write(
    chunk: string | Buffer | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  override end(...args: any[]): this {
    const [chunk, encoding, callback] = args
    if (chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    this.finished = true
    if (typeof encoding === 'function') {
      encoding()
    } else if (callback) {
      callback()
    }
    super.end()
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
  }

  getHeader(name: string) {
    return this.headers.get(name)
  }

  removeHeader(name: string) {
    this.headers.delete(name)
  }

  getHeaders() {
    return this.headers
  }

  getBody() {
    return Buffer.concat(this.chunks)
  }

  hasBody() {
    return this.chunks.length > 0
  }
}
