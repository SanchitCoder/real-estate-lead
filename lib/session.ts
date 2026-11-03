import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { Actor } from './api-error';

export const COOKIE = 're_session';
export type Session = { role: 'owner'; name: string } | { role: 'agent'; name: string; agentId: number };

const secretKey = () => {
  const s = process.env.SESSION_SECRET ?? '';
  if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters. Set it in .env.local.');
  return new TextEncoder().encode(s);
};

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('12h').sign(secretKey());
}
export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.role === 'owner') return { role: 'owner', name: String(payload.name ?? 'Owner') };
    if (payload.role === 'agent' && typeof payload.agentId === 'number') return { role: 'agent', name: String(payload.name ?? 'Agent'), agentId: payload.agentId };
    return null;
  } catch {
    return null;
  }
}
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(COOKIE)?.value);
}
export const toActor = (s: Session): Actor => (s.role === 'owner' ? { role: 'owner' } : { role: 'agent', agentId: s.agentId, name: s.name });
/** `secure` follows the real protocol, so plain http://localhost still works while production over https is protected. */
export const cookieOptions = (req: Request) => {
  const https = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure: https, path: '/', maxAge: 60 * 60 * 12 };
};
