import { ApiError } from '../api-error';
import { serverEnv } from '../env';
import type { Actor } from '../api-error';

/** Calls one n8n webhook with Header Auth. Runs on the server only. */
export async function callN8n(method: 'GET' | 'POST', path: string, query: URLSearchParams, body: unknown, actor: Actor): Promise<unknown> {
  const env = serverEnv();
  if (!env.baseUrl) throw new ApiError(500, 'N8N_BASE_URL is not set. Add it to .env.local or switch NEXT_PUBLIC_DATA_MODE back to mock.', { code: 'not_configured' });
  const qs = query.toString();
  const url = `${env.baseUrl}/${env.webhookMode}/re/${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    [env.authHeaderName]: env.authValue,
    'X-RE-Actor-Role': actor.role,
    Accept: 'application/json',
  };
  if (actor.role === 'agent') headers['X-RE-Actor-Agent-Id'] = String(actor.agentId);
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined, cache: 'no-store', signal: AbortSignal.timeout(25000) });
  } catch {
    throw new ApiError(504, 'The automation server did not answer in time. Try again in a moment.', { code: 'upstream_unreachable', endpoint: path });
  }
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : null; } catch { throw new ApiError(502, `The automation server returned something that is not JSON (HTTP ${res.status}).`, { code: 'upstream_not_json', endpoint: path }); }
  if (!res.ok) {
    const m = (json as { message?: string } | null)?.message;
    throw new ApiError(res.status === 404 ? 502 : res.status, m ?? `The automation server returned an error (HTTP ${res.status}).`, { code: res.status === 404 ? 'webhook_not_found' : 'upstream_error', endpoint: path });
  }
  return json;
}
