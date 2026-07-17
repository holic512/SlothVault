import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: [
    '@prisma/adapter-pg',
    '@solana/spl-account-compression',
    '@solana/web3.js',
    'archiver',
    'argon2',
    'sharp',
    'unzipper',
  ],
  outputFileTracingIncludes: {
    '/*': ['generated/prisma/**/*'],
  },
}

export default withNextIntl(nextConfig)
