'use client';
import { useMutation, useQuery, useQueryClient, keepPreviousData, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { EndpointBody, EndpointKey, EndpointQuery } from '@contracts/realestate-api';
import { api, type ApiResult } from './api';
import { ApiError } from '../api-error';

type QOpts<K extends EndpointKey> = Omit<UseQueryOptions<ApiResult<K>, ApiError>, 'queryKey' | 'queryFn'> & { poll?: number };

export function useApi<K extends EndpointKey>(key: K, query?: EndpointQuery<K>, opts: QOpts<K> = {}) {
  const { poll, ...rest } = opts;
  return useQuery<ApiResult<K>, ApiError>({
    queryKey: [key, query ?? {}],
    queryFn: () => api(key, { query } as never),
    placeholderData: keepPreviousData,
    refetchInterval: poll,
    staleTime: 10_000,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status < 500),
    ...rest,
  });
}

/** After any change, everything that reads lead / agent / listing / cost data is refreshed. */
const NEVER_STALE: EndpointKey[] = ['config', 'errors'];

export function useAction<K extends EndpointKey>(key: K, opts: { success?: (r: ApiResult<K>) => string | undefined; onDone?: (r: ApiResult<K>) => void; silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<ApiResult<K>, ApiError, EndpointBody<K>>({
    mutationFn: (body) => api(key, { body } as never),
    onSuccess: (r) => {
      qc.invalidateQueries({ predicate: (q) => !NEVER_STALE.includes(q.queryKey[0] as EndpointKey) });
      const msg = opts.success?.(r) ?? (r.data as { message?: string })?.message;
      if (msg && !opts.silent) toast.success(msg);
      opts.onDone?.(r);
    },
    onError: (e) => {
      if (!opts.silent) toast.error(e.message);
    },
  });
}
