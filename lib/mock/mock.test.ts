import { beforeEach, describe, expect, it } from 'vitest';
import { GET_ENDPOINTS, endpoints, envelope, findEndpoint, type EndpointKey } from '@contracts/realestate-api';
import { ApiError } from '../api-error';
import * as M from '../metrics';
import { handleMock } from './handlers';
import { buildSeed } from './seed';
import { resetStore } from './store';

const owner = { role: 'owner' } as const;
const NOW = () => new Date();
const call = (k: EndpointKey, q: unknown = {}, b: unknown = undefined, actor: any = owner) => handleMock(k, q, b, actor, NOW());
const validate = (k: EndpointKey, r: { data: unknown; meta?: unknown }) => envelope((endpoints[k] as any).response).parse({ status: 'ok', data: r.data, meta: r.meta });

describe('seed data', () => {
  const a = buildSeed(new Date('2026-11-02T10:07:00Z'));
  const b = buildSeed(new Date('2026-11-02T10:07:00Z'));
  const real = a.leads.filter((l) => !l.is_test);
  const now = new Date(a.anchor);

  it('is deterministic', () => {
    expect(JSON.stringify(a.leads.slice(0, 50))).toBe(JSON.stringify(b.leads.slice(0, 50)));
    expect(a.events.length).toBe(b.events.length);
  });
  it('has the promised shape', () => {
    expect(real.length).toBeGreaterThan(1300);
    expect(real.length).toBeLessThan(1600);
    expect(a.agents).toHaveLength(7);
    expect(a.agents.filter((x) => !x.active)).toHaveLength(1);
    expect(a.listings.filter((l) => !l.is_test)).toHaveLength(25);
    expect(a.costs.filter((c) => !c.is_test)).toHaveLength(12); // 4 paid sources x 3 months
    expect(a.errors.filter((e) => !e.is_test)).toHaveLength(5);
    expect(a.leads.some((l) => l.is_test)).toBe(true);
    expect(real.every((l) => /^\+91[6-9]\d{9}$/.test(l.phone ?? '+919999999999'))).toBe(true);
    expect(new Set(real.map((l) => l.phone).filter(Boolean)).size).toBe(real.filter((l) => l.phone).length); // unique phones
  });
  it('scores roughly 15 / 45 / 40', () => {
    const share = (s: string) => real.filter((l) => l.score === s).length / real.length;
    expect(share('hot')).toBeGreaterThan(0.11); expect(share('hot')).toBeLessThan(0.19);
    expect(share('warm')).toBeGreaterThan(0.40); expect(share('warm')).toBeLessThan(0.52);
    expect(share('cold')).toBeGreaterThan(0.34); expect(share('cold')).toBeLessThan(0.46);
  });
  it('timelines are consistent: first_response_at is the first human touch; stage matches the last stage event; times in order', () => {
    const idx = M.indexEvents(a.events);
    for (const l of a.leads) {
      const evs = idx.get(l.id) ?? [];
      expect(evs[0]?.event_type).toBe('created');
      expect(Date.parse(evs[0].created_at)).toBe(Date.parse(l.created_at));
      const touch = M.firstHumanTouch(evs.filter((e) => Date.parse(e.created_at) >= Date.parse(l.created_at)));
      expect(touch?.created_at ?? null, `lead ${l.id} first response`).toBe(l.first_response_at);
      const lastStage = [...evs].reverse().find((e) => e.to_stage && (e.event_type === 'created' || e.event_type === 'stage_change'))?.to_stage;
      if (!(l.stage === 'closed_lost' && !evs.some((e) => e.to_stage === 'closed_lost'))) expect(lastStage, `lead ${l.id}`).toBe(l.stage);
      for (const e of evs) expect(Date.parse(e.created_at)).toBeLessThanOrEqual(now.getTime() + 1000);
    }
  });
  it('has 12–20 stale leads across the escalation levels, matching the watchdog rules', () => {
    const stale = M.computeStale(a, now, a.cfg);
    expect(stale.length).toBeGreaterThanOrEqual(12);
    expect(stale.length).toBeLessThanOrEqual(20);
    expect(new Set(stale.map((s) => s.level)).size).toBe(4);
    for (const l of a.leads) expect(l.is_stale).toBe(M.isOpen(l.stage) && M.deriveIsStale(l, l.assigned_agent_id != null && a.agents[l.assigned_agent_id - 1].active, now, a.cfg));
  });
  it('first responses are mostly 3–40 minutes with a tail beyond 2 hours', () => {
    const r = real.map(M.responseMinutes).filter((x): x is number => x != null);
    expect(r.filter((x) => x <= 40).length / r.length).toBeGreaterThan(0.65);
    const tail = r.filter((x) => x > 120).length / r.length;
    expect(tail).toBeGreaterThan(0.02); expect(tail).toBeLessThan(0.15);
  });
  it('tells the intended agent and source stories', () => {
    const lb = M.computeLeaderboard(a, M.defaultPeriod(now, 30), now);
    expect(lb[0].name).toBe('Rohan Mishra');
    const slow = lb.find((r) => r.name === 'Neha Tiwari')!, fast = lb.find((r) => r.name === 'Aman Verma')!;
    expect(slow.avg_first_response_min!).toBeGreaterThan(50);
    expect(fast.avg_first_response_min!).toBeLessThan(15);
    expect(fast.conversions).toBeLessThan(lb[0].conversions / 3);
    const cm = M.monthOf(M.istDate(now));
    for (const k of [1, 2, 3]) {
      const roi = M.computeSourceRoi(a, M.addMonths(cm, -k), now, a.cfg);
      expect(roi.rows.filter((r) => r.consider_cut).map((r) => r.source)).toEqual(['magicbricks']);
      expect(roi.rows.find((r) => r.source === 'referral')!.cost_inr).toBe(0);
    }
    expect(M.computeSourceRoi(a, cm, now, a.cfg).missing_current_month.length).toBeGreaterThan(0);
  });
});

