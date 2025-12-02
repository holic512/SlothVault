export type ApiResponse<T = any> = {
  code: number
  message: string
  data: T
}

export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, message, data }
}

export function fail(message: string, code = 1, data: any = null): ApiResponse<any> {
  return { code, message, data }
}
