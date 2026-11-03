'use client';
import { Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AttentionRail } from '@/components/app/attention-rail';
import { useOverlays } from '@/components/app/overlays';
import { CardSkeleton, Delta, ErrorState, KpiCard, PageHeader, PeriodPicker, ScoreChip, SlaPill, SourceBadge, StageBadge, usePeriod } from '@/components/app/shared';
import { useApi } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { SOURCE_LABEL, inr, inrShort, minutesHuman, timeAgo } from '@/lib/format';
import { buildInsights } from '@/lib/insights';
import { addMonths, monthOf, istDate } from '@/lib/metrics';
import { cn } from '@/lib/utils';

export default function CommandCenter() {
  const { data: me } = useSession();
  const { period, days, setDays } = usePeriod(30);
  const owner = me?.role === 'owner';
  const overview = useApi('overview', period, { poll: 60_000 });
  const stale = useApi('stale', {}, { poll: 30_000 });
  const recent = useApi('leads', { page_size: 8, sort: 'created_desc' }, { poll: 30_000 });
  const speed = useApi('speed', period, { enabled: !!me });
  const roi = useApi('sourceRoi', { month: addMonths(monthOf(istDate(new Date())), -1).slice(0, 7) }, { enabled: owner });
  const lb = useApi('leaderboard', period, { enabled: me?.role === 'agent' });
  const { openLead } = useOverlays();

  const o = overview.data?.data;
  const insights = useMemo(
    () => (me ? buildInsights({ overview: o, roi: roi.data?.data, stale: stale.data?.data, speed: speed.data?.data, leaderboard: lb.data?.data, role: me.role }) : []),
    [o, roi.data, stale.data, speed.data, lb.data, me],
  );
  const s = o?.series ?? [];
  const t = o?.totals;
  const p = o?.previous;
  const spark = (k: keyof NonNullable<typeof o>['series'][number]) => s.map((d) => Number(d[k] ?? 0));
  const count = (n: number) => String(Math.round(n));

  return (
    <>
      <PageHeader
        title={owner ? 'Good day. Here is the brokerage.' : `Hello, ${me?.name?.split(' ')[0] ?? ''}`}
        subtitle={owner ? 'Every lead, how fast it was answered, and where the money goes, at a glance.' : 'Your leads, your response times and what needs a call right now.'}
        actions={<PeriodPicker days={days} setDays={setDays} />}
      />

      {insights.length > 0 && (
        <section aria-label="What stands out" className="mb-6 grid gap-2">
          {insights.map((i) => {
            const body = (
              <div className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-[15px] leading-snug', i.tone === 'bad' ? 'border-bad/30 bg-bad-soft text-ink' : i.tone === 'warn' ? 'border-warn/30 bg-warn-soft text-ink' : i.tone === 'good' ? 'border-good/30 bg-good-soft text-ink' : 'border-line bg-surface text-ink')}>
                <Lightbulb className={cn('mt-0.5 size-[18px] shrink-0', i.tone === 'bad' ? 'text-bad' : i.tone === 'warn' ? 'text-warn' : i.tone === 'good' ? 'text-good' : 'text-muted')} aria-hidden />
                <span>{i.text}</span>
              </div>
            );
            return i.href ? <Link key={i.id} href={i.href} className="block transition hover:opacity-90">{body}</Link> : <div key={i.id}>{body}</div>;
          })}
        </section>
      )}

      {overview.isError ? <ErrorState error={overview.error} onRetry={() => overview.refetch()} /> : (
        <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {!t || !p ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} rows={2} />) : (
            <>
              <KpiCard id="new" label="New leads" value={t.new_leads} format={count} spark={spark('new_leads')} delta={<Delta cur={t.new_leads} prev={p.new_leads} />} hint="Every enquiry captured from all sources in this period." />
              <KpiCard id="resp" label="Average first reply" value={t.avg_first_response_min} format={(n) => minutesHuman(n)} spark={spark('avg_first_response_min')} delta={<Delta cur={t.avg_first_response_min} prev={p.avg_first_response_min} lowerIsBetter />} hint="Time from the lead arriving to the first call or follow-up by an agent." />
              <KpiCard id="breach" tone={t.breaching_sla > 0 ? 'bad' : 'default'} label="Missed the 2-hour target" value={t.breaching_sla} format={count} spark={spark('breaching_sla')} delta={<Delta cur={t.breaching_sla} prev={p.breaching_sla} lowerIsBetter />} hint="Leads first answered after 2 hours, or still waiting after 2 hours." />
              <KpiCard id="hot" label="Hot leads still open" value={t.hot_open} format={count} spark={spark('hot_open')} delta={<Delta cur={t.hot_open} prev={p.hot_open} />} hint="Open leads scored hot, as of the end of the period." />
              <KpiCard id="visits" label="Site visits booked" value={t.visits_booked} format={count} spark={spark('visits_booked')} delta={<Delta cur={t.visits_booked} prev={p.visits_booked} />} hint="Bookings made in this period." />
              <KpiCard id="won" label="Deals closed" value={t.closures} format={count} spark={spark('closures')} sparkColor="var(--good)" delta={<Delta cur={t.closures} prev={p.closures} />} hint="Leads marked closed – won in this period." />
              {owner ? (
                <KpiCard id="spend" label="Portal and ad spend" value={t.spend_inr} format={(n) => inrShort(n)} spark={spark('spend_inr')} sparkColor="var(--c4)" delta={<Delta cur={t.spend_inr} prev={p.spend_inr} />} hint="Monthly costs, spread across the days of the period." />
              ) : (
                <KpiCard id="done" label="Visits done" value={t.visits_done} format={count} delta={<Delta cur={t.visits_done} prev={p.visits_done} />} />
              )}
              {owner ? (
                <Card className="flex h-full flex-col justify-between gap-2 p-4">
                  <p className="text-[13px] font-medium text-muted">Cost per site visit</p>
                  {o?.best_source ? (
                    <div className="space-y-2">
                      <div><p className="text-xs text-good">Best</p><p className="font-display text-[22px] leading-tight">{SOURCE_LABEL[o.best_source.source]} <span className="tnum text-ink-2">{inr(o.best_source.cost_per_site_visit)}</span></p></div>
                      {o.worst_source && <div><p className="text-xs text-bad">Worst</p><p className="font-display text-[22px] leading-tight">{SOURCE_LABEL[o.worst_source.source]} <span className="tnum text-ink-2">{inr(o.worst_source.cost_per_site_visit)}</span></p></div>}
                    </div>
                  ) : <p className="text-sm text-muted">Not enough costs entered yet.</p>}
                  <Link href="/roi" className="text-xs font-medium text-brand underline-offset-2 hover:underline">See Source ROI →</Link>
                </Card>
              ) : <KpiCard id="med" label="Median first reply" value={t.median_first_response_min} format={(n) => minutesHuman(n)} delta={<Delta cur={t.median_first_response_min} prev={p.median_first_response_min} lowerIsBetter />} />}
            </>
          )}
        </section>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        {stale.isError ? <ErrorState error={stale.error} onRetry={() => stale.refetch()} /> : <AttentionRail stale={stale.data?.data ?? []} loading={stale.isLoading} />}

        <Card>
          <CardHeader title="Latest enquiries" caption="Newest first. Tap a row for the full story." action={<Link href="/leads" className="shrink-0 text-sm font-medium text-brand hover:underline">All leads →</Link>} />
          <ul className="mt-2 divide-y divide-line">
            {recent.isLoading && Array.from({ length: 6 }).map((_, i) => <li key={i} className="px-5 py-3"><Skeleton className="h-10" /></li>)}
            {recent.isError && <li className="p-4"><ErrorState error={recent.error} onRetry={() => recent.refetch()} /></li>}
            {recent.data?.data.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted">No leads yet.</li>}
            {recent.data?.data.map((l) => (
              <li key={l.id}>
                <button onClick={() => openLead(l.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate font-medium">{l.name ?? 'Unnamed lead'}</span><ScoreChip score={l.score} /></span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><SourceBadge source={l.source} /> · {timeAgo(l.created_at)} · {l.assigned_agent_name ?? 'Unassigned'}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><SlaPill responseMin={l.minutes_to_first_response} sinceCreatedMin={l.minutes_since_created} /><StageBadge stage={l.stage} /></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted">Showing {period.from} to {period.to} (IST), compared with the {Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000) + 1} days before. <Badge tone="outline">Refreshes automatically</Badge></p>
    </>
  );
}
