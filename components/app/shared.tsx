'use client';
import { animate, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Eye, EyeOff, Inbox, Minus, RefreshCw, Table2, BarChart3 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { Score, Source, Stage } from '@contracts/realestate-api';
import { ApiError, ContractError } from '@/lib/api-error';
import { addDays, defaultPeriod, type Period } from '@/lib/metrics';
import { SCORE_LABEL, SOURCE_LABEL, STAGE_LABEL, fullPhone, maskPhone, minutesHuman } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tip } from '@/components/ui/tooltip';

export const SOURCE_COLOR: Record<string, string> = {
  '99acres': 'var(--c1)', magicbricks: 'var(--c2)', meta: 'var(--c3)', website: 'var(--c4)', referral: 'var(--c5)', walk_in: 'var(--c6)', crm: 'var(--c7)', other: 'var(--c8)',
};
const SOURCE_MARK: Record<string, string> = { '99acres': '99', magicbricks: 'MB', meta: 'f', website: 'W', referral: 'R', walk_in: 'WI', crm: 'C', other: '?' };

export function SourceBadge({ source, className }: { source: Source; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-2', className)}>
      <span aria-hidden className="grid h-5 min-w-5 place-items-center rounded-md px-1 text-[10px] font-bold text-white" style={{ background: SOURCE_COLOR[source] }}>{SOURCE_MARK[source]}</span>
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function ScoreChip({ score, reason, className }: { score: Score | null; reason?: string | null; className?: string }) {
  if (!score) return <Badge>Not scored</Badge>;
  const tone = score === 'hot' ? 'bad' : score === 'warm' ? 'warn' : 'neutral';
  const chip = (
    <Badge tone={tone} className={cn('cursor-default', score === 'cold' && 'bg-[color-mix(in_oklab,var(--cold)_14%,transparent)] text-cold', className)}>
      <span aria-hidden>{score === 'hot' ? '▲' : score === 'warm' ? '◆' : '▽'}</span>
      {SCORE_LABEL[score]}
    </Badge>
  );
  return reason ? <Tip content={reason}>{chip}</Tip> : chip;
}

export function StageBadge({ stage }: { stage: Stage }) {
  const tone = stage === 'closed_won' ? 'good' : stage === 'closed_lost' || stage === 'junk' ? 'neutral' : stage === 'new' ? 'outline' : 'brand';
  return <Badge tone={tone}>{STAGE_LABEL[stage]}</Badge>;
}

/** Time to first response against the SLA: green / amber / red, always with text and an icon shape. */
export function SlaPill({ responseMin, sinceCreatedMin, sla = 120 }: { responseMin: number | null; sinceCreatedMin: number; sla?: number }) {
  if (responseMin == null) {
    const waiting = sinceCreatedMin;
    const tone = waiting > sla ? 'bad' : waiting > sla / 2 ? 'warn' : 'neutral';
    return <Tip content="No agent has contacted this buyer yet."><Badge tone={tone}>⏳ Waiting {minutesHuman(waiting)}</Badge></Tip>;
  }
  const tone = responseMin <= 30 ? 'good' : responseMin <= sla ? 'warn' : 'bad';
  const icon = tone === 'good' ? '●' : tone === 'warn' ? '◐' : '▲';
  return (
    <Tip content={tone === 'good' ? 'Answered within 30 minutes.' : tone === 'warn' ? 'Answered, but slower than 30 minutes.' : `Answered after the ${minutesHuman(sla)} target.`}>
      <Badge tone={tone}>{icon} {minutesHuman(responseMin)}</Badge>
    </Tip>
  );
}

export function PhoneReveal({ phone, className }: { phone: string | null; className?: string }) {
  const [shown, setShown] = useState(false);
  if (!phone) return <span className="text-muted">No phone</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 tnum', className)}>
      <span>{shown ? fullPhone(phone) : maskPhone(phone)}</span>
      <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide phone number' : 'Show phone number'} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] leading-[1.1] text-ink sm:text-[36px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon ?? <Inbox className="size-6" />}</div>
      <p className="font-display text-lg text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : new ApiError(500, 'Something went wrong. Please try again.');
  const contract = e instanceof ContractError;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-2xl border border-bad/30 bg-bad-soft px-6 py-10 text-center">
      <AlertTriangle className="size-7 text-bad" />
      <p className="font-display text-lg text-ink">{contract ? 'The data came back in an unexpected shape' : 'We could not load this'}</p>
      <p className="max-w-lg text-sm text-ink-2">{e.message}</p>
      {contract && (
        <ul className="mt-1 max-w-lg list-disc text-left text-xs text-ink-2">
          {(e as ContractError).issues.slice(0, 4).map((i, k) => <li key={k}><code>{i.path || '(root)'}</code>: {i.message}</li>)}
        </ul>
      )}
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry} className="mt-2"><RefreshCw className="size-4" /> Try again</Button>}
    </div>
  );
}

