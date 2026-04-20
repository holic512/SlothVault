'use client'

import { Button } from 'antd'
import { useEffect } from 'react'

import { useWalletStore } from '@/store/wallet'

export function WalletConnector() {
  const wallet = useWalletStore()

  useEffect(() => {
    void wallet.checkConnection()
  }, [wallet])

  if (wallet.connected) {
    return (
      <Button size="small" onClick={() => void wallet.disconnect()}>
        {wallet.shortAddress()}
      </Button>
    )
  }

  return (
    <Button size="small" type="primary" onClick={() => void wallet.connect()}>
      Connect Wallet
    </Button>
  )
}