describe('the numbers add up', () => {
  beforeEach(() => resetStore());
  const s = () => (globalThis as any).__reStore;

  it('overview KPIs equal what the raw records add up to', () => {
    const now = NOW();
    const p = M.defaultPeriod(now, 30);
    const o = call('overview', p).data as any;
    const ds = s();
    const inP = ds.leads.filter((l: any) => !l.is_test && M.inPeriod(l.created_at, p));
    expect(o.totals.new_leads).toBe(inP.length);
    expect(o.totals.new_leads).toBe(o.series.reduce((x: number, d: any) => x + d.new_leads, 0));
    const stageEv = ds.events.filter((e: any) => e.event_type === 'stage_change' && !ds.leads.find((l: any) => l.id === e.lead_id).is_test && M.inPeriod(e.created_at, p));
    expect(o.totals.closures).toBe(stageEv.filter((e: any) => e.to_stage === 'closed_won').length);
    expect(o.totals.visits_booked).toBe(stageEv.filter((e: any) => e.to_stage === 'site_visit_booked' && e.from_stage !== 'site_visit_booked').length);
    expect(o.totals.visits_booked).toBe(o.series.reduce((x: number, d: any) => x + d.visits_booked, 0));
    const answered = inP.filter((l: any) => l.stage !== 'junk');
    const rs = answered.map(M.responseMinutes).filter((x: any) => x != null) as number[];
    expect(o.totals.avg_first_response_min).toBe(Math.round((rs.reduce((x, y) => x + y, 0) / rs.length) * 10) / 10);
    expect(o.totals.breaching_sla).toBe(answered.filter((l: any) => M.isBreaching(l, now, 120)).length);
  });
  it('funnel, speed and ROI agree on the same cohort', () => {
    const now = NOW();
    const p = M.defaultPeriod(now, 90);
    const f = call('funnel', p).data as any;
    const sp = call('speed', p).data as any;
    expect(f.stages[0].reached).toBe(f.totals.leads - f.totals.junk);
    expect(sp.overall.leads).toBe(f.stages[0].reached);
    for (let i = 1; i < f.stages.length; i++) expect(f.stages[i].reached).toBeLessThanOrEqual(f.stages[i - 1].reached);
    expect(sp.by_source.reduce((a: number, r: any) => a + r.leads, 0)).toBe(sp.overall.leads);
    expect(sp.by_agent.reduce((a: number, r: any) => a + r.leads, 0)).toBe(sp.overall.leads);
    const month = M.addMonths(M.monthOf(M.istDate(now)), -1);
    const roi = call('sourceRoi', { month: month.slice(0, 7) }).data as any;
    const mf = call('funnel', M.monthRange(month)).data as any;
    expect(roi.rows.reduce((a: number, r: any) => a + r.leads, 0)).toBe(mf.totals.leads);
    expect(roi.rows.reduce((a: number, r: any) => a + r.site_visits, 0)).toBe(mf.stages[3].reached);
    expect(roi.rows.reduce((a: number, r: any) => a + r.closures, 0)).toBe(mf.stages[5].reached);
    for (const r of roi.rows) if (r.cost_inr && r.leads) expect(r.cost_per_lead).toBe(Math.round((r.cost_inr / r.leads) * 100) / 100);
  });
  it('every GET endpoint returns data that satisfies the contract', () => {
    const ids = { lead: { id: (call('leads', { page_size: 1 }).data as any[])[0].id }, listing: { id: 2 } } as any;
    for (const k of GET_ENDPOINTS) validate(k, call(k, ids[k] ?? {}));
  });
  it('listing counts add up: interested <= responded <= messaged <= matched', () => {
    for (const l of call('listings').data as any[]) {
      expect(l.interested).toBeLessThanOrEqual(l.responded);
      expect(l.responded).toBeLessThanOrEqual(l.messaged);
      expect(l.messaged).toBeLessThanOrEqual(l.matched);
    }
  });
});

