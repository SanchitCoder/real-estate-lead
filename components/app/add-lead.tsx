'use client';
import { useForm } from 'react-hook-form';
import { PropertyType, SOURCES, Timeline, AddLeadRequest } from '@contracts/realestate-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { useAction } from '@/lib/client/hooks';
import { applyZodErrors, lakhToInr } from '@/lib/client/forms';
import { PROPERTY_LABEL, SOURCE_LABEL, TIMELINE_LABEL } from '@/lib/format';

interface V { name: string; phone: string; email: string; source: string; budget_min: string; budget_max: string; location_pref: string; property_type: string; bhk: string; timeline: string; notes: string }
const defaults: V = { name: '', phone: '', email: '', source: 'referral', budget_min: '', budget_max: '', location_pref: '', property_type: '', bhk: '', timeline: '', notes: '' };

export function AddLeadDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: number) => void }) {
  const { register, handleSubmit, setError, reset, formState: { errors } } = useForm<V>({ defaultValues: defaults });
  const add = useAction('addLead', {
    onDone: (r) => { reset(defaults); onOpenChange(false); onCreated?.(r.data.lead_id); },
  });

  const submit = handleSubmit((v) => {
    const payload = {
      name: v.name, phone: v.phone || undefined, email: v.email || undefined, source: v.source,
      budget_min: lakhToInr(v.budget_min), budget_max: lakhToInr(v.budget_max),
      location_pref: v.location_pref || undefined, property_type: v.property_type || undefined, bhk: v.bhk || undefined, timeline: v.timeline || undefined, notes: v.notes || undefined,
    };
    const parsed = AddLeadRequest.safeParse(payload);
    if (!parsed.success) { applyZodErrors(setError, parsed.error.issues); return; }
    add.mutate(parsed.data);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a lead" description="For walk-ins, referrals and calls. It goes through the same scoring, agent assignment and instant WhatsApp reply as every other lead.">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name?.message} className="sm:col-span-2"><Input {...register('name')} autoComplete="off" aria-invalid={!!errors.name} placeholder="e.g. Anjali Srivastava" /></Field>
            <Field label="Mobile number" error={errors.phone?.message}><Input {...register('phone')} inputMode="tel" placeholder="98111 00001" aria-invalid={!!errors.phone} /></Field>
            <Field label="Email (optional)" error={errors.email?.message}><Input {...register('email')} type="email" inputMode="email" aria-invalid={!!errors.email} /></Field>
            <Field label="Where did they come from?"><Select {...register('source')}>{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
            <Field label="When will they buy?"><Select {...register('timeline')}><option value="">Not said</option>{Timeline.options.map((t) => <option key={t} value={t}>{TIMELINE_LABEL[t]}</option>)}</Select></Field>
            <Field label="Budget from (₹ lakh)" error={errors.budget_min?.message}><Input {...register('budget_min')} inputMode="decimal" placeholder="60" /></Field>
            <Field label="Budget up to (₹ lakh)" error={errors.budget_max?.message}><Input {...register('budget_max')} inputMode="decimal" placeholder="85" /></Field>
            <Field label="Preferred area"><Input {...register('location_pref')} placeholder="Gomti Nagar" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><Select {...register('property_type')}><option value="">Any</option>{PropertyType.options.map((t) => <option key={t} value={t}>{PROPERTY_LABEL[t]}</option>)}</Select></Field>
              <Field label="BHK"><Select {...register('bhk')}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} BHK</option>)}</Select></Field>
            </div>
            <Field label="Notes (optional)" className="sm:col-span-2"><Textarea {...register('notes')} placeholder="Anything the agent should know" /></Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={add.isPending}>Add lead</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
