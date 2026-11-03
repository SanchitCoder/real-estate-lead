import { NextResponse } from 'next/server';
import { DATA_MODE } from '@/lib/env';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ status: 'error', message: 'Not signed in', code: 'unauthenticated' }, { status: 401 });
  return NextResponse.json({ status: 'ok', data: { ...s, mode: DATA_MODE } });
}
