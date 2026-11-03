'use client';
import { motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SOURCES, type Source } from '@contracts/realestate-api';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { CardSkeleton, ChartCard, CountUp, ErrorState, PageHeader, PeriodPicker, SOURCE_COLOR, chartTheme, usePeriod } from '@/components/app/shared';
import { useApi } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { SOURCE_LABEL, STAGE_LABEL, num, pct } from '@/lib/format';
import { useState } from 'react';

export default function FunnelPage() {
  const { data: me } = useSession();
  const { period, days, setDays } = usePeriod(90);
  const [source, setSource] = useState<Source | ''>('');
  const [agent, setAgent] = useState('');
  const agents = useApi('agents', {}, { enabled: me?.role === 'owner' });
  const q = useApi('funnel', { ...period, source: source || undefined, agent_id: agent ? Number(agent) : undefined });
  const d = q.data?.data;
  const top = d?.stages[0]?.reached ?? 0;
  const won = d?.stages.at(-1)?.reached ?? 0;

  return (
    <>
      <PageHeader title="Where leads drop out" subtitle="From first enquiry to a closed deal. Each bar is the buyers who reached that step (junk leads are left out)."
        actions={<>
          <PeriodPicker days={days} setDays={setDays} />
          <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as Source | '')} className="w-auto"><option value="">All sources</option>{SOURCES.filter((s) => ['99acres', 'magicbricks', 'meta', 'website', 'referral'].includes(s)).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select>
          {me?.role === 'owner' && <Select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)} className="w-auto"><option value="">All agents</option>{(agents.data?.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
        </>}
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <CardSkeleton rows={8} /> : (
        <>
          <Card className="p-5 sm:p-6">
            <p className="text-[15px] text-ink-2">Of <strong className="tnum text-ink"><CountUp value={top} format={num} /></strong> real enquiries, <strong className="tnum text-good"><CountUp value={won} format={num} /></strong> became customers ({pct(top ? (won / top) * 100 : null, 1)}). {d.totals.junk} more were junk and {d.totals.closed_lost} were lost along the way.</p>
            <ol className="mt-5 space-y-3">
              {d.stages.map((s, i) => {
                const w = top ? (s.reached / top) * 100 : 0;
                return (
                  <li key={s.stage}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium">{STAGE_LABEL[s.stage]}{s.stage === 'closed_won' ? '' : ''}</span>
                      <span className="tnum text-muted">{i > 0 && s.conv_from_prev_pct != null && <><strong className="text-ink">{pct(s.conv_from_prev_pct, 1)}</strong> of the step before · </>}{pct(s.conv_from_top_pct, 1)} of all</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="h-11 flex-1 overflow-hidden rounded-xl bg-surface-2" role="img" aria-label={`${STAGE_LABEL[s.stage]}: ${s.reached} leads`}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(w, s.reached ? 1.5 : 0)}%` }} transition={{ duration: 0.9, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }} className="h-full rounded-xl" style={{ background: s.stage === 'closed_won' ? 'var(--good)' : `color-mix(in oklab, var(--brand) ${100 - i * 11}%, var(--brand-2))` }} />
                      </div>
                      <span className="tnum w-14 text-right font-display text-2xl">{num(s.reached)}</span>
                    </div>
                    {i > 0 && s.drop_off > 0 && <p className="mt-1 text-xs text-bad">▼ {num(s.drop_off)} dropped out before this step ({pct((s.drop_off / (d.stages[i - 1].reached || 1)) * 100)})</p>}
                  </li>
                );
              })}
            </ol>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="How long leads stay in each step" caption="Average days a lead spent in a step before moving on (only leads that moved on)." height={240}
              table={{ columns: ['Step', 'Average days', 'Sitting here now'], rows: d.stages.map((s) => [STAGE_LABEL[s.stage], s.avg_days_in_stage ?? '—', s.currently_in]) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.stages.slice(0, 5).map((s) => ({ name: STAGE_LABEL[s.stage], days: s.avg_days_in_stage ?? 0 }))} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid vertical={false} stroke={chartTheme.grid} />
                  <XAxis dataKey="name" tick={chartTheme.axis} interval={0} />
                  <YAxis tick={chartTheme.axis} unit="d" />
                  <Tooltip {...chartTheme.tooltip} formatter={(v) => [`${v} days`, 'Average']} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="days" fill="var(--brand)" radius={[8, 8, 0, 0]} barSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Why deals were lost" caption={`${d.totals.closed_lost} leads closed as lost, by the reason the agent gave.`} height={240}
              table={{ columns: ['Reason', 'Leads'], rows: d.lost_reasons.map((r) => [r.reason, r.count]) }}>
              {d.lost_reasons.length === 0 ? <p className="grid h-full place-items-center text-sm text-muted">No lost deals in this period.</p> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.lost_reasons} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke={chartTheme.grid} />
                    <XAxis type="number" tick={chartTheme.axis} allowDecimals={false} />
                    <YAxis type="category" dataKey="reason" width={150} tick={chartTheme.axis} />
                    <Tooltip {...chartTheme.tooltip} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="count" name="Leads" fill="var(--c2)" radius={[0, 8, 8, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <ChartCard className="mt-6" title="Junk rate by source" caption="Share of each source's enquiries that turned out fake, wrong numbers or not buyers." height={240}
            table={{ columns: ['Source', 'Leads', 'Junk', 'Junk rate'], rows: d.junk_by_source.map((j) => [SOURCE_LABEL[j.source], j.leads, j.junk, pct(j.junk_rate_pct, 1)]) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.junk_by_source.map((j) => ({ ...j, name: SOURCE_LABEL[j.source] }))} margin={{ left: -10, right: 8 }}>
                <CartesianGrid vertical={false} stroke={chartTheme.grid} />
                <XAxis dataKey="name" tick={chartTheme.axis} />
                <YAxis tick={chartTheme.axis} unit="%" />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => [`${v}%`, 'Junk rate']} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="junk_rate_pct" radius={[8, 8, 0, 0]} barSize={44}>{d.junk_by_source.map((j) => <Cell key={j.source} fill={SOURCE_COLOR[j.source]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <p className="sr-only"><CardHeader title="" /></p>
        </>
      )}
    </>
  );
}
