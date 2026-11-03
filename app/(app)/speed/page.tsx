'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EscalationLevel } from '@contracts/realestate-api';
import { Card, CardHeader } from '@/components/ui/card';
import { AttentionRail, LEVELS } from '@/components/app/attention-rail';
import { CardSkeleton, ChartCard, ErrorState, KpiCard, PageHeader, PeriodPicker, SOURCE_COLOR, chartTheme, usePeriod } from '@/components/app/shared';
import { useApi } from '@/lib/client/hooks';
import { SOURCE_LABEL, minutesHuman, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BUCKETS = [
  { max: 15, cls: 'bg-[color-mix(in_oklab,var(--good)_55%,var(--surface))]', label: 'Under 15 min' },
  { max: 30, cls: 'bg-[color-mix(in_oklab,var(--good)_28%,var(--surface))]', label: '15–30 min' },
  { max: 60, cls: 'bg-[color-mix(in_oklab,var(--warn)_30%,var(--surface))]', label: '30–60 min' },
  { max: 120, cls: 'bg-[color-mix(in_oklab,var(--warn)_65%,var(--surface))]', label: '1–2 hours' },
  { max: Infinity, cls: 'bg-[color-mix(in_oklab,var(--bad)_70%,var(--surface))]', label: 'Over 2 hours' },
];
const bucket = (m: number) => BUCKETS.find((b) => m <= b.max)!;

export default function SpeedPage() {
  const { period, days, setDays } = usePeriod(30);
  const speed = useApi('speed', period);
  const stale = useApi('stale', {}, { poll: 30_000 });
  const [level, setLevel] = useState<EscalationLevel | null>(null);
  const d = speed.data?.data;
  const o = d?.overall;

  const heat = new Map((d?.heatmap ?? []).map((c) => [`${c.weekday}-${c.hour}`, c]));
  const trend = (d?.breach_trend ?? []).map((t) => ({ ...t, label: t.date.slice(5), rate: t.leads ? Math.round((100 * t.breaches) / t.leads) : 0 }));

  return (
    <>
      <PageHeader title="Speed to lead" subtitle="The first call decides the sale. How quickly buyers are answered, by whom, and when it goes wrong." actions={<PeriodPicker days={days} setDays={setDays} />} />
      {speed.isError ? <ErrorState error={speed.error} onRetry={() => speed.refetch()} /> : (
        <>
          <section aria-label="Response speed" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {!o ? Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} rows={2} />) : (<>
              <KpiCard id="avg" label="Average first reply" value={o.avg_min} format={minutesHuman} hint="The mean can be pulled up by a few very late replies, so the median is shown too." />
              <KpiCard id="med" label="Typical (median) reply" value={o.median_min} format={minutesHuman} hint="Half of all buyers were answered faster than this." />
              <KpiCard id="w5" label="Answered within 5 min" value={o.pct_within_5} format={(n) => pct(n)} sparkColor="var(--good)" hint="Share of answered leads that got a first call within 5 minutes." />
              <KpiCard id="w30" label="Within 30 min" value={o.pct_within_30} format={(n) => pct(n)} hint="Share of answered leads contacted within half an hour." />
              <KpiCard id="w120" tone={o.breaches > 0 ? 'bad' : 'default'} label="Within 2 hours" value={o.pct_within_120} format={(n) => pct(n)} hint={`${o.breaches} lead(s) missed the 2-hour target or are still waiting.`} />
            </>)}
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="Who answers fastest" caption="Average minutes to first reply per agent. The dashed line is the 2-hour target." height={Math.max(220, (d?.by_agent.length ?? 5) * 46)}
              table={{ columns: ['Agent', 'Leads', 'Answered', 'Average (min)', 'Median (min)', 'Missed 2h'], rows: (d?.by_agent ?? []).map((a) => [a.agent_name, a.leads, a.responded, a.avg_min ?? '—', a.median_min ?? '—', a.breaches]) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(d?.by_agent ?? []).filter((a) => a.avg_min != null)} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke={chartTheme.grid} />
                  <XAxis type="number" tick={chartTheme.axis} tickFormatter={(v) => minutesHuman(v)} />
                  <YAxis type="category" dataKey="agent_name" width={110} tick={chartTheme.axis} />
                  <Tooltip {...chartTheme.tooltip} formatter={(v) => [minutesHuman(Number(v)), 'Average']} cursor={{ fill: 'var(--surface-2)' }} />
                  <ReferenceLine x={120} stroke="var(--bad)" strokeDasharray="4 4" />
                  <Bar dataKey="avg_min" radius={[0, 8, 8, 0]} barSize={22}>{(d?.by_agent ?? []).map((a, i) => <Cell key={i} fill={(a.avg_min ?? 0) > 60 ? 'var(--bad)' : (a.avg_min ?? 0) > 30 ? 'var(--warn)' : 'var(--brand)'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Which source is answered fastest" caption="Average minutes to first reply by where the lead came from." height={Math.max(220, (d?.by_source.length ?? 5) * 46)}
              table={{ columns: ['Source', 'Leads', 'Average (min)', 'Median (min)', 'Missed 2h'], rows: (d?.by_source ?? []).map((a) => [SOURCE_LABEL[a.source], a.leads, a.avg_min ?? '—', a.median_min ?? '—', a.breaches]) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(d?.by_source ?? []).map((s) => ({ ...s, name: SOURCE_LABEL[s.source] }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke={chartTheme.grid} />
                  <XAxis type="number" tick={chartTheme.axis} tickFormatter={(v) => minutesHuman(v)} />
                  <YAxis type="category" dataKey="name" width={100} tick={chartTheme.axis} />
                  <Tooltip {...chartTheme.tooltip} formatter={(v) => [minutesHuman(Number(v)), 'Average']} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="avg_min" radius={[0, 8, 8, 0]} barSize={22}>{(d?.by_source ?? []).map((s) => <Cell key={s.source} fill={SOURCE_COLOR[s.source]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard className="mt-6" title="When are buyers answered slowly?" caption="Average reply time by the day and hour the lead arrived (IST). Dark red cells are where leads wait longest." height={300}
            table={{ columns: ['Day', 'Hour', 'Leads', 'Average reply (min)'], rows: (d?.heatmap ?? []).sort((a, b) => a.weekday - b.weekday || a.hour - b.hour).map((c) => [WEEKDAYS[c.weekday], `${c.hour}:00`, c.leads, c.avg_min ?? '—']) }}>
            <div className="scroll-thin h-full overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="ml-12 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] text-center text-[10px] text-muted">{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : ''}</span>)}</div>
                {WEEKDAYS.map((w, wi) => (
                  <div key={w} className="mt-[3px] flex items-center gap-2">
                    <span className="w-10 text-right text-xs text-muted">{w}</span>
                    <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]" role="row">
                      {Array.from({ length: 24 }, (_, h) => {
                        const c = heat.get(`${wi}-${h}`);
                        const none = !c || c.avg_min == null;
                        return <span key={h} role="cell" title={none ? `${w} ${h}:00 – no answered leads` : `${w} ${h}:00 – ${minutesHuman(c.avg_min)} average, ${c.leads} lead${c.leads === 1 ? '' : 's'}`} className={cn('h-8 rounded-[5px]', none ? 'border border-dashed border-line' : bucket(c.avg_min!).cls)} />;
                      })}
                    </div>
                  </div>
                ))}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-xs text-muted">{BUCKETS.map((b) => <span key={b.label} className="inline-flex items-center gap-1.5"><span className={cn('size-3 rounded-[4px]', b.cls)} />{b.label}</span>)}<span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[4px] border border-dashed border-line" />No data</span></div>
              </div>
            </div>
          </ChartCard>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <ChartCard title="Missed-target trend" caption="Leads per day that were answered after 2 hours (or are still waiting). Line shows the share of that day's leads." height={260}
              table={{ columns: ['Date', 'Leads', 'Missed 2h', 'Share'], rows: trend.map((t) => [t.date, t.leads, t.breaches, `${t.rate}%`]) }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid vertical={false} stroke={chartTheme.grid} />
                  <XAxis dataKey="label" tick={chartTheme.axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="l" tick={chartTheme.axis} allowDecimals={false} />
                  <YAxis yAxisId="r" orientation="right" tick={chartTheme.axis} unit="%" />
                  <Tooltip {...chartTheme.tooltip} />
                  <Bar yAxisId="l" dataKey="breaches" name="Missed 2h" fill="var(--bad)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="r" dataKey="rate" name="Share of leads" stroke="var(--ink-2)" dot={false} strokeWidth={1.8} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <Card>
              <CardHeader title="The escalation ladder" caption="What happens automatically when nobody replies. Tap a step to see who is stuck there." />
              <ol className="space-y-2 p-5">
                {LEVELS.map((l) => {
                  const n = d?.escalation.find((e) => e.level === l.level)?.count ?? 0;
                  const on = level === l.level;
                  return (
                    <li key={l.level}>
                      <button onClick={() => setLevel(on ? null : l.level)} aria-pressed={on} className={cn('flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition', on ? 'border-bad bg-bad-soft' : 'border-line hover:bg-surface-2')}>
                        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold', l.step ? 'bg-bad text-white' : 'bg-warn-soft text-warn')}>{l.step || '·'}</span>
                        <span className="min-w-0 flex-1"><span className="block font-medium">{l.label}</span><span className="block text-[13px] leading-snug text-muted">{l.explain}</span></span>
                        <span className="tnum font-display text-2xl">{n}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </Card>
          </div>

          <div className="mt-6">
            <AttentionRail stale={(stale.data?.data ?? []).filter((s) => !level || s.level === level)} loading={stale.isLoading} max={8} title={level ? LEVELS.find((l) => l.level === level)!.label : 'Stuck right now'} caption={level ? 'Filtered by the step you picked above.' : 'Every lead currently flagged, most urgent first.'} />
          </div>
        </>
      )}
    </>
  );
}
