'use client';
import { useQuery } from '@tanstack/react-query';

export interface Me { role: 'owner' | 'agent'; name: string; agentId?: number; mode: 'mock' | 'live' }
export function useSession() {
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: async () => {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!r.ok) throw new Error('unauthenticated');
      return (await r.json()).data;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
