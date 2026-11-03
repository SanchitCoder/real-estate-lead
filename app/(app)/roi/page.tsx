'use client';
import { AlertTriangle, CalendarPlus, Info, Pencil, TrendingDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { CostRequest, SOURCES, type RoiRow } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import { CardSkeleton, ChartCard, EmptyState, ErrorState, PageHeader, SOURCE_COLOR, SourceBadge, chartTheme } from '@/components/app/shared';
import { useAction, useApi } from '@/lib/client/hooks';
import { applyZodErrors } from '@/lib/client/forms';
import { SOURCE_LABEL, inr, inrShort, monthLabel, num } from '@/lib/format';
import { addMonths, istDate, monthOf } from '@/lib/metrics';
import { cn } from '@/lib/utils';

const PAID_HINT = 'Spend is the monthly subscription or ad budget you entered for that source.';

export default function RoiPage() {
  const current = monthOf(istDate(new Date()));
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => addMonths(current, -i)), [current]);
  const [month, setMonth] = useState(addMonths(current, -1));
  const roi = useApi('sourceRoi', { month: month.slice(0, 7) });
  const costs = useApi('costs', {});
  const d = roi.data?.data;
  const formRef = useRef<HTMLDivElement>(null);
  const [prefill, setPrefill] = useState<{ source: string; month: string; amount: number } | null>(null);

  const rows = d?.rows ?? [];
  const paid = rows.filter((r) => r.cost_inr > 0);
  const best = d?.best_source;
  const worst = [...paid].filter((r) => r.cost_per_site_visit != null).sort((a, b) => b.cost_per_site_visit! - a.cost_per_site_visit!)[0];
  const cut = rows.filter((r) => r.consider_cut);

  const cpsvData = rows.filter((r) => r.cost_inr > 0).map((r) => ({ name: SOURCE_LABEL[r.source], source: r.source, cpsv: r.cost_per_site_visit ?? 0, cut: r.consider_cut, visits: r.site_visits }));
  const thresholdLine = best ? best.cost_per_site_visit * 2 : null;

  return (
    <>
      <PageHeader title="Which portal is worth paying for?" subtitle="What each source cost, what it produced, and the price of one real site visit."
        actions={<Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === current ? ' (this month)' : ''}</option>)}</Select>} />

      {d && d.missing_current_month.length > 0 && (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-[15px]">
          <CalendarPlus className="size-5 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1"><strong>{monthLabel(current)} costs are missing</strong> for {d.missing_current_month.map((s) => SOURCE_LABEL[s]).join(', ')}. Without them, this month&apos;s cost per visit can&apos;t be worked out.</p>
          <Button size="sm" variant="outline" onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth' })}>Enter costs</Button>
        </div>
      )}

      {roi.isError ? <ErrorState error={roi.error} onRetry={() => roi.refetch()} /> : !d ? <CardSkeleton rows={7} /> : (
        <>
          {rows.length === 0 ? <Card><EmptyState title={`No data for ${monthLabel(month)}`} body="Pick another month, or enter this month's costs below." /></Card> : (
            <Card className="overflow-hidden border-brand/30">
              <div className="grid gap-px bg-line sm:grid-cols-3">
                <Stat label="Spent" value={inr(paid.reduce((a, r) => a + r.cost_inr, 0))} sub={`across ${paid.length} paid source${paid.length === 1 ? '' : 's'}`} />
                <Stat label="Cheapest site visit" value={best ? inr(best.cost_per_site_visit) : '—'} sub={best ? SOURCE_LABEL[best.source] : 'no visits yet'} tone="good" />
                <Stat label="Dearest site visit" value={worst ? inr(worst.cost_per_site_visit) : '—'} sub={worst ? `${SOURCE_LABEL[worst.source]}${best && worst.source !== best.source ? ` · ${(worst.cost_per_site_visit! / best.cost_per_site_visit).toFixed(1)}× the cheapest` : ''}` : ''} tone={cut.length ? 'bad' : undefined} />
              </div>
              {cut.map((r) => {
                const rate = best ? Math.floor(r.cost_inr / best.cost_per_site_visit) : null;
                return (
                  <div key={r.source} className="flex items-start gap-3 border-t border-bad/25 bg-bad-soft px-5 py-4">
                    <TrendingDown className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden />
                    <p className="text-[15px] leading-snug"><strong>{SOURCE_LABEL[r.source]}: consider cutting.</strong> {r.site_visits === 0 ? `${inr(r.cost_inr)} bought ${r.leads} leads and no site visits.` : `${inr(r.cost_inr)} produced ${r.site_visits} site visit${r.site_visits === 1 ? '' : 's'} (${inr(r.cost_per_site_visit)} each).`}{best && rate != null && r.source !== best.source ? ` At ${SOURCE_LABEL[best.source]}'s rate that money would have bought about ${rate} visits.` : ''}</p>
                  </div>
                );
              })}
            </Card>
          )}

          {rows.length > 0 && (
            <Card className="mt-6">
              <CardHeader title={`${monthLabel(month)} by source`} caption="Leads are counted by the month they arrived. Costs are what you entered for the month." />
              <div className="scroll-thin mt-3 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-[14px]">
                  <thead className="border-y border-line bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="sticky left-0 z-10 bg-surface-2 px-4 py-3 font-medium">Source</th>
                      {[['Spend', PAID_HINT], ['Leads', 'All enquiries, including junk.'], ['Qualified', 'Leads an agent judged to be real buyers.'], ['Visits booked', 'Leads that got a site visit booked.'], ['Visits done', 'Leads who actually came to see a property. This is what the backend calls a “site visit”.'], ['Closed', 'Deals won.'], ['Per lead', 'Spend ÷ leads'], ['Per visit booked', 'Spend ÷ visits booked'], ['Per visit done', 'Spend ÷ visits done. The number used for the “consider cutting” rule.'], ['Per closure', 'Spend ÷ deals won']].map(([h, t]) => (
                        <th key={h} className="px-4 py-3 text-right font-medium"><Tip content={t}><span className="inline-flex cursor-help items-center gap-1">{h}<Info className="size-3 opacity-60" aria-hidden /></span></Tip></th>
                      ))}
                      <th className="px-4 py-3 font-medium">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: RoiRow) => (
                      <tr key={r.source} className={cn('border-b border-line', r.consider_cut && 'bg-[color-mix(in_oklab,var(--bad)_6%,transparent)]')}>
                        <td className="sticky left-0 z-10 bg-surface px-4 py-3.5 font-medium"><SourceBadge source={r.source} /></td>
                        <td className="tnum px-4 py-3.5 text-right">{r.cost_inr ? inr(r.cost_inr) : <span className="text-muted">Free</span>}</td>
                        <td className="tnum px-4 py-3.5 text-right">{num(r.leads)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{num(r.qualified)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{num(r.visits_booked)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{num(r.site_visits)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{num(r.closures)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{inr(r.cost_per_lead)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{inr(r.cost_per_visit_booked)}</td>
                        <td className={cn('tnum px-4 py-3.5 text-right font-semibold', r.consider_cut && 'text-bad')}>{inr(r.cost_per_site_visit)}</td>
                        <td className="tnum px-4 py-3.5 text-right">{inr(r.cost_per_closure)}</td>
                        <td className="px-4 py-3.5">
                          {r.consider_cut ? <Tip content={<>{r.advice}<br /><span className="opacity-80">Rule: a paid source is flagged when it has no site visits, or costs more than 2× the cheapest paid source per site visit.</span></>}><Badge tone="bad" className="cursor-help"><AlertTriangle className="size-3" /> Consider cutting</Badge></Tip>
                            : r.cost_inr === 0 ? <Badge tone="neutral">{r.source === 'referral' ? 'Free: keep' : 'No cost entered'}</Badge> : <Tip content={r.advice}><Badge tone="good" className="cursor-help">Keep</Badge></Tip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="Price of one site visit" caption="What each paid source paid for every buyer who actually came to see a property. Dashed line: the “consider cutting” threshold." height={260}
              table={{ columns: ['Source', 'Visits done', 'Cost per visit', 'Flagged'], rows: cpsvData.map((c) => [c.name, c.visits, inr(c.cpsv), c.cut ? 'Consider cutting' : 'OK']) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cpsvData} margin={{ left: 0, right: 8, top: 16 }}>
                  <CartesianGrid vertical={false} stroke={chartTheme.grid} />
                  <XAxis dataKey="name" tick={chartTheme.axis} />
                  <YAxis tick={chartTheme.axis} tickFormatter={(v) => inrShort(v)} width={56} />
                  <Tooltip {...chartTheme.tooltip} formatter={(v) => [inr(Number(v)), 'Per site visit']} cursor={{ fill: 'var(--surface-2)' }} />
                  {thresholdLine && <ReferenceLine y={thresholdLine} stroke="var(--bad)" strokeDasharray="5 4" label={{ value: '2× cheapest', fill: 'var(--bad)', fontSize: 11, position: 'insideTopRight' }} />}
                  <Bar dataKey="cpsv" radius={[8, 8, 0, 0]} barSize={46}>{cpsvData.map((c) => <Cell key={c.source} fill={c.cut ? 'var(--bad)' : SOURCE_COLOR[c.source]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Spend vs deals closed" caption="Up to six months: bars are what you spent, the line is deals won from that month's leads." height={260}
              table={{ columns: ['Month', 'Spend', 'Leads', 'Visits done', 'Deals closed'], rows: d.history.map((h) => [monthLabel(`${h.month}-01`), inr(h.spend_inr), h.leads, h.site_visits, h.closures]) }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.history.map((h) => ({ ...h, label: monthLabel(`${h.month}-01`).slice(0, 3) }))} margin={{ left: 0, right: 0 }}>
                  <CartesianGrid vertical={false} stroke={chartTheme.grid} />
                  <XAxis dataKey="label" tick={chartTheme.axis} />
                  <YAxis yAxisId="l" tick={chartTheme.axis} tickFormatter={(v) => inrShort(v)} width={56} />
                  <YAxis yAxisId="r" orientation="right" tick={chartTheme.axis} allowDecimals={false} width={32} />
                  <Tooltip {...chartTheme.tooltip} formatter={(v, n) => (n === 'Spend' ? [inr(Number(v)), n] : [v, n])} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="spend_inr" name="Spend" fill="var(--c4)" radius={[6, 6, 0, 0]} barSize={34} />
                  <Line yAxisId="r" dataKey="closures" name="Deals closed" stroke="var(--good)" strokeWidth={2.4} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}

      <div ref={formRef} className="mt-6 grid scroll-mt-24 gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <CostForm months={months} prefill={prefill} existing={costs.data?.data ?? []} onSaved={() => setPrefill(null)} />
        <Card>
          <CardHeader title="Costs you have entered" caption="Tap the pencil to correct a month. The same source and month always replaces the earlier amount." />
          <div className="scroll-thin max-h-[420px] overflow-auto p-2">
            {costs.isLoading ? <div className="p-3"><CardSkeleton rows={4} /></div> : (costs.data?.data.length ?? 0) === 0 ? <EmptyState title="No costs yet" body="Add the first month's portal and ad spend using the form." /> : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 font-medium">Month</th><th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="w-12" /></tr></thead>
                <tbody>
                  {costs.data!.data.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="px-3 py-2.5">{monthLabel(c.month)}</td>
                      <td className="px-3 py-2.5"><SourceBadge source={c.source} /> {c.is_test && <Badge tone="outline">Test</Badge>}</td>
                      <td className="tnum px-3 py-2.5 text-right">{inr(c.amount_inr)}</td>
                      <td className="px-1 py-1"><Button variant="ghost" size="icon" className="size-10" aria-label={`Edit ${SOURCE_LABEL[c.source]} ${monthLabel(c.month)}`} onClick={() => { setPrefill({ source: c.source, month: c.month.slice(0, 7), amount: c.amount_inr }); formRef.current?.scrollIntoView({ behavior: 'smooth' }); }}><Pencil className="size-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-surface p-5">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={cn('font-display tnum mt-1 text-[34px] leading-none', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</p>
      <p className="mt-1.5 text-[13px] text-muted">{sub}</p>
    </div>
  );
}

interface CV { source: string; month: string; amount: string }
function CostForm({ months, prefill, existing, onSaved }: { months: string[]; prefill: { source: string; month: string; amount: number } | null; existing: { source: string; month: string; amount_inr: number }[]; onSaved: () => void }) {
  const cur = months[0].slice(0, 7);
  const { register, handleSubmit, setError, reset, setValue, getValues, formState: { errors } } = useForm<CV>({ defaultValues: { source: '99acres', month: cur, amount: '' } });
  const [confirm, setConfirm] = useState<CostRequest | null>(null);
  const save = useAction('saveCost', { onDone: () => { setConfirm(null); reset({ source: getValues('source'), month: getValues('month'), amount: '' }); onSaved(); } });
  useEffect(() => { if (prefill) { setValue('source', prefill.source); setValue('month', prefill.month); setValue('amount', String(prefill.amount)); } }, [prefill, setValue]);
  const prev = confirm ? existing.find((c) => c.source === confirm.source && c.month.slice(0, 7) === confirm.month.slice(0, 7)) : undefined;

  const submit = handleSubmit((v) => {
    const p = CostRequest.safeParse({ source: v.source, month: v.month, amount_inr: v.amount === '' ? NaN : v.amount.replace(/,/g, '') });
    if (!p.success) { applyZodErrors(setError, p.error.issues, { amount_inr: 'amount' }); return; }
    setConfirm(p.data);
  });
  return (
    <Card>
      <CardHeader title="Enter a month's cost" caption="Total portal subscription or ad spend for one source in one month." />
      <form onSubmit={submit} noValidate className="grid gap-4 p-5">
        <Field label="Source"><Select {...register('source')}>{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
        <Field label="Month" error={errors.month?.message}><Input type="month" {...register('month')} max={cur} aria-invalid={!!errors.month} /></Field>
        <Field label="Amount (₹)" error={errors.amount?.message}><Input {...register('amount')} inputMode="numeric" placeholder="45000" aria-invalid={!!errors.amount} /></Field>
        <Button type="submit">Save cost</Button>
      </form>
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title="Save this cost?" confirmLabel="Yes, save" loading={save.isPending}
        description={confirm ? `${SOURCE_LABEL[confirm.source]} · ${monthLabel(`${confirm.month.slice(0, 7)}-01`)} · ${inr(confirm.amount_inr)}` : ''} onConfirm={() => confirm && save.mutate(confirm)}>
        <p className="text-sm text-ink-2">{prev ? <>This replaces the earlier amount of <strong>{inr(prev.amount_inr)}</strong>. Cost-per-visit figures for that month will change.</> : 'This is a new entry. Cost-per-visit figures for that month will update straight away.'}</p>
      </ConfirmDialog>
    </Card>
  );
}
