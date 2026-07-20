/**
 * @file proxy.ts
 * @project SlothVault
 * @module Installation Gate
 * @description Redirects browser page requests to installation or maintenance before the selected database is available.
 * @logic Read the encrypted bootstrap state in the Node.js proxy runtime, keep assets and APIs untouched, and prevent installed or broken instances from reopening the installer.
 * @dependencies next/server, database/installation-state
 * @index_tags next-proxy,installer,redirect,maintenance
 * @author holic512
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const installation = await readRuntimeInstallationPublicStatus()

  if (installation.status === 'MAINTENANCE') {
    if (pathname === '/maintenance') return NextResponse.next()
    return NextResponse.redirect(new URL('/maintenance', request.url))
  }

  if (installation.status !== 'INSTALLED') {
    if (pathname === '/install') return NextResponse.next()
    return NextResponse.redirect(new URL('/install', request.url))
  }

  if (pathname === '/install' || pathname === '/maintenance') {
    return NextResponse.redirect(new URL('/admin/auth/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.png|robots.txt|uploads).*)'],
}
