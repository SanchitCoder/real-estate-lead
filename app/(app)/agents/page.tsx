'use client';
import { Pencil, Plus, Power, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AgentRequest, type Agent } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { CardSkeleton, EmptyState, ErrorState, PageHeader, PhoneReveal } from '@/components/app/shared';
import { useAction, useApi } from '@/lib/client/hooks';
import { applyZodErrors } from '@/lib/client/forms';
import { cn } from '@/lib/utils';

export default function AgentsPage() {
  const q = useApi('agents', {});
  const [edit, setEdit] = useState<Agent | 'new' | null>(null);
  const [toggle, setToggle] = useState<Agent | null>(null);
  const act = useAction('saveAgent', { onDone: () => setToggle(null) });
  const rows = q.data?.data ?? [];
  const active = rows.filter((a) => a.active);
  const load = active.reduce((a, r) => a + r.open_leads, 0);
  const cap = active.reduce((a, r) => a + r.max_open_leads, 0);

  return (
    <>
      <PageHeader title="Agents" subtitle="Leads are handed out in turn to active agents who have room. Hot leads go to whoever converts best."
        actions={<Button onClick={() => setEdit('new')}><Plus className="size-4" /> Add agent</Button>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <CardSkeleton rows={6} /> : rows.length === 0 ? <Card><EmptyState title="No agents yet" body="Add your first agent so new leads have someone to go to." action={<Button onClick={() => setEdit('new')}>Add agent</Button>} /></Card> : (
        <>
          <p className="mb-4 text-[15px] text-ink-2"><strong className="tnum">{active.length}</strong> active agents are carrying <strong className="tnum">{load}</strong> open leads out of <strong className="tnum">{cap}</strong> places. {cap - load < 30 ? <span className="text-bad">Capacity is getting tight.</span> : <span className="text-good">There is room for more.</span>}</p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {[...rows].sort((a, b) => Number(b.active) - Number(a.active) || a.round_robin_order - b.round_robin_order).map((a) => {
              const p = a.max_open_leads ? Math.min(100, (a.open_leads / a.max_open_leads) * 100) : 100;
              return (
                <li key={a.id}>
                  <Card className={cn('p-5', !a.active && 'opacity-75')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-display text-[21px] leading-tight">{a.name}{a.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</p>
                        <p className="mt-1 text-sm text-muted"><PhoneReveal phone={a.phone} />{a.email ? ` · ${a.email}` : ''}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label={a.active ? `Deactivate ${a.name}` : `Reactivate ${a.name}`} onClick={() => setToggle(a)}>{a.active ? <Power className="size-4" /> : <UserCheck className="size-4" />}</Button>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="mb-1.5 flex justify-between text-[13px]"><span className="text-muted">Open leads</span><span className="tnum font-medium">{a.open_leads} of {a.max_open_leads}</span></div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={a.open_leads} aria-valuemin={0} aria-valuemax={a.max_open_leads} aria-label={`${a.name} workload`}><div className={cn('h-full rounded-full transition-all', p >= 90 ? 'bg-bad' : p >= 70 ? 'bg-warn' : 'bg-brand')} style={{ width: `${p}%` }} /></div>
                      <p className="mt-3 text-xs text-muted">Turn order {a.round_robin_order} · share of leads ×{a.weight}</p>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <AgentForm target={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog open={!!toggle} onOpenChange={(o) => !o && setToggle(null)} loading={act.isPending} tone={toggle?.active ? 'danger' : 'primary'}
        title={toggle?.active ? `Deactivate ${toggle?.name}?` : `Reactivate ${toggle?.name}?`} confirmLabel={toggle?.active ? 'Yes, deactivate' : 'Yes, reactivate'}
        description={toggle?.active ? 'They will stop receiving new leads. Their current leads stay with them until you reassign them.' : 'They will start receiving new leads again.'}
        onConfirm={() => toggle && act.mutate({ action: toggle.active ? 'deactivate' : 'activate', id: toggle.id })}>
        {toggle?.active && toggle.open_leads > 0 && <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">{toggle.name} still has {toggle.open_leads} open lead{toggle.open_leads === 1 ? '' : 's'}. Reassign them from the lead feed.</p>}
      </ConfirmDialog>
    </>
  );
}

interface AV { name: string; phone: string; email: string; round_robin_order: string; weight: string; max_open_leads: string }
function AgentForm({ target, onClose }: { target: Agent | 'new' | null; onClose: () => void }) {
  const editing = target && target !== 'new' ? target : null;
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<AV>();
  useEffect(() => {
    if (target) reset(editing ? { name: editing.name, phone: editing.phone.slice(-10), email: editing.email ?? '', round_robin_order: String(editing.round_robin_order), weight: String(editing.weight), max_open_leads: String(editing.max_open_leads) } : { name: '', phone: '', email: '', round_robin_order: '100', weight: '1', max_open_leads: '30' });
  }, [target, editing, reset]);
  const save = useAction('saveAgent', { onDone: onClose });
  const submit = handleSubmit((v) => {
    const p = AgentRequest.safeParse({ action: editing ? 'update' : 'create', id: editing?.id, name: v.name, phone: v.phone, email: v.email || undefined, round_robin_order: v.round_robin_order, weight: v.weight, max_open_leads: v.max_open_leads });
    if (!p.success) { applyZodErrors(setError, p.error.issues); return; }
    save.mutate(p.data);
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={editing ? `Edit ${editing.name}` : 'Add an agent'} description="Agents are alerted on WhatsApp, so use the number they have WhatsApp on.">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name?.message}><Input {...register('name')} aria-invalid={!!errors.name} /></Field>
            <Field label="WhatsApp number" error={errors.phone?.message}><Input {...register('phone')} inputMode="tel" placeholder="98111 00001" aria-invalid={!!errors.phone} /></Field>
            <Field label="Email (optional)" error={errors.email?.message} className="sm:col-span-2"><Input {...register('email')} type="email" /></Field>
            <Field label="Turn order" hint="Lower goes first" error={errors.round_robin_order?.message}><Input {...register('round_robin_order')} inputMode="numeric" /></Field>
            <Field label="Share of leads" hint="2 = twice as many" error={errors.weight?.message}><Input {...register('weight')} inputMode="numeric" /></Field>
            <Field label="Most open leads at once" error={errors.max_open_leads?.message} className="sm:col-span-2"><Input {...register('max_open_leads')} inputMode="numeric" /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Add agent'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
