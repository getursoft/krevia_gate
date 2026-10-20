import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/home', '/dashboard', '/resident', '/profile', '/settings', '/society', '/admin', '/guard'];

/**
 * Fast redirect for visitors without a session cookie. The cookie is then
 * verified against the API in the (app) layout on every protected render —
 * this check alone is never treated as authentication.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !req.cookies.has('krevia_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/home', '/dashboard/:path*', '/resident/:path*', '/profile/:path*', '/settings/:path*', '/society/:path*', '/admin/:path*', '/guard/:path*'],
};
