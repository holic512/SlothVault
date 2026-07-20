/**
 * @file next.config.ts
 * @project SlothVault
 * @module Next.js production configuration
 * @description Builds the standalone application with all provider clients, migrations, and native database adapters available at runtime.
 * @logic Externalize native packages and explicitly trace the fixed multi-provider Prisma runtime assets used by the web installer.
 * @dependencies Next.js 16, next-intl, Prisma driver adapters
 * @index_tags nextjs, standalone, tracing, prisma, database
 * @author holic512
 */
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
    '@prisma/adapter-better-sqlite3',
    '@prisma/adapter-mariadb',
    '@prisma/adapter-pg',
    '@solana/spl-account-compression',
    '@solana/web3.js',
    'archiver',
    'argon2',
    'sharp',
    'unzipper',
  ],
  outputFileTracingIncludes: {
    '/*': [
      'generated/prisma-postgresql/**/*',
      'generated/prisma-mysql/**/*',
      'generated/prisma-sqlite/**/*',
      'prisma/providers/postgresql/schema.prisma',
      'prisma/providers/postgresql/migrations/**/*',
      'prisma/providers/mysql/schema.prisma',
      'prisma/providers/mysql/migrations/**/*',
      'prisma/providers/sqlite/schema.prisma',
      'prisma/providers/sqlite/migrations/**/*',
      'prisma.config.ts',
    ],
  },
  outputFileTracingExcludes: {
    '/*': [
      '.env*',
      '.git/**/*',
      'coverage/**/*',
      'data/**/*',
      'docker-data/**/*',
      'docs/**/*',
      'legacy-nuxt/**/*',
      'server/**/*',
      'generated/prisma/**/*',
      'prisma/migrations/**/*',
      'prisma/schema.prisma',
    ],
  },
}

export default withNextIntl(nextConfig)