describe('mock actions really change state', () => {
  beforeEach(() => resetStore());

  it('a stage update moves the lead in the funnel and adds a timeline event', () => {
    const now = NOW();
    const target = (call('leads', { stage: 'qualified', page_size: 1, sort: 'created_desc' }).data as any[])[0];
    const before = call('funnel', M.defaultPeriod(now, 90)).data as any;
    const visit = new Date(now.getTime() + 2 * 86400000).toISOString();
    const r = call('updateStage', {}, { lead_id: target.id, to_stage: 'site_visit_booked', visit_at: visit, note: 'Booked' }).data as any;
    expect(r.to_stage).toBe('site_visit_booked');
    expect(r.calendar_event_created).toBe(true);
    const detail = call('lead', { id: target.id }).data as any;
    expect(detail.lead.stage).toBe('site_visit_booked');
    expect(detail.events.at(-1)).toMatchObject({ event_type: 'stage_change', from_stage: 'qualified', to_stage: 'site_visit_booked' });
    const after = call('funnel', M.defaultPeriod(now, 90)).data as any;
    const inWindow = M.inPeriod(target.created_at, M.defaultPeriod(now, 90));
    expect(after.stages[2].currently_in).toBe(before.stages[2].currently_in + 1);
    expect(after.stages[1].currently_in).toBe(before.stages[1].currently_in - 1);
    if (inWindow) expect(after.stages[2].reached).toBeGreaterThanOrEqual(before.stages[2].reached);
  });
  it('rejects backwards moves, past visits and a lost lead with no reason, in plain language', () => {
    const l = (call('leads', { stage: 'qualified', page_size: 1 }).data as any[])[0];
    expect(() => call('updateStage', {}, { lead_id: l.id, to_stage: 'new' })).toThrow(/backwards/);
    expect(() => call('updateStage', {}, { lead_id: l.id, to_stage: 'site_visit_booked', visit_at: new Date(Date.now() - 3600000).toISOString() })).toThrow(/future/);
    expect(() => call('updateStage', {}, { lead_id: l.id, to_stage: 'closed_lost' })).toThrow(/why/i);
  });
  it('the first touch records the first response', () => {
    const intake = call('addLead', {}, { name: 'Test Buyer', phone: '9811123456', source: 'website', timeline: 'immediate', budget_max: 7000000, is_test: true }).data as any;
    expect(intake.is_new).toBe(true);
    expect(intake.assigned_agent_id).not.toBeNull();
    const r = call('updateStage', {}, { lead_id: intake.lead_id, to_stage: 'qualified' }).data as any;
    expect(r.first_touch).toBe(true);
    const d = call('lead', { id: intake.lead_id }).data as any;
    expect(d.lead.first_response_at).not.toBeNull();
    expect(d.lead.minutes_to_first_response).toBeLessThan(1);
  });
  it('reassignment changes the owner, logs it and notifies both agents', () => {
    const l = (call('leads', { stage: 'qualified', page_size: 1 }).data as any[])[0];
    const to = (call('agents').data as any[]).find((a) => a.active && a.id !== l.assigned_agent_id);
    const r = call('reassign', {}, { lead_id: l.id, agent_id: to.id, reason: 'On leave' }).data as any;
    expect(r.notified).toHaveLength(2);
    const d = call('lead', { id: l.id }).data as any;
    expect(d.lead.assigned_agent_id).toBe(to.id);
    expect(d.events.at(-2).note).toContain('On leave');
    expect(() => call('reassign', {}, { lead_id: l.id, agent_id: 7, reason: 'inactive agent' })).toThrow(/active agent/);
  });
  it('a duplicate enquiry is a repeat, not a new lead', () => {
    const a = call('addLead', {}, { name: 'Dup', phone: '9811123499', source: 'website', is_test: true }).data as any;
    const b = call('addLead', {}, { name: 'Dup', phone: '+91 98111 23499', source: 'magicbricks', is_test: true }).data as any;
    expect(b.is_new).toBe(false);
    expect(b.lead_id).toBe(a.lead_id);
    expect((call('lead', { id: a.lead_id }).data as any).events.some((e: any) => e.event_type === 'repeat_enquiry')).toBe(true);
  });
  it('a new listing generates matches with the matcher rules', () => {
    const r = call('saveListing', {}, { title: 'Brand new 3 BHK', location: 'Gomti Nagar', property_type: 'apartment', bhk: 3, price: 8_000_000, status: 'open' }).data as any;
    expect(r.new_matches).toBeGreaterThan(0);
    const detail = call('listing', { id: r.listing.id }).data as any;
    expect(detail.matches).toHaveLength(r.new_matches);
    for (const m of detail.matches) {
      const lead = (call('lead', { id: m.lead_id }).data as any).lead;
      expect(m.match_score).toBeGreaterThanOrEqual(70);
      expect(lead.bhk === 3 || lead.bhk == null).toBe(true);
      expect(['apartment', null]).toContain(lead.property_type);
      expect(lead.location_pref == null || /gomti nagar/i.test(lead.location_pref)).toBe(true);
      if (lead.budget_max != null) expect(8_000_000).toBeLessThanOrEqual(lead.budget_max * 1.15 + 1);
    }
    // saving again matches nobody new
    expect((call('saveListing', {}, { id: r.listing.id, title: 'Brand new 3 BHK', location: 'Gomti Nagar', property_type: 'apartment', bhk: 3, price: 8_000_000, status: 'open' }).data as any).new_matches).toBe(0);
  });
  it('cost upsert replaces the earlier amount', () => {
    const month = M.addMonths(M.monthOf(M.istDate(new Date())), -1);
    const r = call('saveCost', {}, { source: 'meta', month: month.slice(0, 7), amount_inr: 70000 }).data as any;
    expect(r.replaced).toBe(true);
    const rows = (call('costs', {}).data as any[]).filter((c) => c.source === 'meta' && c.month === month);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_inr).toBe(70000);
  });
  it('agents cannot touch each other\'s leads and only see their own data', () => {
    const l = (call('leads', { stage: 'qualified', page_size: 1 }).data as any[])[0];
    const other = (call('agents').data as any[]).find((a) => a.active && a.id !== l.assigned_agent_id);
    const actor = { role: 'agent', agentId: other.id, name: other.name };
    expect(() => call('updateStage', {}, { lead_id: l.id, to_stage: 'visited' }, actor)).toThrow(/different agent/);
    expect(() => call('addNote', {}, { lead_id: l.id, note: 'x' }, actor)).toThrow(ApiError);
    const mine = call('leads', { page_size: 200 }, undefined, actor).data as any[];
    expect(mine.every((x) => x.assigned_agent_id === other.id)).toBe(true);
    const lb = call('leaderboard', {}, undefined, actor).data as any[];
    expect(lb).toHaveLength(1);
    expect(lb[0].agent_id).toBe(other.id);
    expect(lb[0].rank).toBe((call('leaderboard').data as any[]).find((r) => r.agent_id === other.id).rank);
    expect(call('agents', {}, undefined, actor).data as any[]).toHaveLength(1);
  });
});

