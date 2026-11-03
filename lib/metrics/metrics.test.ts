import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CFG, addDays, computeFunnel, computeLeaderboard, computeOverview, computeSourceRoi, computeSpeed, computeStale, defaultPeriod, deriveIsStale, firstHumanTouch, isBreaching,
  matchListing, matchScore, maxOrd, median, monthRange, needsCoaching, previousPeriod, responseMinutes, roiRows, spendInRange, istDate,
  type Dataset, type RawAgent, type RawEvent, type RawLead,
} from './index';

const NOW = new Date('2026-11-02T10:00:00Z'); // 3:30 pm IST
const cfg = DEFAULT_CFG;
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();

function lead(p: Partial<RawLead> & { id: number }): RawLead {
  return {
    name: `Lead ${p.id}`, phone: `+9198111000${String(p.id).padStart(2, '0')}`, email: null, source: '99acres', source_detail: null, campaign: null, budget_min: null, budget_max: null,
    location_pref: null, property_type: null, bhk: null, timeline: 'unknown', score: 'warm', score_points: 50, score_reason: null, priority: 0, repeat_count: 0,
    assigned_agent_id: 1, assigned_at: null, reassign_count: 0, stage: 'new', visit_at: null, lost_reason: null, created_at: ago(60 * 24), first_response_at: null,
    first_response_agent_id: null, last_activity_at: ago(60 * 24), is_stale: false, is_test: false, ...p,
  };
}
let evId = 0;
const ev = (lead_id: number, event_type: RawEvent['event_type'], at: string, o: Partial<RawEvent> = {}): RawEvent => ({ id: ++evId, lead_id, agent_id: 1, event_type, from_stage: null, to_stage: null, note: null, created_at: at, ...o });
const agent = (id: number, name: string, active = true): RawAgent => ({ id, name, phone: `+9198111000${id}`, email: null, active, round_robin_order: id, weight: 1, max_open_leads: 30, created_at: ago(1e5) });
const empty: Dataset = { agents: [agent(1, 'A'), agent(2, 'B')], leads: [], events: [], listings: [], matches: [], costs: [], errors: [] };

