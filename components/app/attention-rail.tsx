'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, MessageCircle, Phone, Shuffle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EscalationLevel, StaleLead } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Tip } from '@/components/ui/tooltip';
import { useSession } from '@/lib/client/session';
import { minutesHuman, telHref, waHref } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOverlays } from './overlays';
import { EmptyState, SOURCE_COLOR, ScoreChip } from './shared';

export const LEVELS: { level: EscalationLevel; label: string; step: number; explain: string }[] = [
  { level: 'agent_nudged', label: 'Agent nudged', step: 1, explain: 'No reply after 2 hours. The agent was reminded on WhatsApp.' },
  { level: 'owner_escalated', label: 'Owner alerted', step: 2, explain: 'No reply after 3 hours. You were alerted on WhatsApp.' },
  { level: 'auto_reassigned', label: 'Auto-reassigned', step: 3, explain: 'No reply after 4 hours. The lead was moved to another agent, who is now also running late.' },
  { level: 'inactive', label: 'Gone quiet', step: 0, explain: 'The lead was contacted but nobody has followed up for longer than allowed.' },
];

export function Ladder({ level }: { level: EscalationLevel }) {
  const step = LEVELS.find((l) => l.level === level)!.step;
  if (!step) return <Badge tone="warn">Gone quiet</Badge>;
  return (
    <Tip content={LEVELS[step - 1].explain}>
      <span className="inline-flex items-center gap-1.5" role="img" aria-label={`Escalation step ${step} of 3: ${LEVELS[step - 1].label}`}>
        {[1, 2, 3].map((i) => <span key={i} className={cn('h-1.5 w-5 rounded-full', i <= step ? 'bg-bad' : 'bg-line-strong')} />)}
        <span className="text-xs font-medium text-bad">{LEVELS[step - 1].label}</span>
      </span>
    </Tip>
  );
}

export function AttentionRail({ stale, loading, max = 6, title = 'Needs attention now', caption }: { stale: StaleLead[]; loading?: boolean; max?: number; title?: string; caption?: string }) {
  const { openLead, openReassign } = useOverlays();
  const { data: me } = useSession();
  const [showAll, setShowAll] = useState(false);
  const seen = useRef<Set<number> | null>(null);
  const [pulse, setPulse] = useState(false);

  // pulse the rail when a lead we have not seen before turns stale
  useEffect(() => {
    if (loading) return;
    const ids = new Set(stale.map((s) => s.lead_id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) { setPulse(true); const t = setTimeout(() => setPulse(false), 5200); seen.current = ids; return () => clearTimeout(t); }
    seen.current = ids;
  }, [stale, loading]);

  const rows = showAll ? stale : stale.slice(0, max);
  return (
    <Card className={cn('overflow-hidden border-bad/40', pulse && 'rail-pulse')}>
      <div className="border-b border-bad/25 bg-bad-soft">
        <CardHeader
          title={<span className="flex items-center gap-2 text-bad"><AlertTriangle className="size-5" aria-hidden /> {title}{stale.length > 0 && <span className="tnum rounded-full bg-bad px-2 py-0.5 font-sans text-sm text-white">{stale.length}</span>}</span>}
          caption={caption ?? 'Leads where a buyer is waiting or has gone quiet. Most urgent first.'}
          className="pb-4"
        />
      </div>
      {!loading && stale.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-6 text-good" />} title="Nothing is slipping" body="Every lead has been answered in time and is being followed up." />
      ) : (
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {rows.map((s) => (
              <motion.li key={s.lead_id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <button onClick={() => openLead(s.lead_id)} className="min-w-0 flex-1 rounded-lg text-left">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: SOURCE_COLOR[s.source] }} aria-hidden />
                    <span className="truncate text-[16px] font-medium">{s.name ?? 'Unnamed lead'}</span>
                    <ScoreChip score={s.score} />
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                    <span className="font-medium text-ink-2">{s.level === 'inactive' ? `Quiet for ${s.idle_days} day${s.idle_days === 1 ? '' : 's'}` : `Waiting ${minutesHuman(s.minutes_waiting)}`}</span>
                    <span>with {s.agent_name ?? 'nobody'}</span>
                    <Ladder level={s.level} />
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {me?.role === 'owner' && <Button variant="outline" size="sm" onClick={() => openReassign({ leadId: s.lead_id, leadName: s.name, currentAgentId: s.agent_id })} aria-label={`Reassign ${s.name ?? 'lead'}`}><Shuffle className="size-4" /><span className="sm:hidden lg:inline">Reassign</span></Button>}
                  {s.phone && <Button asChild variant="outline" size="sm" aria-label={`Call ${s.name ?? 'lead'}`}><a href={telHref(s.phone)}><Phone className="size-4" /></a></Button>}
                  {s.phone && <Button asChild variant="soft" size="sm" aria-label={`WhatsApp ${s.name ?? 'lead'}`}><a href={waHref(s.phone)} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /></a></Button>}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {stale.length > max && <div className="border-t border-line p-3 text-center"><Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${stale.length}`}</Button></div>}
    </Card>
  );
}
