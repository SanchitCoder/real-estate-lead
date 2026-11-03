'use client';
import * as D from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Building2, Search, UserRound, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { PROPERTY_LABEL, SOURCE_LABEL, STAGE_LABEL, inrShort } from '@/lib/format';
import { useOverlays } from './overlays';

/** ⌘K: jump to a lead, a listing or an agent. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const router = useRouter();
  const { openLead } = useOverlays();
  const { data: me } = useSession();
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 220); return () => clearTimeout(t); }, [text]);
  useEffect(() => { if (!open) setText(''); }, [open]);

  const leads = useApi('leads', { search: debounced, page_size: 6 }, { enabled: open && debounced.length >= 2 });
  const listings = useApi('listings', {}, { enabled: open });
  const agents = useApi('agents', {}, { enabled: open && me?.role === 'owner' });
  const q = text.trim().toLowerCase();
  const lst = (listings.data?.data ?? []).filter((l) => q && `${l.title} ${l.project} ${l.location}`.toLowerCase().includes(q)).slice(0, 5);
  const ags = (agents.data?.data ?? []).filter((a) => q && a.name.toLowerCase().includes(q)).slice(0, 4);

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[2px]" />
        <D.Content className="fixed left-1/2 top-[12vh] z-[81] w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search leads, listings and agents</D.Description>
          <Command shouldFilter={false} label="Search">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-5 text-muted" aria-hidden />
              <Command.Input value={text} onValueChange={setText} placeholder="Search a name, phone, listing or agent…" className="h-14 w-full bg-transparent text-base text-ink outline-none placeholder:text-muted" />
              <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted sm:block">esc</kbd>
            </div>
            <Command.List className="scroll-thin max-h-[56vh] overflow-y-auto p-2">
              {q.length < 2 && <p className="px-3 py-6 text-center text-sm text-muted">Type at least two letters.</p>}
              {q.length >= 2 && !leads.isFetching && !(leads.data?.data.length || lst.length || ags.length) && <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches for “{text}”.</Command.Empty>}
              {!!leads.data?.data.length && q.length >= 2 && (
                <Command.Group heading="Leads" className="px-1 text-xs font-medium text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {leads.data.data.map((l) => (
                    <Command.Item key={`l${l.id}`} value={`lead-${l.id}`} onSelect={() => { onOpenChange(false); openLead(l.id); }} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink aria-selected:bg-surface-2">
                      <UserRound className="size-4 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{l.name ?? 'Unnamed lead'} <span className="text-muted">· {SOURCE_LABEL[l.source]} · {STAGE_LABEL[l.stage]}</span></span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!lst.length && (
                <Command.Group heading="Listings" className="px-1 text-xs font-medium text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {lst.map((l) => (
                    <Command.Item key={`s${l.id}`} value={`listing-${l.id}`} onSelect={() => { onOpenChange(false); router.push(`/inventory?id=${l.id}`); }} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink aria-selected:bg-surface-2">
                      <Building2 className="size-4 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{l.title} <span className="text-muted">· {l.location} · {PROPERTY_LABEL[l.property_type]} · {inrShort(l.price)}</span></span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!ags.length && (
                <Command.Group heading="Agents" className="px-1 text-xs font-medium text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {ags.map((a) => (
                    <Command.Item key={`a${a.id}`} value={`agent-${a.id}`} onSelect={() => { onOpenChange(false); router.push('/agents'); }} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink aria-selected:bg-surface-2">
                      <Users className="size-4 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{a.name} <span className="text-muted">· {a.open_leads} open leads{a.active ? '' : ' · inactive'}</span></span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