describe('test harness', () => {
  beforeEach(() => resetStore());
  it('runs every scenario through the real chains and cleanup removes it all', () => {
    const baseLeads = (call('leads', { page_size: 1, include_test: 'true' }).meta as any).total;
    for (const scenario of ['portal_email_lead', 'meta_lead', 'referral_form', 'duplicate_lead', 'stale_lead_escalation', 'visit_booking', 'listing_match', 'cost_entry']) {
      const r = call('runTest', {}, { scenario }).data as any;
      expect(r.steps.length, scenario).toBeGreaterThan(0);
      validate('runTest', { data: r });
    }
    const during = (call('leads', { page_size: 200, include_test: 'true' }).data as any[]).filter((l) => l.is_test);
    expect(during.length).toBeGreaterThan(8);
    // real numbers are untouched by test rows
    expect((call('leads', { page_size: 1 }).meta as any).total).toBe((call('leads', { page_size: 1, include_test: 'false' }).meta as any).total);
    const c = call('runTest', {}, { scenario: 'cleanup' }).data as any;
    expect(c.removed).toBeGreaterThan(8);
    expect((call('leads', { page_size: 1, include_test: 'true' }).meta as any).total).toBeLessThan(baseLeads);
    expect((call('leads', { page_size: 200, include_test: 'true' }).data as any[]).some((l) => l.is_test)).toBe(false);
  });
  it('the duplicate scenario creates exactly one lead', () => {
    const r = call('runTest', {}, { scenario: 'duplicate_lead' }).data as any;
    expect(r.created.leads).toBe(1);
  });
  it('the stale scenario walks the whole escalation ladder', () => {
    const r = call('runTest', {}, { scenario: 'stale_lead_escalation' }).data as any;
    const d = call('lead', { id: r.lead_ids[0] }).data as any;
    const types = d.events.map((e: any) => e.event_type);
    for (const t of ['sla_breached', 'owner_escalated', 'reassigned_stale']) expect(types).toContain(t);
  });
});