export function CardSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Card className={cn('space-y-3 p-5', className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-4" />)}
    </Card>
  );
}

export function CountUp({ value, format = (n: number) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const c = animate(prev.current, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(v) });
    prev.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <span className={cn('tnum', className)}>{format(shown)}</span>;
}

export function Sparkline({ data, color = 'var(--brand)', id }: { data: number[]; color?: string; id: string }) {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div aria-hidden className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#g-${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Change vs the previous period. `lowerIsBetter` flips the colour (e.g. response time). */
export function Delta({ cur, prev, lowerIsBetter, unit = '' }: { cur: number | null; prev: number | null; lowerIsBetter?: boolean; unit?: string }) {
  if (cur == null || prev == null) return <span className="text-xs text-muted">no earlier data</span>;
  const diff = cur - prev;
  const pctChange = prev === 0 ? null : (diff / prev) * 100;
  if (Math.abs(diff) < 0.05) return <span className="inline-flex items-center gap-1 text-xs text-muted"><Minus className="size-3.5" /> same as before</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', good ? 'text-good' : 'text-bad')}>
      <Icon className="size-3.5" aria-hidden />
      {pctChange == null ? `${diff > 0 ? '+' : ''}${Math.round(diff)}${unit}` : `${Math.abs(Math.round(pctChange))}%`}
      <span className="font-normal text-muted">{diff > 0 ? 'more' : 'less'} than before</span>
    </span>
  );
}

export function KpiCard({ label, value, format, delta, spark, sparkColor, tone, hint, id }: {
  label: string; value: number | null; format?: (n: number) => string; delta?: ReactNode; spark?: number[]; sparkColor?: string; tone?: 'default' | 'bad'; hint?: string; id: string;
}) {
  const body = (
    <Card className={cn('flex h-full flex-col justify-between gap-2 p-4', tone === 'bad' && 'border-bad/40 bg-[color-mix(in_oklab,var(--bad)_5%,var(--surface))]')}>
      <div>
        <p className={cn('text-[13px] font-medium', tone === 'bad' ? 'text-bad' : 'text-muted')}>{label}</p>
        <p className="font-display mt-1 text-[34px] leading-none text-ink">{value == null ? '—' : <CountUp value={value} format={format} />}</p>
      </div>
      <div className="space-y-1">
        {spark && spark.length > 1 && <Sparkline id={id} data={spark} color={sparkColor ?? (tone === 'bad' ? 'var(--bad)' : 'var(--brand)')} />}
        {delta}
      </div>
    </Card>
  );
  return hint ? <Tip content={hint}>{body}</Tip> : body;
}

/** A chart with a one-line caption and a "view as table" toggle. */
export function ChartCard({ title, caption, children, table, action, className, height = 260 }: {
  title: string; caption: string; children: ReactNode; table: { columns: string[]; rows: (string | number)[][] }; action?: ReactNode; className?: string; height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={title}
        caption={caption}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {action}
            <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} aria-label={asTable ? 'View as chart' : 'View as table'}>
              {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
              <span className="hidden sm:inline">{asTable ? 'Chart' : 'Table'}</span>
            </Button>
          </div>
        }
      />
      <div className="px-3 pb-4 pt-3 sm:px-5" style={{ minHeight: height }}>
        {asTable ? (
          <div className="scroll-thin max-h-[320px] overflow-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>{table.columns.map((c) => <th key={c} scope="col" className="px-3 py-2 font-medium">{c}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="tnum px-3 py-2">{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </Card>
  );
}

/** 7 / 30 / 90 day picker. */
export function usePeriod(initialDays = 30): { period: Period; days: number; setDays: (d: number) => void } {
  const [days, setDays] = useState(initialDays);
  const [now] = useState(() => new Date());
  return { period: defaultPeriod(now, days), days, setDays };
}
export function PeriodPicker({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  return (
    <div role="group" aria-label="Time period" className="inline-flex rounded-xl bg-surface-2 p-1">
      {[7, 30, 90].map((d) => (
        <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={cn('h-9 rounded-lg px-3 text-sm font-medium transition', days === d ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {d === 7 ? '7 days' : d === 30 ? '30 days' : '90 days'}
        </button>
      ))}
    </div>
  );
}
export { addDays };

export const chartTheme = {
  grid: 'var(--line)',
  axis: { fontSize: 12, fill: 'var(--muted)' },
  tooltip: { contentStyle: { background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12, color: 'var(--ink)', fontSize: 13, boxShadow: 'var(--shadow)' }, labelStyle: { color: 'var(--muted)' } },
};