describe('first response', () => {
  it('is first human touch minus created_at; notes and system events do not count', () => {
    const t0 = '2026-11-01T06:00:00Z';
    const evs = [ev(1, 'created', t0, { agent_id: null }), ev(1, 'assigned', '2026-11-01T06:00:35Z'), ev(1, 'auto_response_sent', '2026-11-01T06:00:40Z', { agent_id: null }), ev(1, 'note', '2026-11-01T06:05:00Z'), ev(1, 'called', '2026-11-01T06:18:00Z')];
    const touch = firstHumanTouch(evs)!;
    expect(touch.event_type).toBe('called');
    const l = lead({ id: 1, created_at: t0, first_response_at: touch.created_at });
    expect(responseMinutes(l)).toBe(18);
  });
  it('breach = answered after the SLA, or unanswered and older than the SLA', () => {
    expect(isBreaching(lead({ id: 1, created_at: ago(200), first_response_at: ago(200 - 125) }), NOW, 120)).toBe(true);
    expect(isBreaching(lead({ id: 2, created_at: ago(200), first_response_at: ago(200 - 119) }), NOW, 120)).toBe(false);
    expect(isBreaching(lead({ id: 3, created_at: ago(121) }), NOW, 120)).toBe(true);
    expect(isBreaching(lead({ id: 4, created_at: ago(60) }), NOW, 120)).toBe(false);
  });
  it('median uses percentile_cont(0.5)', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('funnel', () => {
  // 6 leads in the last 3 days: 1 junk, 5 real. Reached: new5, qualified4, booked3, visited2, nego1, won1.
  const leads = [
    lead({ id: 1, stage: 'junk' }),
    lead({ id: 2, stage: 'new' }),
    lead({ id: 3, stage: 'closed_lost', lost_reason: 'Bought elsewhere' }),
    lead({ id: 4, stage: 'site_visit_booked' }),
    lead({ id: 5, stage: 'visited' }),
    lead({ id: 6, stage: 'closed_won' }),
  ];
  const events = [
    ev(3, 'stage_change', ago(3000), { from_stage: 'new', to_stage: 'qualified' }),
    ev(4, 'stage_change', ago(3000), { from_stage: 'new', to_stage: 'qualified' }),
    ev(4, 'stage_change', ago(2000), { from_stage: 'qualified', to_stage: 'site_visit_booked' }),
    ev(5, 'stage_change', ago(3000), { from_stage: 'new', to_stage: 'qualified' }),
    ev(5, 'stage_change', ago(2500), { from_stage: 'qualified', to_stage: 'site_visit_booked' }),
    ev(5, 'stage_change', ago(1500), { from_stage: 'site_visit_booked', to_stage: 'visited' }),
    ev(6, 'stage_change', ago(3000), { from_stage: 'new', to_stage: 'site_visit_booked' }), // skipped qualified
    ev(6, 'stage_change', ago(2500), { from_stage: 'site_visit_booked', to_stage: 'visited' }),
    ev(6, 'stage_change', ago(2000), { from_stage: 'visited', to_stage: 'negotiation' }),
    ev(6, 'stage_change', ago(1000), { from_stage: 'negotiation', to_stage: 'closed_won' }),
  ];
  const ds = { ...empty, leads, events };
  const f = computeFunnel(ds, { from: addDays(istDate(NOW), -10), to: istDate(NOW) }, NOW);
  it('counts the highest stage ever reached and leaves junk out', () => {
    expect(f.stages.map((s) => s.reached)).toEqual([5, 3, 4, 2, 1, 1].map((x, i) => [5, 4, 3, 2, 1, 1][i]));
    expect(f.totals).toEqual({ leads: 6, junk: 1, closed_lost: 1, open: 3 });
  });
  it('conversion is vs previous step and vs top; drop-off never negative', () => {
    expect(f.stages[1].conv_from_prev_pct).toBe(80);
    expect(f.stages[2].conv_from_prev_pct).toBe(75);
    expect(f.stages[5].conv_from_top_pct).toBe(20);
    expect(f.stages.every((s) => s.drop_off >= 0)).toBe(true);
    expect(f.lost_reasons).toEqual([{ reason: 'Bought elsewhere', count: 1 }]);
  });
  it('maxOrd counts events, so a lead that went backwards to lost keeps its peak', () => {
    expect(maxOrd(lead({ id: 9, stage: 'closed_lost' }), [ev(9, 'stage_change', ago(5), { to_stage: 'visited' })])).toBe(4);
  });
});

describe('source ROI', () => {
  const month = '2026-10-01';
  const created = '2026-10-10T08:00:00Z';
  const mk = (id: number, source: RawLead['source'], stage: RawLead['stage'], maxStage?: RawEvent['to_stage']) => ({ l: lead({ id, source, stage, created_at: created }), e: maxStage ? [ev(id, 'stage_change', '2026-10-12T08:00:00Z', { to_stage: maxStage })] : [] });
  // 99acres: 10 leads, 5 booked, 4 visited, 1 won. MagicBricks: 20 leads, 2 booked, 1 visited. Referral: 5 leads, free. Meta: paid, 0 visits.
  const items = [
    ...Array.from({ length: 10 }, (_, i) => mk(100 + i, '99acres', i < 4 ? 'visited' : i === 4 ? 'site_visit_booked' : 'new', i < 4 ? 'visited' : i === 4 ? 'site_visit_booked' : undefined)),
    ...Array.from({ length: 20 }, (_, i) => mk(200 + i, 'magicbricks', i === 0 ? 'visited' : i === 1 ? 'site_visit_booked' : 'new', i === 0 ? 'visited' : i === 1 ? 'site_visit_booked' : undefined)),
    ...Array.from({ length: 5 }, (_, i) => mk(300 + i, 'referral', 'visited', 'visited')),
    ...Array.from({ length: 8 }, (_, i) => mk(400 + i, 'meta', 'new')),
  ];
  items[0].l.stage = 'closed_won';
  const ds: Dataset = {
    ...empty, leads: items.map((i) => i.l), events: items.flatMap((i) => i.e),
    costs: [
      { id: 1, source: '99acres', month, amount_inr: 40000, is_test: false },
      { id: 2, source: 'magicbricks', month, amount_inr: 40000, is_test: false },
      { id: 3, source: 'meta', month, amount_inr: 20000, is_test: false },
      { id: 4, source: 'referral', month, amount_inr: 0, is_test: false },
    ],
  };
  const r = computeSourceRoi(ds, month, NOW, cfg);
  const row = (s: string) => r.rows.find((x) => x.source === s)!;
  it('uses the backend formulas', () => {
    expect(row('99acres')).toMatchObject({ leads: 10, qualified: 5, visits_booked: 5, site_visits: 4, closures: 1, cost_per_lead: 4000, cost_per_visit_booked: 8000, cost_per_site_visit: 10000, cost_per_closure: 40000 });
    expect(row('magicbricks')).toMatchObject({ leads: 20, visits_booked: 2, site_visits: 1, cost_per_lead: 2000, cost_per_site_visit: 40000 });
  });
  it('consider-cut: > 2x the best PAID source, or paid with no visits; free sources are never flagged or the benchmark', () => {
    expect(row('99acres').consider_cut).toBe(false);
    expect(row('magicbricks').consider_cut).toBe(true); // 40,000 > 2 x 10,000
    expect(row('meta').consider_cut).toBe(true); // paid, no site visits
    expect(row('referral').consider_cut).toBe(false);
    expect(row('referral').cost_per_site_visit).toBeNull();
    expect(r.best_source).toEqual({ source: '99acres', cost_per_site_visit: 10000 });
  });
  it('exactly 2x is not flagged', () => {
    const rows = roiRows(ds, monthRange(month), (s) => (s === '99acres' ? 40000 : s === 'magicbricks' ? 20000 : 0), cfg);
    // 99acres 10,000 per visit; magicbricks 20,000 per visit = exactly 2x
    expect(rows.find((x) => x.source === 'magicbricks')!.consider_cut).toBe(false);
  });
  it('flags missing current-month costs', () => {
    const cur = new Date('2026-11-02T10:00:00Z');
    const r2 = computeSourceRoi(ds, month, cur, cfg);
    expect(r2.current_month).toBe('2026-11-01');
    expect(r2.missing_current_month.sort()).toEqual(['99acres', 'magicbricks', 'meta']);
  });
});

describe('spend', () => {
  it('prorates a monthly cost by days inside the period', () => {
    const costs = [{ id: 1, source: 'meta' as const, month: '2026-10-01', amount_inr: 31000, is_test: false }];
    expect(spendInRange(costs, { from: '2026-10-01', to: '2026-10-31' })).toBe(31000);
    expect(spendInRange(costs, { from: '2026-10-21', to: '2026-11-10' })).toBe(11000);
    expect(spendInRange([{ ...costs[0], is_test: true }], { from: '2026-10-01', to: '2026-10-31' })).toBe(0);
  });
});

describe('listing match (SQL rules)', () => {
  const li = { location: 'Gomti Nagar', property_type: 'apartment' as const, bhk: 3, price: 7_000_000 };
  const buyer = { location_pref: 'Gomti Nagar', property_type: 'apartment' as const, bhk: 3, budget_min: 6_000_000, budget_max: 8_000_000 };
  it('a perfect fit scores 100', () => expect(matchScore(li, buyer, cfg)).toBe(100));
  it('budget within +/-15% scores 0.6 of the budget weight; outside is excluded', () => {
    expect(matchScore({ ...li, price: 9_200_000 }, buyer, cfg)).toBe(92); // 8M * 1.15 = 9.2M inclusive
    expect(matchScore({ ...li, price: 9_300_000 }, buyer, cfg)).toBeNull();
    expect(matchScore({ ...li, price: 5_200_000 }, buyer, cfg)).toBe(92); // 6M * 0.85 = 5.1M
    expect(matchScore({ ...li, price: 5_000_000 }, buyer, cfg)).toBeNull();
  });
  it('missing preferences count as half a match; mismatches exclude', () => {
    expect(matchScore(li, { ...buyer, location_pref: null, bhk: null }, cfg)).toBe(100 - (35 * 0.5 + 20 * 0.5));
    expect(matchScore(li, { ...buyer, bhk: 2 }, cfg)).toBeNull();
    expect(matchScore(li, { ...buyer, property_type: 'villa' }, cfg)).toBeNull();
    expect(matchScore(li, { ...buyer, location_pref: 'Indira Nagar' }, cfg)).toBeNull();
    expect(matchScore(li, { ...buyer, location_pref: 'Gomti Nagar Extension' }, cfg)).toBe(100); // substring both ways
  });
  it('matchListing: threshold, open leads with a phone only, no repeats, test isolation, cap', () => {
    const leads = [
      lead({ id: 1, ...buyer, stage: 'qualified' }),
      lead({ id: 2, ...buyer, stage: 'closed_lost' }),
      lead({ id: 3, ...buyer, phone: null }),
      lead({ id: 4, ...buyer, is_test: true }),
      lead({ id: 5, ...buyer, location_pref: null, bhk: null, property_type: null, budget_min: null, budget_max: null }), // 50 -> below 70
    ];
    const listing = { id: 9, title: 't', project: null, status: 'open' as const, is_test: false, created_at: ago(5), ...li };
    expect(matchListing(listing, leads, [], cfg).map((m) => m.lead_id)).toEqual([1]);
    expect(matchListing(listing, leads, [{ id: 1, listing_id: 9, lead_id: 1, match_score: 100, messaged_at: null, response: null, responded_at: null, interested: null, created_at: ago(1) }], cfg)).toEqual([]);
    expect(matchListing({ ...listing, is_test: true }, leads, [], cfg).map((m) => m.lead_id)).toEqual([4]);
    expect(matchListing({ ...listing, status: 'sold' }, leads, [], cfg)).toEqual([]);
  });
});

describe('leaderboard, stale and speed', () => {
  const p = { from: addDays(istDate(NOW), -29), to: istDate(NOW) };
  const t = (d: number) => ago(60 * 24 * d);
  const leads = [
    lead({ id: 1, assigned_agent_id: 1, created_at: t(5), first_response_at: new Date(new Date(t(5)).getTime() + 10 * 60000).toISOString(), first_response_agent_id: 1, stage: 'closed_won' }),
    lead({ id: 2, assigned_agent_id: 2, created_at: t(5), first_response_at: new Date(new Date(t(5)).getTime() + 200 * 60000).toISOString(), first_response_agent_id: 2, stage: 'qualified', is_stale: false }),
    lead({ id: 3, assigned_agent_id: 2, created_at: ago(190), stage: 'new', is_stale: true, assigned_at: ago(190) }),
  ];
  const events = [
    ev(1, 'assigned', t(5), { agent_id: 1 }), ev(1, 'called', t(4), { agent_id: 1 }), ev(1, 'stage_change', t(3), { agent_id: 1, from_stage: 'qualified', to_stage: 'site_visit_booked' }), ev(1, 'stage_change', t(1), { agent_id: 1, from_stage: 'negotiation', to_stage: 'closed_won' }),
    ev(2, 'assigned', t(5), { agent_id: 2 }), ev(2, 'followup_done', t(4), { agent_id: 2 }),
    ev(3, 'assigned', ago(190), { agent_id: 2 }),
  ];
  const ds = { ...empty, leads, events };
  it('ranks by conversions then visits then follow-ups; conversion % = won / assigned', () => {
    const lb = computeLeaderboard(ds, p, NOW);
    expect(lb.map((r) => [r.name, r.rank, r.conversions, r.visits_booked, r.follow_ups_done])).toEqual([['A', 1, 1, 1, 1], ['B', 2, 0, 0, 1]]);
    expect(lb[0].conversion_pct).toBe(100);
    expect(lb[1].leads_assigned).toBe(2);
    expect(lb[1].stale_count).toBe(1);
  });
  it('escalation level follows the minutes waited', () => {
    const s = computeStale(ds, NOW, cfg);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ lead_id: 3, level: 'owner_escalated', minutes_waiting: 190 });
  });
  it('speed: attributes to the first-responding agent and counts breaches', () => {
    const sp = computeSpeed(ds, p, NOW, cfg);
    expect(sp.overall).toMatchObject({ leads: 3, responded: 2, avg_min: 105, median_min: 105, breaches: 2 });
    expect(sp.by_agent.find((a) => a.agent_name === 'A')!.avg_min).toBe(10);
  });
  it('deriveIsStale follows the watchdog rules', () => {
    expect(deriveIsStale(lead({ id: 7, created_at: ago(130) }), true, NOW, cfg)).toBe(true);
    expect(deriveIsStale(lead({ id: 8, created_at: ago(100) }), true, NOW, cfg)).toBe(false);
    expect(deriveIsStale(lead({ id: 9, stage: 'qualified', score: 'hot', first_response_at: ago(3000), last_activity_at: ago(60 * 25) }), true, NOW, cfg)).toBe(true);
    expect(deriveIsStale(lead({ id: 9, stage: 'qualified', score: 'cold', first_response_at: ago(3000), last_activity_at: ago(60 * 25) }), true, NOW, cfg)).toBe(false);
  });
  it('needs coaching flags only a clearly slower agent', () => {
    const rows = [30, 20, 25, 140].map((m, i) => ({ rank: i + 1, agent_id: i + 1, name: 'x', active: true, open_leads: 0, leads_assigned: 0, avg_first_response_min: m, follow_ups_done: 0, visits_booked: 0, visits_done: 0, conversions: 0, conversion_pct: null, stale_count: 0 }));
    expect(needsCoaching(rows)).toBe(4);
    expect(needsCoaching(rows.map((r) => ({ ...r, avg_first_response_min: 30 })))).toBeNull();
  });
});

describe('overview', () => {
  it('previous period is the same length immediately before', () => {
    expect(previousPeriod({ from: '2026-10-04', to: '2026-11-02' })).toEqual({ from: '2026-09-04', to: '2026-10-03' });
    expect(defaultPeriod(NOW, 30)).toEqual({ from: '2026-10-04', to: '2026-11-02' });
  });
  it('series sums to the totals', () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead({ id: i + 1, created_at: ago(60 * 24 * (i % 5) + 30), stage: 'new' }));
    const o = computeOverview({ ...empty, leads }, defaultPeriod(NOW, 7), NOW, cfg);
    expect(o.series.reduce((a, d) => a + d.new_leads, 0)).toBe(o.totals.new_leads);
    expect(o.series).toHaveLength(7);
  });
});
