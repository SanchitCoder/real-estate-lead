'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/** Filters live in the URL so a view can be bookmarked and the back button works. */
export function useUrlState() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const get = (k: string) => sp.get(k) ?? undefined;
  const set = useCallback(
    (patch: Record<string, string | undefined>, opts: { keepPage?: boolean } = {}) => {
      const n = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') n.delete(k); else n.set(k, v); }
      if (!opts.keepPage && !('page' in patch)) n.delete('page');
      router.replace(`${path}${n.toString() ? `?${n}` : ''}`, { scroll: false });
    },
    [sp, router, path],
  );
  const replaceAll = useCallback((next: Record<string, string | undefined>) => {
    const n = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) n.set(k, v);
    router.replace(`${path}${n.toString() ? `?${n}` : ''}`, { scroll: false });
  }, [router, path]);
  return { get, set, replaceAll, params: sp };
}
