import { NextResponse } from 'next/server';
import { COOKIE } from '@/lib/session';

export async function POST() {
  const res = NextResponse.json({ status: 'ok', data: null });
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
