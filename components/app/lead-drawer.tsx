'use client';
import { fromZonedTime } from 'date-fns-tz';
import { AlertTriangle, ArrowRight, Bell, CalendarClock, CalendarPlus, Home, MessageCircle, MessageSquare, Phone, Shuffle, Sparkles, StickyNote, UserCheck, UserPlus, Repeat, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { StageRequest, ReassignRequest, NoteRequest, type EventType, type LeadDetailResponse, type Stage } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi, useAction } from '@/lib/client/hooks';
import { applyZodErrors } from '@/lib/client/forms';
import { useSession } from '@/lib/client/session';
import { EVENT_LABEL, IST, PROPERTY_LABEL, STAGE_LABEL, TIMELINE_LABEL, budgetRange, istTime, telHref, timeAgo, waHref } from '@/lib/format';
import { stageOrd } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { ErrorState, PhoneReveal, ScoreChip, SlaPill, SourceBadge, StageBadge } from './shared';

const ICONS: Partial<Record<EventType, LucideIcon>> = {
  created: Sparkles, assigned: UserCheck, reassigned_stale: Shuffle, auto_response_sent: MessageCircle, agent_alerted: Bell, called: Phone,
  followup_done: Phone, stage_change: ArrowRight, note: StickyNote, sla_breached: AlertTriangle, owner_escalated: AlertTriangle, lead_reply: MessageSquare,
  visit_reminder_sent: CalendarClock, listing_matched: Home, listing_response: Home, repeat_enquiry: Repeat, command_rejected: XCircle, inactivity_nudge: Bell, scored: Sparkles, unassigned: UserPlus,
};
const BAD: EventType[] = ['sla_breached', 'owner_escalated', 'command_rejected', 'unassigned'];

export interface ReassignTarget { leadId: number; leadName: string | null; currentAgentId: number | null }