describe('contract allow-list', () => {
  it('finds endpoints by method and path and nothing else', () => {
    expect(findEndpoint('GET', 'agents/leaderboard')?.key).toBe('leaderboard');
    expect(findEndpoint('POST', '/lead/stage')?.key).toBe('updateStage');
    expect(findEndpoint('GET', 'lead/stage')).toBeNull();
    expect(findEndpoint('DELETE', 'lead')).toBeNull();
    expect(findEndpoint('GET', 'admin/secrets')).toBeNull();
    expect(findEndpoint('GET', 'lead')?.key).toBe('lead');
    expect(findEndpoint('POST', 'lead')?.key).toBe('addLead');
  });
  it('validates requests the way the form promises', () => {
    const e = endpoints as any;
    expect(e.addLead.body.safeParse({ name: 'A', source: 'meta' }).success).toBe(false); // needs phone or email
    expect(e.addLead.body.safeParse({ name: 'A', source: 'meta', phone: '9811123456' }).success).toBe(true);
    expect(e.addLead.body.safeParse({ name: 'A', source: 'meta', phone: '12345' }).success).toBe(false);
    expect(e.updateStage.body.safeParse({ lead_id: 1, to_stage: 'site_visit_booked' }).success).toBe(false);
    expect(e.updateStage.body.safeParse({ lead_id: 1, to_stage: 'closed_lost' }).success).toBe(false);
    expect(e.updateStage.body.safeParse({ lead_id: '5', to_stage: 'qualified' }).data.lead_id).toBe(5);
    expect(e.saveCost.body.safeParse({ source: 'meta', month: '2026-10', amount_inr: -5 }).success).toBe(false);
  });
  it('responses accept pg strings for numerics but reject wrong shapes', () => {
    const agent = { id: '3', name: 'x', phone: '+919811100003', email: null, active: true, round_robin_order: '3', weight: '1', max_open_leads: '30', open_leads: '4', created_at: '2026-01-01T00:00:00Z' };
    expect((endpoints.agents.response as any).parse([agent])[0].id).toBe(3);
    expect(() => (endpoints.agents.response as any).parse([{ ...agent, active: 'yes' }])).toThrow();
    expect(() => (endpoints.leads.response as any).parse([{ id: 1 }])).toThrow();
  });
});
