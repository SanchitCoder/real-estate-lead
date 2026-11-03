'use client';
import { CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Mail, MessageSquare, PlayCircle, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AGENT_COMMANDS, GET_ENDPOINTS, TEST_SCENARIOS, endpoints, legacyWebhooks, type EndpointKey, type TestResponse } from '@contracts/realestate-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/app/shared';
import { ModeBadge } from '@/components/app/shell';
import { api } from '@/lib/client/api';
import { useAction, useApi } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { labelFor } from '@/lib/config-labels';
import { buildDigest } from '@/lib/digest';
import { istTime } from '@/lib/format';
import { ApiError, ContractError } from '@/lib/api-error';
import { addDays, addMonths, defaultPeriod, istDate, monthOf } from '@/lib/metrics';
import { cn } from '@/lib/utils';

export default function SystemPage() {
  const { data: me } = useSession();
  return (
    <>
      <PageHeader title="System" subtitle="The rules the automation follows, a way to test it safely, and a health check on the connection." actions={<ModeBadge />} />
      <Tabs defaultValue="rules">
        <TabsList className="scroll-thin mb-5 max-w-full overflow-x-auto">
          {[['rules', 'Rules'], ['commands', 'WhatsApp commands'], ['digest', 'Daily digest'], ['tests', 'Test runner'], ['health', 'Connection check'], ['errors', 'Errors']].map(([v, l]) => <TabsTrigger key={v} value={v} className="shrink-0">{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="rules"><Rules mode={me?.mode} /></TabsContent>
        <TabsContent value="commands"><Commands /></TabsContent>
        <TabsContent value="digest"><DigestPreview /></TabsContent>
        <TabsContent value="tests"><TestRunner /></TabsContent>
        <TabsContent value="health"><Health /></TabsContent>
        <TabsContent value="errors"><Errors /></TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------------------------------------------ rules */
function Rules({ mode }: { mode?: string }) {
  const q = useApi('config', {});
  const groups = useMemo(() => {
    const g = new Map<string, { key: string; value?: unknown; description: string | null }[]>();
    for (const r of q.data?.data ?? []) {
      if (typeof r.value === 'object' && r.value !== null) continue;
      if (/^tpl_|^wa_|^business_whatsapp/.test(r.key)) continue;
      const grp = labelFor(r.key).group;
      g.set(grp, [...(g.get(grp) ?? []), r]);
    }
    return [...g.entries()];
  }, [q.data]);
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <p className="text-[15px] text-ink-2">{mode === 'live' ? <>You are looking at <strong>live data</strong> from the automation workflow.</> : <>You are looking at <strong>sample data</strong>: a made-up brokerage called Skyline Realty. Nothing here touches real leads. To switch to live data, set <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">NEXT_PUBLIC_DATA_MODE=live</code> in the environment and restart. No other change is needed.</>}</p>
      </Card>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <CardSkeleton rows={8} /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups.map(([g, rows]) => (
            <Card key={g}>
              <CardHeader title={g} caption={g === 'Money' ? 'Used by the Source ROI page and the monthly report.' : undefined} />
              <dl className="mt-2 divide-y divide-line px-5 pb-3">
                {rows.map((r) => { const l = labelFor(r.key); return (
                  <div key={r.key} className="flex items-start justify-between gap-4 py-3 text-[15px]">
                    <dt className="text-ink-2" title={r.description ?? undefined}>{l.label}</dt>
                    <dd className="text-right font-medium">{l.format ? l.format(r.value) : String(r.value)}</dd>
                  </div>); })}
              </dl>
            </Card>
          ))}
        </div>
      )}
      <p className="text-sm text-muted">These are read-only here. They are kept in one table in the database (<code>config</code>) so every part of the automation uses the same numbers.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ commands */
function Commands() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader title="What agents can send on WhatsApp" caption="Message these to the business number. The number after the command is the lead number shown in the app." />
        <ul className="mt-3 divide-y divide-line px-5 pb-3">
          {AGENT_COMMANDS.map((c) => (
            <li key={c.cmd} className="py-3"><code className="rounded-lg bg-surface-2 px-2 py-1 font-mono text-[13px]">{c.cmd}</code><p className="mt-1.5 text-[14px] text-ink-2">{c.does}</p></li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Where leads come in" caption="These addresses stay the same, so portals and forms need no changes." />
        <ul className="mt-3 divide-y divide-line px-5 pb-3 text-[14px]">
          {legacyWebhooks.map((w) => <li key={w.path} className="py-3"><p className="font-medium">{w.name}</p><p className="text-muted"><code>{w.method} …/{w.path}</code> · {w.auth}</p></li>)}
          <li className="py-3"><p className="font-medium">Meta Lead Ads, 99acres &amp; MagicBricks emails, WhatsApp</p><p className="text-muted">Connected inside the workflow (no address to configure).</p></li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ digest */
function DigestPreview() {
  const now = useMemo(() => new Date(), []);
  const y = addDays(istDate(now), -1);
  const p = defaultPeriod(now, 30);
  const leads = useApi('leads', { from: y, to: y, page_size: 200 });
  const stale = useApi('stale', {});
  const speed = useApi('speed', p);
  const lb = useApi('leaderboard', p);
  const cm = monthOf(istDate(now));
  const roiNow = useApi('sourceRoi', { month: cm.slice(0, 7) });
  const roiPrev = useApi('sourceRoi', { month: addMonths(cm, -1).slice(0, 7) });
  const ready = leads.data && stale.data && speed.data && lb.data && roiNow.data && roiPrev.data;
  const roi = roiNow.data?.data.rows.some((r) => r.cost_inr > 0) ? roiNow.data?.data : undefined; // like the real digest: this month only
  const digest = useMemo(() => {
    if (!ready) return null;
    const bySource = new Map<string, number>();
    for (const l of leads.data!.data) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
    return buildDigest({ dateLabel: istTime(`${y}T12:00:00+05:30`).split(',')[0], leadsBySource: [...bySource].map(([source, n]) => ({ source, leads: n })), stale: stale.data!.data, speed: speed.data!.data, leaderboard: lb.data!.data, roi });
  }, [ready, leads.data, stale.data, speed.data, lb.data, roi, y]);
  const err = [leads, stale, speed, lb, roiNow].find((x) => x.isError);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="lg:col-span-2 p-5 text-[15px] text-ink-2">This is what the owner receives every morning at 9:00 am IST on WhatsApp and email. It is built from the live numbers on this page, using the same wording as the automation.</Card>
      {err ? <div className="lg:col-span-2"><ErrorState error={err.error} /></div> : !digest ? <CardSkeleton rows={6} /> : (<>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><MessageSquare className="size-5 text-good" /> WhatsApp</span>} caption="Template: owner_daily_digest" />
          <div className="p-5">
            <div className="rounded-2xl rounded-tl-sm bg-[#d9fdd3] p-4 text-[15px] leading-relaxed text-[#111b21] shadow-sm dark:bg-[#144d37] dark:text-[#e9edef]">
              <p className="font-semibold">Daily digest · {digest.date_label}</p>
              <p className="mt-2"><strong>New leads:</strong> {digest.wa_leads}</p>
              <p className="mt-1"><strong>Speed:</strong> {digest.wa_stale}</p>
              <p className="mt-1"><strong>Agents:</strong> {digest.wa_agents}</p>
              <p className="mt-1"><strong>Cost per site visit:</strong> {digest.wa_cost}</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Mail className="size-5 text-brand" /> Email</span>} caption="Same facts, with tables." />
          <div className="space-y-2 p-5 text-[15px]"><p className="text-muted">Subject</p><p className="rounded-xl bg-surface-2 p-3 font-medium">{digest.email_subject}</p><p className="text-sm text-muted">The email body adds a table of leads by source, the most-stale leads (name, agent, stage, hours old) and a cost-per-visit table by portal.</p></div>
        </Card>
      </>)}
    </div>
  );
}

/* ------------------------------------------------------------------ tests */
const SCENARIO_HELP: Record<string, string> = {
  portal_email_lead: 'A 99acres enquiry email arrives. Goes through email reading, scoring, agent assignment and the instant WhatsApp reply.',
  meta_lead: 'A Facebook / Instagram lead form is submitted.',
  referral_form: 'A referral is typed into the referral & walk-in form.',
  duplicate_lead: 'The same buyer enquires twice. Only one lead should exist and a repeat enquiry is logged.',
  stale_lead_escalation: 'A lead nobody answers for 4+ hours: agent nudged, owner alerted, then moved to another agent.',
  visit_booking: 'A lead is called, qualified and a site visit is booked. Calendar event and reminders are created.',
  listing_match: 'A new listing is added with three matching buyers. Real buyers are never matched to test listings.',
  cost_entry: 'A monthly cost is entered through the cost form.',
  cleanup: 'Removes every record marked as a test, including their events and matches.',
};
function TestRunner() {
  const [scenario, setScenario] = useState<(typeof TEST_SCENARIOS)[number]>('portal_email_lead');
  const [confirm, setConfirm] = useState(false);
  const [log, setLog] = useState<TestResponse[]>([]);
  const run = useAction('runTest', { onDone: (r) => { setLog((l) => [r.data, ...l]); setConfirm(false); } });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><FlaskConical className="size-5" /> Run a test</span>} caption="Test data goes through the same steps as a real lead, then is marked as a test so it never counts in your reports." />
        <div className="space-y-4 p-5">
          <Select aria-label="Scenario" value={scenario} onChange={(e) => setScenario(e.target.value as typeof scenario)}>{TEST_SCENARIOS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</Select>
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">{SCENARIO_HELP[scenario]}</p>
          <div className="flex gap-2">
            {scenario === 'cleanup' ? <Button variant="danger" className="flex-1" onClick={() => setConfirm(true)}><Trash2 className="size-4" /> Clean up test data</Button> : <Button className="flex-1" onClick={() => setConfirm(true)}><PlayCircle className="size-4" /> Run scenario</Button>}
            {scenario !== 'cleanup' && <Button variant="outline" onClick={() => { setScenario('cleanup'); }}>Cleanup…</Button>}
          </div>
        </div>
      </Card>
      <div className="space-y-4">
        {log.length === 0 ? <Card><EmptyState icon={<FlaskConical className="size-6" />} title="Nothing run yet" body="Pick a scenario and run it. The steps taken and what was created appear here." /></Card> : log.map((r, i) => (
          <Card key={i} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-display text-lg">{r.scenario.replace(/_/g, ' ')}</p><Badge tone="good">Done</Badge></div>
            <p className="mt-1 text-[15px]">{r.message}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-muted">Entered through</p><p className="text-sm">{r.chain}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-muted">Steps</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink-2">{r.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
            <dl className="mt-4 grid grid-cols-5 gap-2 text-center">{Object.entries(r.created).map(([k, v]) => <div key={k} className="rounded-xl bg-surface-2 p-2"><dd className="tnum font-display text-xl">{v}</dd><dt className="text-[11px] capitalize text-muted">{k}</dt></div>)}</dl>
            {r.lead_ids.length > 0 && <p className="mt-3 text-xs text-muted">Lead ids: {r.lead_ids.join(', ')}{r.removed != null ? ` · removed ${r.removed}` : ''}</p>}
          </Card>
        ))}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} loading={run.isPending} tone={scenario === 'cleanup' ? 'danger' : 'primary'} confirmLabel={scenario === 'cleanup' ? 'Yes, remove test data' : 'Yes, run it'} title={scenario === 'cleanup' ? 'Remove all test data?' : `Run “${scenario.replace(/_/g, ' ')}”?`}
        description={scenario === 'cleanup' ? 'Every record marked as a test is deleted for good. Real leads, listings and costs are not touched.' : 'This creates test records in the system. WhatsApp messages are only sent to test numbers. Remove them any time with Cleanup.'} onConfirm={() => run.mutate({ scenario })} />
    </div>
  );
}

/* ------------------------------------------------------------------ contract health */
interface Check { key: EndpointKey; ok: boolean; ms: number; error?: string; field?: string }
function Health() {
  const [results, setResults] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  async function runAll() {
    setRunning(true); setResults([]);
    const out: Check[] = [];
    let leadId = 1, listingId = 1;
    try { leadId = (await api('leads', { query: { page_size: 1 } })).data[0]?.id ?? 1; } catch { /* reported below */ }
    try { listingId = (await api('listings', { query: {} })).data[0]?.id ?? 1; } catch { /* reported below */ }
    for (const key of GET_ENDPOINTS) {
      const t0 = performance.now();
      const query = key === 'lead' ? { id: leadId } : key === 'listing' ? { id: listingId } : {};
      try { await api(key, { query } as never); out.push({ key, ok: true, ms: Math.round(performance.now() - t0) }); }
      catch (e) {
        const ce = e as ApiError;
        out.push({ key, ok: false, ms: Math.round(performance.now() - t0), error: ce.message, field: ce instanceof ContractError ? ce.issues[0]?.path : ce.field });
      }
      setResults([...out]);
    }
    setRunning(false);
    const bad = out.filter((o) => !o.ok).length;
    if (bad) toast.error(`${bad} of ${out.length} endpoints failed the check.`);
    else toast.success(`All ${out.length} read endpoints match the contract.`);
  }
  const pass = results.filter((r) => r.ok).length;
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0"><p className="font-display text-lg">Does the server still speak our language?</p><p className="text-sm text-muted">Calls every read endpoint and checks the answer, field by field, against the agreed contract.</p></div>
        <Button onClick={runAll} loading={running}><ShieldCheck className="size-4" /> Run check</Button>
      </Card>
      {results.length > 0 && (
        <Card className="overflow-hidden">
          <div className={cn('px-5 py-3 text-sm font-medium', pass === results.length ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad')}>{pass} of {GET_ENDPOINTS.length} passed{running ? ' (running…)' : ''}</div>
          <ul className="divide-y divide-line">
            {results.map((r) => (
              <li key={r.key} className="flex items-start gap-3 px-5 py-3">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good" aria-label="Passed" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-bad" aria-label="Failed" />}
                <div className="min-w-0 flex-1"><p className="font-medium">{endpoints[r.key].label}</p><p className="text-xs text-muted"><code>GET /re/{endpoints[r.key].path}</code>{r.field ? <> · field <code>{r.field}</code></> : null}</p>{r.error && <p className="mt-1 text-sm text-bad">{r.error}</p>}</div>
                <span className="tnum shrink-0 text-xs text-muted">{r.ms} ms</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="All endpoints" caption="Every call the dashboard can make. Each one is a webhook in the single workflow." />
        <div className="scroll-thin mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-y border-line bg-surface-2 text-xs uppercase tracking-wide text-muted"><tr><th className="px-5 py-2.5 font-medium">Call</th><th className="px-3 py-2.5 font-medium">Path</th><th className="px-3 py-2.5 font-medium">Who</th><th className="px-3 py-2.5 font-medium">Part of the workflow</th></tr></thead>
            <tbody>{(Object.keys(endpoints) as EndpointKey[]).map((k) => { const e = endpoints[k] as { method: string; path: string; label: string; roles: readonly string[]; lane: string; sharedChain?: string }; return (
              <tr key={k} className="border-b border-line"><td className="px-5 py-2.5">{e.label}</td><td className="px-3 py-2.5"><Badge tone={e.method === 'GET' ? 'neutral' : 'brand'}>{e.method}</Badge> <code className="text-xs">/re/{e.path}</code></td><td className="px-3 py-2.5 text-muted">{e.roles.join(', ')}</td><td className="px-3 py-2.5 text-xs text-muted">{e.lane}{e.sharedChain ? ` → ${e.sharedChain}` : ''}</td></tr>); })}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ errors */
function Errors() {
  const [page, setPage] = useState(1);
  const [test, setTest] = useState(false);
  const q = useApi('errors', { page, include_test: test ? 'true' : undefined });
  const rows = q.data?.data ?? [];
  const total = q.data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (q.data?.meta?.page_size ?? 20)));
  return (
    <Card>
      <CardHeader title="Things that went wrong" caption="Each failure inside the automation is logged once and the admin is alerted on WhatsApp and email." action={<label className="flex items-center gap-2 text-sm text-ink-2"><Switch checked={test} onCheckedChange={setTest} aria-label="Show test errors" /> Include tests</label>} />
      {q.isError ? <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : q.isLoading ? <div className="p-5"><CardSkeleton rows={4} /></div> : rows.length === 0 ? <EmptyState title="No errors" body="Nothing has failed. That is what we like to see." /> : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((e) => (
            <li key={e.id}>
              <details className="group px-5 py-3">
                <summary className="flex cursor-pointer list-none items-start gap-3">
                  <XCircle className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{e.node ?? e.workflow} {e.is_test && <Badge tone="outline">Test</Badge>}</span><span className="block truncate text-sm text-ink-2 group-open:whitespace-normal">{e.error}</span><span className="text-xs text-muted">{istTime(e.created_at)}</span></span>
                </summary>
                <dl className="mt-3 grid gap-1 pl-8 text-xs text-muted sm:grid-cols-[120px_1fr]">
                  <dt>Workflow</dt><dd>{e.workflow}</dd><dt>Run id</dt><dd><code>{e.execution_id ?? '—'}</code></dd><dt>Workflow id</dt><dd><code>{e.workflow_id ?? '—'}</code></dd>
                  <dt>Details</dt><dd><pre className="scroll-thin overflow-x-auto rounded-lg bg-surface-2 p-2 text-[11px] text-ink-2">{JSON.stringify(e.payload, null, 2)}</pre></dd>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm"><span className="tnum text-muted">Page {page} of {pages} · {total} total</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" /> Newer</Button><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older <ChevronRight className="size-4" /></Button></div></div>
    </Card>
  );
}
