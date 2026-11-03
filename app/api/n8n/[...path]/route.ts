import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { ErrorEnvelope, envelope, findEndpoint, type EndpointKey } from '@contracts/realestate-api';
import { ApiError, ContractError } from '@/lib/api-error';
import { DATA_MODE } from '@/lib/env';
import { getSession, toActor } from '@/lib/session';
import { callN8n } from '@/lib/server/upstream';
import { handleMock } from '@/lib/mock/handlers';

export const dynamic = 'force-dynamic';

const fail = (e: ApiError) =>
  NextResponse.json({ status: 'error', message: e.message, code: e.code, field: e.field, endpoint: e.endpoint, ...(e instanceof ContractError ? { issues: e.issues } : {}) }, { status: e.status });

const issuesOf = (z: ZodError) => z.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const session = await getSession();
    if (!session) throw new ApiError(401, 'Please sign in again.', { code: 'unauthenticated' });
    const actor = toActor(session);
    const { path } = await ctx.params;
    const p = path.join('/');

    // 1. allow-list
    const found = findEndpoint(req.method, p);
    if (!found) throw new ApiError(404, `"${req.method} ${p}" is not part of the dashboard API.`, { code: 'not_allowed' });
    const { key, def } = found as { key: EndpointKey; def: any };
    if (!def.roles.includes(session.role)) throw new ApiError(403, 'Your role does not have access to this.', { code: 'forbidden' });

    // 2. validate the request
    const query = new URLSearchParams(req.nextUrl.searchParams);
    let parsedQuery: any = {};
    if (def.query) {
      const r = def.query.safeParse(Object.fromEntries(query));
      if (!r.success) { const i = r.error.issues[0]; throw new ApiError(400, i.message, { code: 'bad_request', field: i.path.join('.') }); }
      parsedQuery = r.data;
    }
    let parsedBody: any = undefined;
    if (req.method === 'POST') {
      const raw = await req.json().catch(() => null);
      const r = def.body.safeParse(raw);
      if (!r.success) { const i = r.error.issues[0]; throw new ApiError(422, i.message, { code: 'validation', field: i.path.join('.') }); }
      parsedBody = r.data;
    }

    // 3. agents are limited to their own leads / stats, enforced here as well as in the backend
    if (actor.role === 'agent') {
      if (def.query && 'agent_id' in (def.query.shape ?? {})) { parsedQuery.agent_id = actor.agentId; query.set('agent_id', String(actor.agentId)); }
      if ((key === 'updateStage' || key === 'addNote') && DATA_MODE === 'live') {
        const detail = (await callN8n('GET', 'lead', new URLSearchParams({ id: String(parsedBody.lead_id) }), null, actor)) as any;
        if (detail?.data?.lead?.assigned_agent_id !== actor.agentId) throw new ApiError(403, 'This lead is assigned to a different agent.', { code: 'not_your_lead' });
      }
    }

    // 4. mock or live
    let raw: unknown;
    if (DATA_MODE === 'mock') {
      await new Promise((r) => setTimeout(r, 90 + Math.random() * 140));
      const out = handleMock(key, parsedQuery, parsedBody, actor);
      raw = { status: 'ok', data: out.data, meta: out.meta };
    } else {
      raw = await callN8n(def.method, def.path, query, parsedBody, actor);
      const err = ErrorEnvelope.safeParse(raw);
      if (err.success) throw new ApiError(422, err.data.message, { code: err.data.code, field: err.data.field });
    }

    // 5. validate the response against the contract (both modes: the mock must obey it too)
    const parsed = envelope(def.response).safeParse(raw);
    if (!parsed.success) throw new ContractError(`${def.method} /re/${def.path}`, issuesOf(parsed.error));
    return NextResponse.json(parsed.data, { headers: { 'Cache-Control': 'no-store', 'X-Data-Mode': DATA_MODE } });
  } catch (e) {
    if (e instanceof ApiError) return fail(e);
    console.error('[api/n8n]', e);
    return fail(new ApiError(500, 'Something went wrong on our side. Please try again.', { code: 'internal' }));
  }
}

export { handle as GET, handle as POST };
