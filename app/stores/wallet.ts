import { defineStore } from 'pinia'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

interface WalletState {
  connected: boolean
  publicKey: string | null
  balance: number // lamports
  connecting: boolean
  loadingBalance: boolean
  wallet: any // Phantom wallet object
}

export const useWalletStore = defineStore('wallet', {
  state: (): WalletState => ({
    connected: false,
    publicKey: null,
    balance: 0,
    connecting: false,
    loadingBalance: false,
    wallet: null,
  }),

  getters: {
    // 格式化的公钥（缩短显示）
    shortAddress: (state): string => {
      if (!state.publicKey) return ''
      return `${state.publicKey.slice(0, 4)}...${state.publicKey.slice(-4)}`
    },
    // SOL 余额（转换为 SOL 单位）
    solBalance: (state): string => {
      return (state.balance / LAMPORTS_PER_SOL).toFixed(4)
    },
  },

  actions: {
    // 连接钱包
    async connect() {
      if (typeof window === 'undefined') return

      const solana = (window as any).solana
      if (!solana?.isPhantom) {
        throw new Error('请先安装 Phantom 钱包')
      }

      this.connecting = true
      try {
        const response = await solana.connect()
        this.wallet = solana
        this.publicKey = response.publicKey.toString()
        this.connected = true

        // 获取余额
        await this.fetchBalance()

        // 监听账户变化
        solana.on('accountChanged', this.handleAccountChanged)
        solana.on('disconnect', this.handleDisconnect)
      } finally {
        this.connecting = false
      }
    },

    // 断开连接
    async disconnect() {
      if (this.wallet) {
        await this.wallet.disconnect()
      }
      this.reset()
    },

    // 通过服务端 API 获取余额（绕过 CORS）
    async fetchBalance() {
      if (!this.publicKey) return

      this.loadingBalance = true
      try {
        const res = await $fetch<{ code: number; data: { balance: number } }>(
          `/api/solana/balance`,
          { query: { address: this.publicKey } }
        )
        if (res.code === 0) {
          this.balance = res.data.balance
        }
      } catch (err: any) {
        console.error('获取余额失败:', err.message)
      } finally {
        this.loadingBalance = false
      }
    },

    // 处理账户变化
    handleAccountChanged(publicKey: PublicKey | null | undefined) {
      if (publicKey) {
        this.publicKey = publicKey.toString()
        this.fetchBalance()
      } else {
        this.reset()
      }
    },

    // 处理断开连接
    handleDisconnect() {
      this.reset()
    },

    // 重置状态
    reset() {
      this.connected = false
      this.publicKey = null
      this.balance = 0
      this.wallet = null
    },

    // 检查是否已连接（页面加载时）
    async checkConnection() {
      if (typeof window === 'undefined') return

      const solana = (window as any).solana
      if (solana?.isPhantom && solana.isConnected) {
        this.wallet = solana
        this.publicKey = solana.publicKey?.toString() || null
        this.connected = !!this.publicKey
        if (this.connected) {
          await this.fetchBalance()
        }
      }
    },
  },

  persist: {
    pick: ['publicKey'], // 只持久化公钥，连接状态需要重新验证
  },
})
