'use client';
import { endpoints, type EndpointBody, type EndpointData, type EndpointKey, type EndpointQuery, type Meta } from '@contracts/realestate-api';
import { ApiError, ContractError } from '../api-error';

export interface ApiResult<K extends EndpointKey> { data: EndpointData<K>; meta?: Meta }

type Args<K extends EndpointKey> = { query?: EndpointQuery<K>; body?: EndpointBody<K> };

export async function api<K extends EndpointKey>(key: K, args: Args<K> = {}): Promise<ApiResult<K>> {
  const def = endpoints[key];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries((args.query ?? {}) as Record<string, unknown>)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  const res = await fetch(`/api/n8n/${def.path}${qs ? `?${qs}` : ''}`, {
    method: def.method,
    headers: def.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: def.method === 'POST' ? JSON.stringify(args.body ?? {}) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status === 'error') {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    if (json?.code === 'contract_mismatch') throw new ContractError(json.endpoint ?? key, json.issues ?? []);
    throw new ApiError(res.status, json?.message ?? 'Something went wrong. Please try again.', { code: json?.code, field: json?.field, endpoint: json?.endpoint });
  }
  return { data: json.data, meta: json.meta };
}