/** Stages a lead can move to from where it is now. */
export function nextStages(stage: Stage): Stage[] {
  if (['closed_won', 'closed_lost', 'junk'].includes(stage)) return [];
  const fwd = (['qualified', 'site_visit_booked', 'visited', 'negotiation', 'closed_won'] as Stage[]).filter((s) => stageOrd(s) > stageOrd(stage) || (s === 'site_visit_booked' && stage === 'site_visit_booked'));
  return [...fwd, 'closed_lost', ...(stage === 'new' || stage === 'qualified' ? (['junk'] as Stage[]) : [])];
}
const localNow = () => { const d = new Date(Date.now() + 60 * 60000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export function LeadDrawer({ leadId, onClose }: { leadId: number | null; onClose: () => void }) {
  const { data: me } = useSession();
  const q = useApi('lead', { id: leadId ?? 0 }, { enabled: leadId != null });
  const [stageOpen, setStageOpen] = useState(false);
  const [reassign, setReassign] = useState(false);
  const d = q.data?.data;

  return (
    <>
      <Dialog open={leadId != null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent side="right" title={d?.lead.name ?? (q.isLoading ? 'Loading lead…' : 'Lead')} description={d ? `Lead #${d.lead.id} · captured ${timeAgo(d.lead.created_at)}` : undefined}>
          <DialogBody className="space-y-6 pb-8">
            {q.isLoading && <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
            {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
            {d && <DrawerBody d={d} me={me} onStage={() => setStageOpen(true)} onReassign={() => setReassign(true)} />}
          </DialogBody>
        </DialogContent>
      </Dialog>
      {d && <StageDialog open={stageOpen} onOpenChange={setStageOpen} lead={d.lead} />}
      {d && <ReassignDialog target={reassign ? { leadId: d.lead.id, leadName: d.lead.name, currentAgentId: d.lead.assigned_agent_id } : null} onClose={() => setReassign(false)} />}
    </>
  );
}

function DrawerBody({ d, me, onStage, onReassign }: { d: LeadDetailResponse; me?: { role: string }; onStage: () => void; onReassign: () => void }) {
  const l = d.lead;
  const [note, setNote] = useState('');
  const addNote = useAction('addNote', { onDone: () => setNote('') });
  const closed = ['closed_won', 'closed_lost', 'junk'].includes(l.stage);
  const waText = `Hi ${l.name?.split(' ')[0] ?? ''}, this is ${l.assigned_agent_name ?? 'your agent'} from Skyline Realty. Thanks for your enquiry. When is a good time to talk?`;
  const rows: [string, React.ReactNode][] = [
    ['Source', <SourceBadge key="s" source={l.source} />],
    ['Looking for', [l.bhk ? `${l.bhk} BHK` : null, l.property_type ? PROPERTY_LABEL[l.property_type] : null].filter(Boolean).join(' ') || 'Not given'],
    ['Area', l.location_pref ?? 'Not given'],
    ['Budget', budgetRange(l.budget_min, l.budget_max)],
    ['Buying', TIMELINE_LABEL[l.timeline]],
    ['Agent', l.assigned_agent_name ?? 'Nobody yet'],
    ['First response', <SlaPill key="r" responseMin={l.minutes_to_first_response} sinceCreatedMin={l.minutes_since_created} />],
    ['Visit', l.visit_at ? istTime(l.visit_at) : '—'],
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ScoreChip score={l.score} reason={l.score_reason} />
        <StageBadge stage={l.stage} />
        {l.is_stale && <Badge tone="bad">▲ Needs attention</Badge>}
        {l.repeat_count > 0 && <Badge tone="warn"><Repeat className="size-3" /> Enquired {l.repeat_count + 1}×</Badge>}
        {l.is_test && <Badge tone="outline">Test record</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {l.phone ? (
          <>
            <Button asChild variant="primary" size="lg"><a href={telHref(l.phone)}><Phone className="size-5" /> Call</a></Button>
            <Button asChild variant="soft" size="lg"><a href={waHref(l.phone, waText)} target="_blank" rel="noreferrer"><MessageCircle className="size-5" /> WhatsApp</a></Button>
          </>
        ) : <p className="col-span-2 rounded-xl bg-surface-2 p-3 text-sm text-muted">No phone number on this lead{l.email ? `. Email: ${l.email}` : '.'}</p>}
      </div>

      <section aria-label="Details">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-[15px]">
          <dt className="text-muted">Phone</dt><dd><PhoneReveal phone={l.phone} /></dd>
          {l.email && (<><dt className="text-muted">Email</dt><dd className="break-all">{l.email}</dd></>)}
          {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0">{v}</dd></div>))}
        </dl>
      </section>

      {l.score_reason && (
        <section className="rounded-2xl border border-line bg-surface-2 p-4">
          <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted">Why {l.score ?? 'this score'}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed">{l.score_reason}{l.score_points != null && <span className="text-muted"> ({l.score_points}/100)</span>}</p>
        </section>
      )}
      {l.lost_reason && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">Lost: {l.lost_reason}</p>}

      <section aria-label="Actions" className="space-y-3">
        <h3 className="font-display text-lg">Do something</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onStage} disabled={closed}><CalendarPlus className="size-4" /> Update stage / book visit</Button>
          {me?.role === 'owner' && <Button variant="outline" onClick={onReassign}><Shuffle className="size-4" /> Reassign</Button>}
        </div>
        {closed && <p className="text-[13px] text-muted">This lead is closed. You can still add notes.</p>}
        <div>
          <Field label="Add a note" error={addNote.error?.message}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wants a higher floor, call after 6 pm" maxLength={1000} />
          </Field>
          <Button className="mt-2" variant="secondary" size="sm" disabled={!note.trim()} loading={addNote.isPending} onClick={() => { const p = NoteRequest.safeParse({ lead_id: l.id, note }); if (p.success) addNote.mutate(p.data); }}>Save note</Button>
        </div>
      </section>

      {d.matches.length > 0 && (
        <section aria-label="Matched listings" className="space-y-2">
          <h3 className="font-display text-lg">Matched listings</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {d.matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{m.listing_title}</span><span className="text-muted">{Math.round(m.match_score)}% match{m.messaged_at ? ` · sent ${timeAgo(m.messaged_at)}` : ' · not sent yet'}</span></span>
                {m.interested === true ? <Badge tone="good">Interested</Badge> : m.interested === false ? <Badge>Not interested</Badge> : <Badge tone="outline">No reply</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Timeline" className="space-y-3">
        <h3 className="font-display text-lg">Everything that happened</h3>
        <ol className="relative space-y-4 border-l border-line pl-5">
          {[...d.events].reverse().map((e) => {
            const Icon = ICONS[e.event_type] ?? Sparkles;
            const bad = BAD.includes(e.event_type);
            return (
              <li key={e.id} className="relative">
                <span className={cn('absolute -left-[31px] grid size-6 place-items-center rounded-full border bg-surface', bad ? 'border-bad text-bad' : 'border-line-strong text-muted')}><Icon className="size-3.5" aria-hidden /></span>
                <p className={cn('text-[15px] font-medium', bad && 'text-bad')}>
                  {EVENT_LABEL[e.event_type]}
                  {e.event_type === 'stage_change' && e.to_stage && <span className="font-normal text-ink-2">: {e.from_stage ? STAGE_LABEL[e.from_stage] : ''} → {STAGE_LABEL[e.to_stage]}</span>}
                </p>
                {e.note && <p className="mt-0.5 text-sm text-ink-2">{e.note}</p>}
                <p className="mt-0.5 text-xs text-muted">{istTime(e.created_at)}{e.agent_name ? ` · ${e.agent_name}` : ''}</p>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ stage dialog (also the confirmation step) */
interface SV { to_stage: string; note: string; visit_at: string }
export function StageDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: LeadDetailResponse['lead'] }) {
  const options = useMemo(() => nextStages(lead.stage), [lead.stage]);
  const { register, handleSubmit, watch, setError, reset, formState: { errors } } = useForm<SV>({ defaultValues: { to_stage: options[0] ?? '', note: '', visit_at: '' } });
  useEffect(() => { if (open) reset({ to_stage: options[0] ?? '', note: '', visit_at: localNow() }); }, [open, options, reset]);
  const to = watch('to_stage') as Stage;
  const action = useAction('updateStage', { onDone: () => onOpenChange(false) });

  const submit = handleSubmit((v) => {
    const visit = v.to_stage === 'site_visit_booked' && v.visit_at ? fromZonedTime(v.visit_at, IST).toISOString() : undefined;
    const p = StageRequest.safeParse({ lead_id: lead.id, to_stage: v.to_stage, note: v.note || undefined, visit_at: visit });
    if (!p.success) { applyZodErrors(setError, p.error.issues); return; }
    if (visit && new Date(visit) < new Date()) { setError('visit_at', { message: 'Pick a time in the future.' }); return; }
    action.mutate(p.data);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Update stage" description={`${lead.name ?? 'This lead'} is at “${STAGE_LABEL[lead.stage]}” now.`}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <Field label="Move to" error={errors.to_stage?.message}>
              <Select {...register('to_stage')}>{options.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
            </Field>
            {to === 'site_visit_booked' && (
              <Field label="Visit date and time (IST)" error={errors.visit_at?.message} hint="A calendar event and WhatsApp reminders for you and the buyer are created automatically.">
                <Input type="datetime-local" {...register('visit_at')} aria-invalid={!!errors.visit_at} />
              </Field>
            )}
            <Field label={to === 'closed_lost' ? 'Why was it lost?' : 'Note (optional)'} error={errors.note?.message}>
              <Textarea {...register('note')} aria-invalid={!!errors.note} placeholder={to === 'closed_lost' ? 'e.g. Bought elsewhere' : ''} />
            </Field>
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
              You are about to move <strong>{lead.name ?? 'this lead'}</strong> from <strong>{STAGE_LABEL[lead.stage]}</strong> to <strong>{STAGE_LABEL[to] ?? '…'}</strong>. This is logged on their timeline{lead.first_response_at ? '' : ' and counts as the first response'}.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={action.isPending}>Yes, update</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ reassign dialog (owner) */
interface RV { agent_id: string; reason: string }
export function ReassignDialog({ target, onClose }: { target: ReassignTarget | null; onClose: () => void }) {
  const agents = useApi('agents', {}, { enabled: target != null });
  const { register, handleSubmit, setError, reset, formState: { errors } } = useForm<RV>({ defaultValues: { agent_id: '', reason: '' } });
  useEffect(() => { if (target) reset({ agent_id: '', reason: '' }); }, [target, reset]);
  const action = useAction('reassign', { onDone: () => onClose() });
  const options = (agents.data?.data ?? []).filter((a) => a.active && a.id !== target?.currentAgentId);

  const submit = handleSubmit((v) => {
    const p = ReassignRequest.safeParse({ lead_id: target!.leadId, agent_id: v.agent_id, reason: v.reason });
    if (!p.success) { applyZodErrors(setError, p.error.issues); if (!v.agent_id) toast.error('Pick an agent.'); return; }
    action.mutate(p.data);
  });
  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Reassign lead" description={target ? `Hand ${target.leadName ?? 'this lead'} to a different agent. Both agents are told on WhatsApp.` : undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <Field label="New agent" error={errors.agent_id?.message}>
              <Select {...register('agent_id')} aria-invalid={!!errors.agent_id}>
                <option value="">Choose an agent…</option>
                {options.map((a) => <option key={a.id} value={a.id} disabled={a.open_leads >= a.max_open_leads}>{a.name} · {a.open_leads}/{a.max_open_leads} open leads{a.open_leads >= a.max_open_leads ? ' (full)' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Reason" error={errors.reason?.message}><Textarea {...register('reason')} placeholder="e.g. Rohan is on leave this week" aria-invalid={!!errors.reason} /></Field>
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">The response clock restarts for the new agent.</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={action.isPending}>Yes, reassign</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
