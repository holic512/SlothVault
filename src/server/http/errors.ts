export class HttpError extends Error {
  readonly status: number
  readonly code: number
  readonly data: unknown

  constructor(message: string, status = 500, code = status, data: unknown = null) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.data = data
  }
}
