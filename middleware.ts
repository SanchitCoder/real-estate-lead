import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC = ['/login', '/api/auth/login', '/api/auth/logout'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p) || pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();
  const token = req.cookies.get('re_session')?.value;
  let ok = false;
  if (token && (process.env.SESSION_SECRET ?? '').length >= 32) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET!));
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (ok) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ status: 'error', message: 'Please sign in again.', code: 'unauthenticated' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image|.*\\.(?:png|svg|ico|jpg|webp)$).*)'] };
