'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Clock, Footprints, Phone, Target, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { LeaderboardRow } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import { CardSkeleton, EmptyState, ErrorState, PageHeader, PeriodPicker, usePeriod } from '@/components/app/shared';
import { useApi } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { minutesHuman, pct } from '@/lib/format';
import { needsCoaching } from '@/lib/metrics';
import { cn } from '@/lib/utils';

const MEDAL = ['🥇', '🥈', '🥉'];
const SORTS = {
  rank: { label: 'Overall rank', fn: (a: LeaderboardRow, b: LeaderboardRow) => a.rank - b.rank },
  visits: { label: 'Visits booked', fn: (a: LeaderboardRow, b: LeaderboardRow) => b.visits_booked - a.visits_booked },
  speed: { label: 'Fastest reply', fn: (a: LeaderboardRow, b: LeaderboardRow) => (a.avg_first_response_min ?? 1e9) - (b.avg_first_response_min ?? 1e9) },
  conv: { label: 'Conversion %', fn: (a: LeaderboardRow, b: LeaderboardRow) => (b.conversion_pct ?? -1) - (a.conversion_pct ?? -1) },
  followups: { label: 'Follow-ups', fn: (a: LeaderboardRow, b: LeaderboardRow) => b.follow_ups_done - a.follow_ups_done },
} as const;

export default function LeaderboardPage() {
  const { data: me } = useSession();
  const { period, days, setDays } = usePeriod(30);
  const q = useApi('leaderboard', period);
  const speed = useApi('speed', period);
  const [sort, setSort] = useState<keyof typeof SORTS>('rank');
  const [open, setOpen] = useState<LeaderboardRow | null>(null);
  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const sorted = useMemo(() => [...rows].sort(SORTS[sort].fn), [rows, sort]);
  const coach = needsCoaching(rows);
  const owner = me?.role === 'owner';

  return (
    <>
      <PageHeader title={owner ? 'Agent leaderboard' : 'How you are doing'} subtitle={owner ? 'Ranked by deals closed, then site visits booked, then follow-ups. Switch the order to see who is best at what.' : 'Your rank and numbers for the period.'}
        actions={<><PeriodPicker days={days} setDays={setDays} />{owner && <Select aria-label="Order by" value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} className="w-auto">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Order: {v.label}</option>)}</Select>}</>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <CardSkeleton rows={6} /> : rows.length === 0 ? <Card><EmptyState title="No activity yet" body="Rankings appear once agents start logging calls and visits." /></Card> : (
        <ol className="space-y-3">
          <AnimatePresence initial={false}>
            {sorted.map((r) => {
              const slow = r.agent_id === coach;
              return (
                <motion.li key={r.agent_id} layout transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
                  <Card className={cn('p-4 sm:p-5', slow && 'border-warn/50')}>
                    <button onClick={() => setOpen(r)} className="block w-full text-left" aria-label={`${r.name}, rank ${r.rank}. Open details`}>
                      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-2 font-display text-2xl" aria-hidden>{r.rank <= 3 ? MEDAL[r.rank - 1] : `#${r.rank}`}</span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-[18px] font-medium">{r.name}{!owner && <Badge tone="brand">You</Badge>}<span className="sr-only">Rank {r.rank}</span>
                            {slow && <Tip content="Replies far slower than the rest of the team. A coaching chat would help."><Badge tone="warn" className="cursor-help"><AlertTriangle className="size-3" /> Needs coaching</Badge></Tip>}
                            {r.stale_count >= 5 && <Badge tone="bad">{r.stale_count} leads going stale</Badge>}
                          </p>
                          <p className="text-[13px] text-muted">{r.open_leads} open leads · {r.leads_assigned} assigned this period</p>
                        </div>
                        <dl className="grid w-full grid-cols-3 gap-x-5 gap-y-2 sm:w-auto sm:grid-cols-6">
                          <Metric icon={Target} label="Deals closed" value={String(r.conversions)} strong />
                          <Metric icon={Footprints} label="Visits booked" value={String(r.visits_booked)} />
                          <Metric icon={Phone} label="Follow-ups" value={String(r.follow_ups_done)} />
                          <Metric icon={Clock} label="First reply" value={r.avg_first_response_min == null ? '—' : minutesHuman(r.avg_first_response_min)} bad={slow} />
                          <Metric icon={UserRound} label="Conversion" value={pct(r.conversion_pct, 1)} />
                          <Metric icon={AlertTriangle} label="Going stale" value={String(r.stale_count)} bad={r.stale_count >= 5} />
                        </dl>
                      </div>
                    </button>
                  </Card>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent title={open?.name ?? ''} description={open ? `Rank #${open.rank} · ${period.from} to ${period.to}` : undefined}>
          {open && (() => {
            const sp = speed.data?.data.by_agent.find((a) => a.agent_id === open.agent_id);
            return (
              <DialogBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-[15px]">
                  {[['Deals closed', open.conversions], ['Visits booked', open.visits_booked], ['Visits done', open.visits_done], ['Follow-ups logged', open.follow_ups_done], ['Leads assigned', open.leads_assigned], ['Open leads now', open.open_leads], ['Average first reply', open.avg_first_response_min == null ? '—' : minutesHuman(open.avg_first_response_min)], ['Typical (median) reply', sp?.median_min == null ? '—' : minutesHuman(sp.median_min)], ['Missed 2-hour target', sp ? sp.breaches : '—'], ['Conversion', pct(open.conversion_pct, 1)], ['Going stale now', open.stale_count]].map(([k, v]) => (
                    <div key={String(k)} className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">{k}</dt><dd className="tnum font-display text-2xl">{v}</dd></div>
                  ))}
                </dl>
                <p className="text-sm text-ink-2">Conversion is deals closed divided by leads assigned in the period. Younger leads haven&apos;t had time to close yet, so compare agents over the same period.</p>
                {owner && <Button asChild variant="outline"><Link href={`/leads?agent_id=${open.agent_id}`}>See {open.name.split(' ')[0]}&apos;s leads</Link></Button>}
              </DialogBody>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({ icon: Icon, label, value, strong, bad }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; strong?: boolean; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted"><Icon className="size-3" aria-hidden />{label}</dt>
      <dd className={cn('tnum font-display text-[22px] leading-tight', strong && 'text-brand', bad && 'text-bad')}>{value}</dd>
    </div>
  );
}
