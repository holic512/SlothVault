'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App, ConfigProvider } from 'antd'
import { PropsWithChildren, useEffect, useState } from 'react'

type Props = PropsWithChildren<{
  locale: string
}>

export function AppProviders({ children, locale }: Props) {
  const [queryClient] = useState(() => new QueryClient())

  useEffect(() => {
    void import('buffer').then(({ Buffer }) => {
      ;(window as any).Buffer = Buffer
      ;(globalThis as any).Buffer = Buffer
    })
  }, [])

  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: '"Public Sans", "Source Sans Pro", sans-serif'
        }
      }}
    >
      <App>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </App>
    </ConfigProvider>
  )
}
