import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DATA_MODE, serverEnv } from '@/lib/env';
import { COOKIE, cookieOptions, signSession, type Session } from '@/lib/session';
import { getStore } from '@/lib/mock/store';
import { callN8n } from '@/lib/server/upstream';

const Body = z.object({ role: z.enum(['owner', 'agent']), password: z.string().min(1), phone: z.string().optional() });

/** timing-safe-ish compare for short secrets */
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ status: 'error', message: 'Enter your password.' }, { status: 400 });
  const env = serverEnv();
  const { role, password, phone } = parsed.data;
  if (env.sessionSecret.length < 32) return NextResponse.json({ status: 'error', message: 'SESSION_SECRET is missing or too short. See .env.example.' }, { status: 500 });

  let session: Session | null = null;
  if (role === 'owner') {
    if (env.ownerPassword && same(password, env.ownerPassword)) session = { role: 'owner', name: 'Owner' };
  } else {
    const d = (phone ?? '').replace(/\D/g, '').slice(-10);
    if (d.length === 10 && env.agentSeed) {
      // agent password = AGENT_LOGIN_SEED + last 4 digits of the agent's own phone
      if (same(password, env.agentSeed + d.slice(-4))) {
        let agents: { id: number; name: string; phone: string; active: boolean }[] = [];
        if (DATA_MODE === 'mock') agents = getStore().agents;
        else {
          const res = (await callN8n('GET', 'agents', new URLSearchParams(), null, { role: 'owner' }).catch(() => null)) as any;
          agents = res?.data ?? [];
        }
        const a = agents.find((x) => x.phone.replace(/\D/g, '').slice(-10) === d && x.active);
        if (a) session = { role: 'agent', name: a.name, agentId: Number(a.id) };
      }
    }
  }
  if (!session) return NextResponse.json({ status: 'error', message: 'That did not match. Check your details and try again.' }, { status: 401 });
  const res = NextResponse.json({ status: 'ok', data: { role: session.role, name: session.name } });
  res.cookies.set(COOKIE, await signSession(session), cookieOptions(req));
  return res;
}
