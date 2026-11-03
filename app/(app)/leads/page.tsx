'use client';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Plus, Repeat, Search } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SCORES, SOURCES, STAGES, type Lead, type LeadsQuery } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useOverlays } from '@/components/app/overlays';
import { EmptyState, ErrorState, PageHeader, PhoneReveal, ScoreChip, SlaPill, SourceBadge, StageBadge } from '@/components/app/shared';
import { api } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { useUrlState } from '@/lib/client/url-state';
import { leadsToCsv } from '@/lib/csv';
import { SCORE_LABEL, SOURCE_LABEL, STAGE_LABEL, TIMELINE_LABEL, PROPERTY_LABEL, budgetRange, istTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

type View = { id: string; label: string; params: Record<string, string>; owner?: boolean; agent?: boolean };
const VIEWS: View[] = [
  { id: 'all', label: 'All leads', params: {} },
  { id: 'hot-untouched', label: 'Hot & untouched', params: { score: 'hot', untouched: 'true' } },
  { id: 'attention', label: 'Needs attention', params: { stale: 'true' } },
  { id: 'breaching', label: 'Breaching SLA', params: { breaching: 'true' } },
  { id: 'visits', label: 'Site visits this week', params: { visits_this_week: 'true', stage: 'site_visit_booked' }, },
];
const FILTER_KEYS = ['source', 'score', 'stage', 'agent_id', 'stale', 'untouched', 'breaching', 'visits_this_week', 'search', 'include_test', 'window'] as const;

function LeadFeed() {
  const { data: me } = useSession();
  const { get, set, replaceAll } = useUrlState();
  const { openLead, openAddLead } = useOverlays();
  const owner = me?.role === 'owner';
  const agents = useApi('agents', {}, { enabled: owner });
  const [searchText, setSearchText] = useState(get('search') ?? '');
  useEffect(() => { const t = setTimeout(() => { if ((get('search') ?? '') !== searchText.trim()) set({ search: searchText.trim() || undefined }); }, 350); return () => clearTimeout(t); });

  const view = get('view') ?? 'all';
  const page = Number(get('page') ?? 1);
  const sort = (get('sort') as LeadsQuery['sort']) ?? 'created_desc';
  const win = get('window');
  const from = win ? new Date(Date.now() + 5.5 * 3600000 - Number(win) * 86400000).toISOString().slice(0, 10) : undefined;

  const query: LeadsQuery = useMemo(() => ({
    source: get('source') as LeadsQuery['source'], score: get('score') as LeadsQuery['score'], stage: get('stage') as LeadsQuery['stage'],
    agent_id: get('agent_id') ? Number(get('agent_id')) : undefined, stale: get('stale') as LeadsQuery['stale'], untouched: get('untouched') as LeadsQuery['untouched'],
    breaching: get('breaching') as LeadsQuery['breaching'], visits_this_week: get('visits_this_week') as LeadsQuery['visits_this_week'],
    search: get('search'), include_test: get('include_test') as LeadsQuery['include_test'], from, page, page_size: 25, sort,
  }), [get, from, page, sort]);
  const q = useApi('leads', query, { poll: 30_000 });
  const rows = q.data?.data ?? [];
  const total = q.data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));
  const [exporting, setExporting] = useState(false);

  const applyView = (v: View) => replaceAll({ view: v.id === 'all' ? undefined : v.id, ...v.params });
  const filtersActive = FILTER_KEYS.some((k) => get(k)) && view === 'all';

  async function exportCsv() {
    setExporting(true);
    try {
      const all: Lead[] = [];
      for (let p = 1; p <= 40; p++) {
        const r = await api('leads', { query: { ...query, page: p, page_size: 200 } });
        all.push(...r.data);
        if (all.length >= (r.meta?.total ?? 0)) break;
      }
      const blob = new Blob([leadsToCsv(all)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${all.length} lead${all.length === 1 ? '' : 's'}.`);
    } catch (e) { toast.error((e as Error).message); } finally { setExporting(false); }
  }

  const sortBtn = useCallback((label: string, asc: LeadsQuery['sort'], desc: LeadsQuery['sort']) => {
    const active = sort === asc || sort === desc;
    return (
      <button className="inline-flex items-center gap-1 font-medium hover:text-ink" onClick={() => set({ sort: sort === desc ? (asc as string) : (desc as string) }, { keepPage: false })} aria-label={`Sort by ${label}`}>
        {label}{active && (sort === desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
      </button>
    );
  }, [sort, set]);

  const columns = useMemo<ColumnDef<Lead>[]>(() => [
    { id: 'time', header: () => sortBtn('Came in', 'created_asc', 'created_desc'), cell: ({ row }) => <div className="whitespace-nowrap"><p className="text-[14px] font-medium">{timeAgo(row.original.created_at)}</p><p className="text-xs text-muted">{istTime(row.original.created_at)}</p></div> },
    { id: 'name', header: 'Buyer', cell: ({ row }) => { const l = row.original; return (
      <div className="min-w-[150px]"><p className="flex items-center gap-1.5 font-medium">{l.name ?? 'Unnamed'} {l.repeat_count > 0 && <Badge tone="warn" title={`Enquired ${l.repeat_count + 1} times`}><Repeat className="size-3" />{l.repeat_count + 1}×</Badge>}{l.is_test && <Badge tone="outline">Test</Badge>}</p><PhoneReveal phone={l.phone} className="text-xs text-muted" /></div>); } },
    { id: 'source', header: 'Source', cell: ({ row }) => <SourceBadge source={row.original.source} /> },
    { id: 'score', header: () => sortBtn('Score', 'score_desc', 'score_desc'), cell: ({ row }) => <ScoreChip score={row.original.score} reason={row.original.score_reason} /> },
    { id: 'budget', header: 'Budget', cell: ({ row }) => <span className="tnum whitespace-nowrap text-[14px]">{budgetRange(row.original.budget_min, row.original.budget_max)}</span> },
    { id: 'where', header: 'Looking for', cell: ({ row }) => { const l = row.original; return <div className="min-w-[130px] text-[14px]"><p>{l.location_pref ?? '—'}</p><p className="text-xs text-muted">{[l.bhk ? `${l.bhk} BHK` : '', l.property_type ? PROPERTY_LABEL[l.property_type] : ''].filter(Boolean).join(' ') || TIMELINE_LABEL[l.timeline]}</p></div>; } },
    { id: 'agent', header: 'Agent', cell: ({ row }) => <span className="whitespace-nowrap text-[14px]">{row.original.assigned_agent_name ?? <span className="text-muted">Unassigned</span>}</span> },
    { id: 'stage', header: 'Stage', cell: ({ row }) => <StageBadge stage={row.original.stage} /> },
    { id: 'resp', header: () => sortBtn('First reply', 'response_desc', 'response_desc'), cell: ({ row }) => <SlaPill responseMin={row.original.minutes_to_first_response} sinceCreatedMin={row.original.minutes_since_created} /> },
    { id: 'last', header: () => sortBtn('Last activity', 'last_activity_desc', 'last_activity_desc'), cell: ({ row }) => <span className="whitespace-nowrap text-[13px] text-muted">{timeAgo(row.original.last_activity_at)}</span> },
  ], [sortBtn]);
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true });

  const agentOptions = agents.data?.data ?? [];
  return (
    <>
      <PageHeader
        title={owner ? 'Live lead feed' : 'My leads'}
        subtitle="Every enquiry the moment it lands. Refreshes by itself every 30 seconds."
        actions={<><Button variant="outline" onClick={exportCsv} loading={exporting}><Download className="size-4" /> Export CSV</Button><Button onClick={openAddLead}><Plus className="size-4" /> Add lead</Button></>}
      />

      <div role="tablist" aria-label="Saved views" className="scroll-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => applyView(v)} className={cn('h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition', view === v.id ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2')}>{v.label}</button>
        ))}
      </div>

      <Card className="mb-4 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="relative col-span-2 sm:col-span-3 lg:col-span-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Name, phone, area or lead no." className="pl-10" aria-label="Search leads" />
          </div>
          <Select aria-label="Source" value={get('source') ?? ''} onChange={(e) => set({ source: e.target.value || undefined, view: undefined })}><option value="">All sources</option>{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select>
          <Select aria-label="Score" value={get('score') ?? ''} onChange={(e) => set({ score: e.target.value || undefined, view: undefined })}><option value="">Any score</option>{SCORES.map((s) => <option key={s} value={s}>{SCORE_LABEL[s]}</option>)}</Select>
          <Select aria-label="Stage" value={get('stage') ?? ''} onChange={(e) => set({ stage: e.target.value || undefined, view: undefined })}><option value="">Any stage</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
          {owner ? (
            <Select aria-label="Agent" value={get('agent_id') ?? ''} onChange={(e) => set({ agent_id: e.target.value || undefined })}><option value="">All agents</option>{agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? '' : ' (inactive)'}</option>)}</Select>
          ) : (
            <Select aria-label="Came in" value={win ?? ''} onChange={(e) => set({ window: e.target.value || undefined })}><option value="">Any time</option><option value="0">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            {owner && <label className="flex items-center gap-2 text-ink-2"><Select aria-label="Came in" value={win ?? ''} onChange={(e) => set({ window: e.target.value || undefined })} className="h-9 w-auto py-0 text-sm"><option value="">Any time</option><option value="0">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select></label>}
            <label className="flex items-center gap-2 text-ink-2"><Switch checked={get('include_test') === 'true'} onCheckedChange={(c) => set({ include_test: c ? 'true' : undefined })} aria-label="Show test records" /> Show test records</label>
          </div>
          <div className="flex items-center gap-3 text-muted">
            <span className="tnum">{q.isLoading ? 'Loading…' : `${total} lead${total === 1 ? '' : 's'}`}</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn('size-2 rounded-full bg-good', q.isFetching && 'animate-pulse')} aria-hidden />{q.isFetching ? 'Updating' : 'Live'}</span>
            {(filtersActive || view !== 'all') && <button className="font-medium text-brand hover:underline" onClick={() => { setSearchText(''); replaceAll({}); }}>Clear filters</button>}
          </div>
        </div>
      </Card>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <Card className="overflow-hidden">
          {/* desktop table */}
          <div className="scroll-thin hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-left">
              <thead className="border-b border-line bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                {table.getHeaderGroups().map((hg) => <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} scope="col" className="px-4 py-3 font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>)}
              </thead>
              <tbody>
                {q.isLoading && Array.from({ length: 8 }).map((_, i) => <tr key={i} className="border-b border-line"><td colSpan={columns.length} className="px-4 py-3"><Skeleton className="h-10" /></td></tr>)}
                {table.getRowModel().rows.map((r) => (
                  <tr key={r.id} tabIndex={0} onClick={() => openLead(r.original.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openLead(r.original.id))} className={cn('cursor-pointer border-b border-line transition hover:bg-surface-2 focus-visible:bg-surface-2', r.original.is_stale && 'bg-[color-mix(in_oklab,var(--bad)_5%,transparent)]')}>
                    {r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3 align-middle" onClick={c.column.id === 'name' ? (e) => { if ((e.target as HTMLElement).closest('button')) e.stopPropagation(); } : undefined}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* phone cards */}
          <ul className="divide-y divide-line md:hidden">
            {q.isLoading && Array.from({ length: 5 }).map((_, i) => <li key={i} className="p-4"><Skeleton className="h-20" /></li>)}
            {rows.map((l) => (
              <li key={l.id}>
                <button onClick={() => openLead(l.id)} className={cn('block w-full space-y-2 p-4 text-left', l.is_stale && 'bg-[color-mix(in_oklab,var(--bad)_5%,transparent)]')}>
                  <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-[16px] font-medium">{l.name ?? 'Unnamed'}{l.repeat_count > 0 && <span className="ml-1.5 text-xs text-warn">↻ {l.repeat_count + 1}×</span>}</span><span className="text-xs text-muted">{timeAgo(l.created_at)} · {l.location_pref ?? 'No area'} · {budgetRange(l.budget_min, l.budget_max)}</span></span><ScoreChip score={l.score} /></span>
                  <span className="flex flex-wrap items-center gap-2"><SourceBadge source={l.source} /><StageBadge stage={l.stage} /><SlaPill responseMin={l.minutes_to_first_response} sinceCreatedMin={l.minutes_since_created} /></span>
                  <span className="block text-xs text-muted">{l.assigned_agent_name ?? 'Unassigned'} · active {timeAgo(l.last_activity_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          {!q.isLoading && rows.length === 0 && <EmptyState title="No leads match" body="Try removing a filter or searching for something else." action={<Button variant="outline" onClick={() => { setSearchText(''); replaceAll({}); }}>Clear filters</Button>} />}
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="tnum text-muted">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><ChevronLeft className="size-4" /> Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next <ChevronRight className="size-4" /></Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
export default function Page() { return <Suspense><LeadFeed /></Suspense>; }
