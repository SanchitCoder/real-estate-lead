'use client';
import { LayoutGrid, MessageCircle, Pencil, Phone, Plus, Table2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ListingRequest, ListingStatus, PropertyType, type ListingActionResponse, type ListingWithCounts } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOverlays } from '@/components/app/overlays';
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/app/shared';
import { useAction, useApi } from '@/lib/client/hooks';
import { applyZodErrors, lakhToInr } from '@/lib/client/forms';
import { useSession } from '@/lib/client/session';
import { useUrlState } from '@/lib/client/url-state';
import { PROPERTY_LABEL, inrShort, telHref, timeAgo, waHref } from '@/lib/format';
import { LOCALITIES } from '@/lib/mock/localities';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = { open: 'Open', under_offer: 'Under offer', sold: 'Sold', withdrawn: 'Withdrawn' };

function MiniFunnel({ l }: { l: ListingWithCounts }) {
  const steps = [{ k: 'Matched', v: l.matched }, { k: 'Messaged', v: l.messaged }, { k: 'Interested', v: l.interested }];
  const max = Math.max(1, l.matched);
  return (
    <div className="space-y-1.5" role="group" aria-label="Buyer funnel">
      {steps.map((s, i) => (
        <div key={s.k} className="flex items-center gap-2 text-xs">
          <span className="w-[66px] text-muted">{s.k}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${(s.v / max) * 100}%`, background: i === 2 ? 'var(--good)' : 'var(--brand)', opacity: 1 - i * 0.18 }} /></span>
          <span className="tnum w-7 text-right font-medium">{s.v}</span>
        </div>
      ))}
    </div>
  );
}

function Inventory() {
  const { data: me } = useSession();
  const { get, set } = useUrlState();
  const owner = me?.role === 'owner';
  const status = get('status') as ListingWithCounts['status'] | undefined;
  const [table, setTable] = useState(false);
  const [edit, setEdit] = useState<ListingWithCounts | 'new' | null>(null);
  const q = useApi('listings', { status });
  const selected = get('id') ? Number(get('id')) : null;
  const rows = q.data?.data ?? [];

  return (
    <>
      <PageHeader title="Inventory matcher" subtitle="Each listing is matched to waiting buyers by area, type, BHK and budget (within 15%). Matched buyers are messaged on WhatsApp automatically."
        actions={<>
          <Select aria-label="Status" value={status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })} className="w-auto"><option value="">All listings</option>{ListingStatus.options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
          <Button variant="outline" size="icon" aria-label={table ? 'Show cards' : 'Show table'} onClick={() => setTable((t) => !t)}>{table ? <LayoutGrid className="size-5" /> : <Table2 className="size-5" />}</Button>
          {owner && <Button onClick={() => setEdit('new')}><Plus className="size-4" /> Add listing</Button>}
        </>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} rows={5} />)}</div> : rows.length === 0 ? <Card><EmptyState title="No listings here" body={owner ? 'Add a listing and matching buyers are found straight away.' : 'Nothing to show for this filter.'} action={owner ? <Button onClick={() => setEdit('new')}>Add listing</Button> : undefined} /></Card> : table ? (
        <Card className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-muted"><tr>{['Listing', 'Area', 'Price', 'Status', 'Matched', 'Messaged', 'Replied', 'Interested'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id} tabIndex={0} onClick={() => set({ id: String(l.id) }, { keepPage: true })} onKeyDown={(e) => e.key === 'Enter' && set({ id: String(l.id) }, { keepPage: true })} className="cursor-pointer border-b border-line hover:bg-surface-2">
                <td className="px-4 py-3 font-medium">{l.title}</td><td className="px-4 py-3">{l.location}</td><td className="tnum px-4 py-3">{inrShort(l.price)}</td><td className="px-4 py-3"><Badge tone={l.status === 'open' ? 'good' : 'neutral'}>{STATUS_LABEL[l.status]}</Badge></td>
                <td className="tnum px-4 py-3">{l.matched}</td><td className="tnum px-4 py-3">{l.messaged}</td><td className="tnum px-4 py-3">{l.responded}</td><td className="tnum px-4 py-3 font-medium text-good">{l.interested}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((l) => (
            <li key={l.id}>
              <Card className="h-full transition hover:border-line-strong">
                <button onClick={() => set({ id: String(l.id) }, { keepPage: true })} className="flex h-full w-full flex-col gap-3 p-5 text-left">
                  <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate font-display text-[19px] leading-tight">{l.title}</span><span className="text-[13px] text-muted">{l.location}{l.is_test ? ' · Test' : ''}</span></span><Badge tone={l.status === 'open' ? 'good' : 'neutral'}>{STATUS_LABEL[l.status]}</Badge></span>
                  <span className="flex items-baseline gap-2"><span className="font-display tnum text-[26px]">{inrShort(l.price)}</span><span className="text-sm text-muted">{[l.bhk ? `${l.bhk} BHK` : null, PROPERTY_LABEL[l.property_type]].filter(Boolean).join(' · ')}</span></span>
                  <MiniFunnel l={l} />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ListingDetail id={selected} onClose={() => set({ id: undefined }, { keepPage: true })} onEdit={(l) => setEdit(l)} owner={owner} />
      <ListingForm target={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function ListingDetail({ id, onClose, onEdit, owner }: { id: number | null; onClose: () => void; onEdit: (l: ListingWithCounts) => void; owner: boolean }) {
  const q = useApi('listing', { id: id ?? 0 }, { enabled: id != null });
  const { openLead } = useOverlays();
  const d = q.data?.data;
  return (
    <Dialog open={id != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title={d?.listing.title ?? 'Listing'} description={d ? `${d.listing.location} · ${inrShort(d.listing.price)}${d.listing.project ? ` · ${d.listing.project}` : ''}` : undefined}>
        <DialogBody className="space-y-5">
          {q.isLoading && <Skeleton className="h-40" />}
          {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {d && (<>
            <div className="flex items-start justify-between gap-3"><div className="flex-1"><MiniFunnel l={d.listing} /></div>{owner && <Button variant="outline" size="sm" onClick={() => onEdit(d.listing)}><Pencil className="size-4" /> Edit</Button>}</div>
            <h3 className="font-display text-lg">Matched buyers ({d.matches.length})</h3>
            {d.matches.length === 0 ? <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">No buyer matches yet. New leads are matched as they arrive.</p> : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {d.matches.map((m) => (
                  <li key={m.id} className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <button onClick={() => openLead(m.lead_id)} className="min-w-0 truncate text-left font-medium underline-offset-2 hover:underline">{m.lead_name ?? 'Unnamed lead'}</button>
                      {m.interested === true ? <Badge tone="good">Interested</Badge> : m.interested === false ? <Badge>Not interested</Badge> : m.messaged_at ? <Badge tone="outline">No reply yet</Badge> : <Badge tone="warn">Not sent yet</Badge>}
                    </div>
                    <div className="flex items-center gap-2" aria-label={`Match score ${Math.round(m.match_score)} percent`}>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><span className={cn('block h-full rounded-full', m.match_score >= 85 ? 'bg-good' : 'bg-brand')} style={{ width: `${m.match_score}%` }} /></span>
                      <span className="tnum w-12 text-right text-sm font-medium">{Math.round(m.match_score)}%</span>
                    </div>
                    <p className="text-xs text-muted">{m.messaged_at ? `Messaged ${timeAgo(m.messaged_at)}` : 'Not messaged yet'}{m.response ? ` · replied “${m.response}” ${timeAgo(m.responded_at)}` : ''} · agent {m.assigned_agent_name ?? 'none'}</p>
                    {m.lead_phone && <div className="flex gap-2"><Button asChild size="sm" variant="outline"><a href={telHref(m.lead_phone)}><Phone className="size-4" /> Call</a></Button><Button asChild size="sm" variant="soft"><a href={waHref(m.lead_phone, `Hi ${m.lead_name?.split(' ')[0] ?? ''}, about ${d.listing.title}: shall I arrange a visit?`)} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> WhatsApp</a></Button></div>}
                  </li>
                ))}
              </ul>
            )}
          </>)}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

interface LV { title: string; project: string; location: string; property_type: string; bhk: string; price: string; status: string }
function ListingForm({ target, onClose }: { target: ListingWithCounts | 'new' | null; onClose: () => void }) {
  const editing = target && target !== 'new' ? target : null;
  const { register, handleSubmit, reset, setError, watch, formState: { errors } } = useForm<LV>({ defaultValues: { title: '', project: '', location: '', property_type: 'apartment', bhk: '3', price: '', status: 'open' } });
  const [result, setResult] = useState<ListingActionResponse | null>(null);
  useEffect(() => {
    if (!target) return;
    setResult(null);
    reset(editing ? { title: editing.title, project: editing.project ?? '', location: editing.location, property_type: editing.property_type, bhk: editing.bhk ? String(editing.bhk) : '', price: String(editing.price / 100000), status: editing.status } : { title: '', project: '', location: '', property_type: 'apartment', bhk: '3', price: '', status: 'open' });
  }, [target, editing, reset]);
  const save = useAction('saveListing', { onDone: (r) => setResult(r.data) });
  const type = watch('property_type');
  const submit = handleSubmit((v) => {
    const p = ListingRequest.safeParse({ id: editing?.id, title: v.title, project: v.project || undefined, location: v.location, property_type: v.property_type, bhk: v.property_type === 'apartment' || v.property_type === 'villa' ? v.bhk || undefined : undefined, price: lakhToInr(v.price) ?? NaN, status: v.status });
    if (!p.success) { applyZodErrors(setError, p.error.issues); return; }
    save.mutate(p.data);
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={result ? 'Listing saved' : editing ? 'Edit listing' : 'Add a listing'} description={result ? undefined : 'Saving finds matching buyers right away and messages them on WhatsApp.'}>
        {result ? (<>
          <DialogBody className="space-y-3">
            <div className="rounded-2xl bg-good-soft p-5 text-center"><p className="font-display tnum text-5xl text-good">{result.new_matches}</p><p className="mt-1 text-[15px]">new buyer{result.new_matches === 1 ? '' : 's'} matched</p></div>
            <p className="text-sm text-ink-2">{result.message}</p>
            <p className="text-xs text-muted">{result.listing.matched} buyers matched in total · {result.listing.messaged} messaged.</p>
          </DialogBody>
          <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
        </>) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" error={errors.title?.message} className="sm:col-span-2"><Input {...register('title')} placeholder="3 BHK flat, Skyline Heights" aria-invalid={!!errors.title} /></Field>
              <Field label="Project (optional)"><Input {...register('project')} placeholder="Skyline Heights" /></Field>
              <Field label="Area" error={errors.location?.message}><Input {...register('location')} list="localities" placeholder="Gomti Nagar" aria-invalid={!!errors.location} /><datalist id="localities">{LOCALITIES.map((l) => <option key={l} value={l} />)}</datalist></Field>
              <Field label="Type"><Select {...register('property_type')}>{PropertyType.options.map((t) => <option key={t} value={t}>{PROPERTY_LABEL[t]}</option>)}</Select></Field>
              {(type === 'apartment' || type === 'villa') && <Field label="BHK"><Select {...register('bhk')}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} BHK</option>)}</Select></Field>}
              <Field label="Asking price (₹ lakh)" error={errors.price?.message} hint="1 crore = 100 lakh"><Input {...register('price')} inputMode="decimal" placeholder="85" aria-invalid={!!errors.price} /></Field>
              <Field label="Status"><Select {...register('status')}>{ListingStatus.options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
            </DialogBody>
            <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>{editing ? 'Save and re-match' : 'Save and find buyers'}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export default function Page() { return <Suspense><Inventory /></Suspense>; }
