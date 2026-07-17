export type ApiResponse<T = unknown> = {
  code: number
  message: string
  data: T
}

export type Nullable<T> = T | null
