/**
 * @file next.config.ts
 * @project SlothVault
 * @module Next.js production configuration
 * @description Builds the standalone application with provider clients, migrations, native database adapters, and the fixed plugin worker/source compiler available at runtime.
 * @logic Externalize native packages and explicitly trace the fixed Prisma and plugin runtime assets used by the web installer.
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
    'rollup', 'typescript', '@rollup/plugin-node-resolve', '@rollup/plugin-commonjs',
    'better-sqlite3',
    '@prisma/adapter-better-sqlite3',
    '@prisma/adapter-mariadb',
    '@prisma/adapter-pg',
    '@solana/web3.js',
    'archiver',
    'argon2',
    'sharp',
    'unzipper',
  ],
  outputFileTracingIncludes: {
    '/*': [
      'generated/plugin-runtime/**/*',
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
      'scripts/telemetry-worker.mjs',
      'scripts/telemetry-store.mjs',
      'node_modules/better-sqlite3/**/*',
      'node_modules/bindings/**/*',
      'node_modules/file-uri-to-path/**/*',
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
    ],
  },
}

export default withNextIntl(nextConfig)
