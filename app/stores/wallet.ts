import { defineStore } from 'pinia'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

interface WalletState {
  connected: boolean
  publicKey: string | null
  balance: number // lamports
  connecting: boolean
  loadingBalance: boolean
  _manualDisconnect: boolean // 标记是否为手动断开
}

// 非响应式存储，避免序列化问题
let _wallet: any = null
let _boundHandlers: {
  accountChanged: ((pk: PublicKey | null) => void) | null
  disconnect: (() => void) | null
} = {
  accountChanged: null,
  disconnect: null,
}

export const useWalletStore = defineStore('wallet', {
  state: (): WalletState => ({
    connected: false,
    publicKey: null,
    balance: 0,
    connecting: false,
    loadingBalance: false,
    _manualDisconnect: false,
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
      this._manualDisconnect = false
      try {
        const response = await solana.connect()
        _wallet = solana
        this.publicKey = response.publicKey.toString()
        this.connected = true

        // 获取余额
        await this.fetchBalance()

        // 绑定事件处理器（保存引用以便后续移除）
        _boundHandlers.accountChanged = (pk: PublicKey | null) => {
          this.handleAccountChanged(pk)
        }
        _boundHandlers.disconnect = () => {
          this.handleDisconnect()
        }

        // 监听账户变化
        solana.on('accountChanged', _boundHandlers.accountChanged)
        solana.on('disconnect', _boundHandlers.disconnect)
      } finally {
        this.connecting = false
      }
    },

    // 断开连接
    async disconnect() {
      this._manualDisconnect = true

      // 先移除事件监听器
      this.removeEventListeners()

      if (_wallet) {
        try {
          await _wallet.disconnect()
        } catch (err) {
          // 忽略断开连接时的错误
          console.warn('断开钱包时出错:', err)
        }
      }
      this.reset()
    },

    // 移除事件监听器
    removeEventListeners() {
      if (_wallet) {
        if (_boundHandlers.accountChanged) {
          _wallet.off?.('accountChanged', _boundHandlers.accountChanged)
        }
        if (_boundHandlers.disconnect) {
          _wallet.off?.('disconnect', _boundHandlers.disconnect)
        }
      }
      _boundHandlers.accountChanged = null
      _boundHandlers.disconnect = null
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
      this.removeEventListeners()
      this.reset()
    },

    // 重置状态
    reset() {
      this.connected = false
      this.publicKey = null
      this.balance = 0
      _wallet = null
    },

    // 检查是否已连接（页面加载时）
    async checkConnection() {
      if (typeof window === 'undefined') return

      // 如果是手动断开的，不自动重连
      if (this._manualDisconnect) {
        return
      }

      const solana = (window as any).solana
      if (solana?.isPhantom && solana.isConnected && solana.publicKey) {
        _wallet = solana
        this.publicKey = solana.publicKey.toString()
        this.connected = true

        // 绑定事件处理器
        _boundHandlers.accountChanged = (pk: PublicKey | null) => {
          this.handleAccountChanged(pk)
        }
        _boundHandlers.disconnect = () => {
          this.handleDisconnect()
        }

        solana.on('accountChanged', _boundHandlers.accountChanged)
        solana.on('disconnect', _boundHandlers.disconnect)

        await this.fetchBalance()
      }
    },
  },

  persist: {
    pick: ['_manualDisconnect'], // 持久化手动断开标记
  },
})
