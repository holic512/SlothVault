import type { NextConfig } from 'next'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['antd', 'md-editor-rt'],
  serverExternalPackages: [
    '@solana/web3.js',
    '@solana/spl-account-compression',
    'jayson',
    'bn.js',
    'buffer',
    '@noble/curves',
    '@noble/hashes',
    'rpc-websockets',
    'superstruct',
    'borsh',
    'argon2',
    'sharp'
  ],
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(process.cwd(), 'src'),
      '~~': path.resolve(process.cwd()),
      h3: path.resolve(process.cwd(), 'src/server/compat/h3.ts')
    }
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      buffer: require.resolve('buffer/')
    }

    return config
  },
  async rewrites() {
    return []
  }
}

export default nextConfig
