import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ADMIN_PATHS = new Set([
  '/admin',
  '/admin/auth/login',
  '/admin/auth/init'
])

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  if (pathname === '/admin') {
    return NextResponse.redirect(new URL('/admin/auth/login', request.url))
  }

  if (PUBLIC_ADMIN_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const session = request.cookies.get('sv_session')?.value
  if (!session) {
    return NextResponse.redirect(new URL('/admin/auth/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*']
}
