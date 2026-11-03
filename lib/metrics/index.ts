/**
 * Shared metrics module. EVERY derived number in the app (mock responses, tests, and the client-side
 * helpers) is computed here from raw records, using the backend's own formulas
 * (sql/02_views.sql, sql/03_functions.sql). In live mode the backend computes the same numbers in SQL;
 * the contract tests make sure both sides agree on shape.
 *
 * Definitions (copied from the backend):
 *  - first response  = first human-touch event (called | followup_done | stage_change by an agent) - created_at
 *  - funnel "reached" = highest stage ever reached (events + current stage); junk excluded from the funnel
 *  - site visit       = lead reached `visited`;  visit booked = reached `site_visit_booked`
 *  - cost per lead = cost / leads, cost per site visit = cost / site visits (visited),
 *    cost per visit booked = cost / visits booked, cost per closure = cost / closed_won
 *  - consider cutting = paid source AND (no site visits OR cost per site visit > multiplier x best PAID source)
 *  - cohort metrics (funnel, ROI, speed) group by the IST date the lead was created;
 *    activity metrics (overview visits/closures, leaderboard) count events inside the period.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  FUNNEL_STAGES,
  OPEN_STAGES,
  SOURCES,
  type EscalationLevel,
  type FunnelResponse,
  type LeaderboardRow,
  type OverviewResponse,
  type RoiRow,
  type SourceRoiResponse,
  type SpeedResponse,
  type Source,
  type Stage,
  type StaleLead,
} from '@contracts/realestate-api';
import type { Cfg, Dataset, Period, RawAgent, RawCost, RawEvent, RawLead, RawListing, RawMatch } from './types';

export * from './types';

export const IST = 'Asia/Kolkata';
export const DEFAULT_CFG: Cfg = {
  sla_first_response_min: 120,
  escalate_owner_min: 180,
  reassign_min: 240,
  max_reassignments: 3,
  stale_days_hot: 1,
  stale_days_warm: 3,
  stale_days_cold: 7,
  match_tolerance_pct: 15,
  match_threshold: 70,
  match_hot_score: 85,
  match_max_per_listing: 25,
  match_weight_location: 35,
  match_weight_property_type: 25,
  match_weight_bhk: 20,
  match_weight_budget: 20,
  consider_cut_multiplier: 2,
  visit_reminder_minutes: 120,
};

/* ------------------------------------------------------------------ dates */
export const istDate = (d: Date | string): string => formatInTimeZone(new Date(d), IST, 'yyyy-MM-dd');
export const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysInclusive = (p: Period): number =>
  Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86400000) + 1;
export const dateRange = (p: Period): string[] => Array.from({ length: daysInclusive(p) }, (_, i) => addDays(p.from, i));
export const startOf = (ymd: string): Date => fromZonedTime(`${ymd}T00:00:00`, IST);
export const endOfExclusive = (p: Period): Date => startOf(addDays(p.to, 1));
export const inPeriod = (iso: string, p: Period): boolean => {
  const t = new Date(iso).getTime();
  return t >= startOf(p.from).getTime() && t < endOfExclusive(p).getTime();
};
export const defaultPeriod = (now: Date, days = 30): Period => {
  const to = istDate(now);
  return { from: addDays(to, -(days - 1)), to };
};
export const previousPeriod = (p: Period): Period => {
  const n = daysInclusive(p);
  return { from: addDays(p.from, -n), to: addDays(p.from, -1) };
};
export const monthOf = (ymd: string): string => `${ymd.slice(0, 7)}-01`;
export const monthRange = (month: string): Period => {
  const from = monthOf(month);
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
};
export const addMonths = (month: string, n: number): string => {
  const d = new Date(`${monthOf(month)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const daysInMonth = (month: string) => daysInclusive(monthRange(month));
/** Monday = 0 … Sunday = 6, in IST */
export const istWeekday = (d: Date | string): number => Number(formatInTimeZone(new Date(d), IST, 'i')) - 1;
export const istHour = (d: Date | string): number => Number(formatInTimeZone(new Date(d), IST, 'H'));

/* ------------------------------------------------------------------ small maths */
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
export const avg = (xs: number[]): number | null => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
/** percentile_cont(0.5) */
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const ratio = (a: number, b: number): number | null => (b > 0 ? round1((100 * a) / b) : null);
const per = (cost: number, n: number): number | null => (cost > 0 && n > 0 ? round2(cost / n) : null);
export const minutesBetween = (a: string, b: string | Date): number => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

/* ------------------------------------------------------------------ stage helpers */
export const stageOrd = (s: Stage | null | undefined): number => {
  switch (s) {
    case 'new': return 1;
    case 'qualified': return 2;
    case 'site_visit_booked': return 3;
    case 'visited': return 4;
    case 'negotiation': return 5;
    case 'closed_won': return 6;
    default: return 0;
  }
};
export const isOpen = (s: Stage): boolean => (OPEN_STAGES as readonly string[]).includes(s);

export function indexEvents(events: RawEvent[]): Map<number, RawEvent[]> {
  const m = new Map<number, RawEvent[]>();
  for (const e of events) {
    const arr = m.get(e.lead_id);
    if (arr) arr.push(e);
    else m.set(e.lead_id, [e]);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  return m;
}

/** v_lead_progress.max_ord */
export function maxOrd(lead: RawLead, evs: RawEvent[] = []): number {
  let m = Math.max(1, stageOrd(lead.stage));
  for (const e of evs) if (e.to_stage) m = Math.max(m, stageOrd(e.to_stage));
  return m;
}

/** Stage of a lead at an instant, from its created / stage_change events. */
export function stageAt(lead: RawLead, evs: RawEvent[], t: Date): Stage | null {
  if (new Date(lead.created_at).getTime() > t.getTime()) return null;
  let s: Stage = 'new';
  for (const e of evs) {
    if (new Date(e.created_at).getTime() > t.getTime()) break;
    if ((e.event_type === 'created' || e.event_type === 'stage_change') && e.to_stage) s = e.to_stage;
  }
  return s;
}

const HUMAN_TOUCH = new Set(['called', 'followup_done', 'stage_change']);
/** First human touch: an agent-made call / follow-up / stage change. A note is not a touch. */
export function firstHumanTouch(evs: RawEvent[]): RawEvent | null {
  return evs.find((e) => HUMAN_TOUCH.has(e.event_type) && e.agent_id != null) ?? null;
}
export const responseMinutes = (l: RawLead): number | null =>
  l.first_response_at ? Math.max(0, minutesBetween(l.created_at, l.first_response_at)) : null;
/** v_speed_to_lead.breached */
export function isBreaching(l: RawLead, now: Date, sla: number): boolean {
  const r = responseMinutes(l);
  return r != null ? r > sla : minutesBetween(l.created_at, now) > sla;
}

/* ------------------------------------------------------------------ scoping */
export interface Scope {
  /** only this agent's leads (agent role) */
  agentId?: number;
  includeTest?: boolean;
}
export const scopeLeads = (leads: RawLead[], s: Scope = {}): RawLead[] =>
  leads.filter((l) => (s.includeTest || !l.is_test) && (s.agentId == null || l.assigned_agent_id === s.agentId));
const cohort = (leads: RawLead[], p: Period) => leads.filter((l) => inPeriod(l.created_at, p));

/* ------------------------------------------------------------------ stale & escalation */
export interface StaleInfo {
  level: EscalationLevel;
  reason: string;
  minutes_waiting: number;
  idle_days: number;
}
/** What the watchdog would flag right now (used to seed `is_stale` and to test it). */
export function deriveIsStale(l: RawLead, agentActive: boolean, now: Date, cfg: Cfg): boolean {
  if (!isOpen(l.stage) || l.assigned_agent_id == null) return false;
  if (l.stage === 'new' && !l.first_response_at) {
    const base = l.reassign_count === 0 ? l.created_at : (l.assigned_at ?? l.created_at);
    if (minutesBetween(base, now) >= cfg.sla_first_response_min) return true;
  }
  const watched =
    l.stage === 'qualified' || l.stage === 'visited' || l.stage === 'negotiation' ||
    (l.stage === 'site_visit_booked' && (!l.visit_at || new Date(l.visit_at) < now)) ||
    (l.stage === 'new' && !!l.first_response_at);
  if (!watched || !agentActive) return false;
  const days = l.score === 'hot' ? cfg.stale_days_hot : l.score === 'warm' ? cfg.stale_days_warm : cfg.stale_days_cold;
  return minutesBetween(l.last_activity_at, now) > days * 1440;
}

export function staleInfo(l: RawLead, now: Date, cfg: Cfg): StaleInfo | null {
  if (!l.is_stale || !isOpen(l.stage)) return null;
  const idle = Math.floor(minutesBetween(l.last_activity_at, now) / 1440);
  if (l.stage === 'new' && !l.first_response_at) {
    const base = l.reassign_count === 0 ? l.created_at : (l.assigned_at ?? l.created_at);
    const waiting = Math.round(minutesBetween(base, now));
    const level: EscalationLevel =
      l.reassign_count > 0 ? 'auto_reassigned' : waiting >= cfg.escalate_owner_min ? 'owner_escalated' : 'agent_nudged';
    return { level, reason: 'No first response yet', minutes_waiting: waiting, idle_days: idle };
  }
  return { level: 'inactive', reason: `No activity for ${idle} day${idle === 1 ? '' : 's'}`, minutes_waiting: Math.round(minutesBetween(l.last_activity_at, now)), idle_days: idle };
}

export function computeStale(ds: Dataset, now: Date, cfg: Cfg, scope: Scope = {}): StaleLead[] {
  const names = new Map(ds.agents.map((a) => [a.id, a.name]));
  const out: StaleLead[] = [];
  for (const l of scopeLeads(ds.leads, scope)) {
    const info = staleInfo(l, now, cfg);
    if (!info) continue;
    out.push({
      lead_id: l.id, name: l.name, phone: l.phone, score: l.score, stage: l.stage, source: l.source,
      agent_id: l.assigned_agent_id, agent_name: l.assigned_agent_id != null ? (names.get(l.assigned_agent_id) ?? null) : null,
      level: info.level, reason: info.reason, minutes_waiting: info.minutes_waiting, idle_days: info.idle_days,
      created_at: l.created_at, last_activity_at: l.last_activity_at,
    });
  }
  const rank: Record<EscalationLevel, number> = { auto_reassigned: 0, owner_escalated: 1, agent_nudged: 2, inactive: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.minutes_waiting - a.minutes_waiting);
}

/* ------------------------------------------------------------------ speed to lead */
function speedStat(ls: RawLead[], now: Date, sla: number) {
  const rs = ls.map(responseMinutes).filter((x): x is number => x != null);
  return {
    leads: ls.length,
    responded: rs.length,
    avg_min: avg(rs),
    median_min: median(rs),
    breaches: ls.filter((l) => isBreaching(l, now, sla)).length,
  };
}

export function computeSpeed(ds: Dataset, p: Period, now: Date, cfg: Cfg, scope: Scope = {}): SpeedResponse {
  const sla = cfg.sla_first_response_min;
  const ls = cohort(scopeLeads(ds.leads, scope), p).filter((l) => l.stage !== 'junk');
  const rs = ls.map(responseMinutes).filter((x): x is number => x != null);
  const within = (m: number) => ratio(rs.filter((r) => r <= m).length, rs.length);

  const agentKey = (l: RawLead) => l.first_response_agent_id ?? l.assigned_agent_id;
  const nameOf = new Map(ds.agents.map((a) => [a.id, a.name]));
  const byAgentMap = new Map<number | null, RawLead[]>();
  for (const l of ls) {
    const k = agentKey(l);
    byAgentMap.set(k, [...(byAgentMap.get(k) ?? []), l]);
  }
  const by_agent = [...byAgentMap.entries()]
    .map(([id, group]) => ({ agent_id: id, agent_name: id != null ? (nameOf.get(id) ?? `Agent ${id}`) : 'Unassigned', ...speedStat(group, now, sla) }))
    .sort((a, b) => (a.avg_min ?? 1e9) - (b.avg_min ?? 1e9));

  const by_source = SOURCES.map((source) => ({ source, ...speedStat(ls.filter((l) => l.source === source), now, sla) })).filter((r) => r.leads > 0);

  const hourBuckets = new Map<number, number[]>();
  const hourLeads = new Map<number, number>();
  const heat = new Map<string, { n: number; rs: number[] }>();
  for (const l of ls) {
    const h = istHour(l.created_at);
    const wd = istWeekday(l.created_at);
    hourLeads.set(h, (hourLeads.get(h) ?? 0) + 1);
    const k = `${wd}-${h}`;
    const cell = heat.get(k) ?? { n: 0, rs: [] };
    cell.n++;
    const r = responseMinutes(l);
    if (r != null) {
      hourBuckets.set(h, [...(hourBuckets.get(h) ?? []), r]);
      cell.rs.push(r);
    }
    heat.set(k, cell);
  }
  const by_hour = Array.from({ length: 24 }, (_, hour) => ({ hour, leads: hourLeads.get(hour) ?? 0, avg_min: avg(hourBuckets.get(hour) ?? []) }));
  const heatmap = [...heat.entries()].map(([k, v]) => {
    const [weekday, hour] = k.split('-').map(Number);
    return { weekday, hour, leads: v.n, avg_min: avg(v.rs) };
  });

  const breach_trend = dateRange(p).map((date) => {
    const day = ls.filter((l) => istDate(l.created_at) === date);
    return { date, leads: day.length, breaches: day.filter((l) => isBreaching(l, now, sla)).length };
  });

  const stale = computeStale(ds, now, cfg, scope);
  const levels: EscalationLevel[] = ['agent_nudged', 'owner_escalated', 'auto_reassigned', 'inactive'];
  const escalation = levels.map((level) => ({ level, count: stale.filter((s) => s.level === level).length }));

  return {
    overall: { ...speedStat(ls, now, sla), pct_within_5: within(5), pct_within_30: within(30), pct_within_120: within(120) },
    by_agent, by_source, by_hour, heatmap, breach_trend, escalation,
  };
}

/* ------------------------------------------------------------------ funnel */
export interface FunnelFilter extends Scope {
  source?: Source;
}
export function computeFunnel(ds: Dataset, p: Period, now: Date, f: FunnelFilter = {}): FunnelResponse {
  const evIdx = indexEvents(ds.events);
  const all = cohort(scopeLeads(ds.leads, f), p).filter((l) => !f.source || l.source === f.source);
  const funnelLeads = all.filter((l) => l.stage !== 'junk');
  const ords = new Map(funnelLeads.map((l) => [l.id, maxOrd(l, evIdx.get(l.id))]));

  // completed time spent per stage, from stage_change events
  const spent = new Map<Stage, number[]>();
  for (const l of funnelLeads) {
    const evs = (evIdx.get(l.id) ?? []).filter((e) => e.event_type === 'stage_change' && e.to_stage);
    let cur: Stage = 'new';
    let since = l.created_at;
    for (const e of evs) {
      if (e.to_stage === cur) continue;
      if (FUNNEL_STAGES.includes(cur as (typeof FUNNEL_STAGES)[number])) spent.set(cur, [...(spent.get(cur) ?? []), minutesBetween(since, e.created_at) / 1440]);
      cur = e.to_stage as Stage;
      since = e.created_at;
    }
  }

  const stages = FUNNEL_STAGES.map((stage, i) => {
    const ord = i + 1;
    const reached = funnelLeads.filter((l) => (ords.get(l.id) ?? 0) >= ord).length;
    return { stage, reached, currently_in: funnelLeads.filter((l) => l.stage === stage).length, ord };
  });
  const out = stages.map((s, i) => {
    const prev = i === 0 ? null : stages[i - 1].reached;
    return {
      stage: s.stage, reached: s.reached, currently_in: s.currently_in,
      conv_from_prev_pct: prev == null ? null : ratio(s.reached, prev),
      conv_from_top_pct: ratio(s.reached, stages[0].reached),
      drop_off: prev == null ? 0 : Math.max(0, prev - s.reached),
      avg_days_in_stage: avg(spent.get(s.stage) ?? []) == null ? null : round1(avg(spent.get(s.stage) ?? [])!),
    };
  });

  const reasons = new Map<string, number>();
  for (const l of all.filter((x) => x.stage === 'closed_lost')) {
    const r = (l.lost_reason ?? 'No reason given').trim() || 'No reason given';
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const junk_by_source = SOURCES.map((source) => {
    const ls = all.filter((l) => l.source === source);
    const junk = ls.filter((l) => l.stage === 'junk').length;
    return { source, leads: ls.length, junk, junk_rate_pct: ratio(junk, ls.length) };
  }).filter((r) => r.leads > 0);

  return {
    stages: out,
    lost_reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    junk_by_source,
    totals: {
      leads: all.length,
      junk: all.filter((l) => l.stage === 'junk').length,
      closed_lost: all.filter((l) => l.stage === 'closed_lost').length,
      open: all.filter((l) => isOpen(l.stage)).length,
    },
  };
}

/* ------------------------------------------------------------------ source ROI */
/** Monthly cost of a source summed over a period, pro-rated by days for partial months. */
export function spendInRange(costs: RawCost[], p: Period, source?: Source): number {
  let total = 0;
  for (const c of costs) {
    if (c.is_test || (source && c.source !== source)) continue;
    const mr = monthRange(c.month);
    const from = mr.from > p.from ? mr.from : p.from;
    const to = mr.to < p.to ? mr.to : p.to;
    if (from > to) continue;
    total += (c.amount_inr * daysInclusive({ from, to })) / daysInMonth(c.month);
  }
  return Math.round(total * 100) / 100;
}

export function roiRows(ds: Dataset, p: Period, costOf: (s: Source) => number, cfg: Cfg, scope: Scope = {}): RoiRow[] {
  const evIdx = indexEvents(ds.events);
  const ls = cohort(scopeLeads(ds.leads, scope), p);
  const base = SOURCES.map((source) => {
    const sl = ls.filter((l) => l.source === source);
    const ords = sl.map((l) => maxOrd(l, evIdx.get(l.id)));
    const cost = costOf(source);
    return {
      source, cost_inr: cost, leads: sl.length,
      junk: sl.filter((l) => l.stage === 'junk').length,
      qualified: ords.filter((o) => o >= 2).length,
      visits_booked: ords.filter((o) => o >= 3).length,
      site_visits: ords.filter((o) => o >= 4).length,
      closures: sl.filter((l) => l.stage === 'closed_won').length,
    };
  }).filter((r) => r.leads > 0 || r.cost_inr > 0);

  // best PAID source with site visits (monthly_roi_report.best)
  const withCps = base.filter((r) => r.cost_inr > 0 && r.site_visits > 0).map((r) => ({ source: r.source, cps: r.cost_inr / r.site_visits }));
  const best = withCps.sort((a, b) => a.cps - b.cps)[0] ?? null;

  const rows = base.map((r): RoiRow => {
    const cps = per(r.cost_inr, r.site_visits);
    const consider =
      r.cost_inr > 0 && (r.site_visits === 0 || (best != null && r.cost_inr / r.site_visits > cfg.consider_cut_multiplier * best.cps));
    let advice: string;
    if (r.cost_inr === 0) advice = 'No cost entered for this source.';
    else if (r.site_visits === 0) advice = `Consider cutting: ${rupees(r.cost_inr)} spent and no site visits from ${r.leads} leads.`;
    else if (consider && best) advice = `Consider cutting: ${rupees(cps!)} per site visit is ${round1(cps! / best.cps)}x the best source (${best.source}, ${rupees(best.cps)}).`;
    else advice = `Keep: ${rupees(cps!)} per site visit.`;
    return {
      ...r,
      cost_per_lead: per(r.cost_inr, r.leads),
      cost_per_visit_booked: per(r.cost_inr, r.visits_booked),
      cost_per_site_visit: cps,
      cost_per_closure: per(r.cost_inr, r.closures),
      consider_cut: consider,
      advice,
    };
  });
  return rows.sort((a, b) => (a.cost_per_site_visit ?? 1e12) - (b.cost_per_site_visit ?? 1e12) || b.leads - a.leads);
}
const rupees = (n: number) => 'Rs ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));

export function bestAndWorst(rows: RoiRow[]): { best: { source: Source; cost_per_site_visit: number } | null; worst: { source: Source; cost_per_site_visit: number } | null } {
  const paid = rows.filter((r) => r.cost_inr > 0 && r.cost_per_site_visit != null).sort((a, b) => a.cost_per_site_visit! - b.cost_per_site_visit!);
  if (!paid.length) return { best: null, worst: null };
  const f = (r: RoiRow) => ({ source: r.source, cost_per_site_visit: r.cost_per_site_visit! });
  return { best: f(paid[0]), worst: paid.length > 1 ? f(paid[paid.length - 1]) : null };
}

export function computeSourceRoi(ds: Dataset, month: string, now: Date, cfg: Cfg): SourceRoiResponse {
  const m = monthOf(month);
  const p = monthRange(m);
  const costs = ds.costs.filter((c) => !c.is_test);
  const rows = roiRows(ds, p, (s) => costs.find((c) => c.source === s && c.month === m)?.amount_inr ?? 0, cfg);

  // history: months that have any lead or cost data, up to 6, ending at the selected month
  const evIdx = indexEvents(ds.events);
  const history: SourceRoiResponse['history'] = [];
  for (let i = 5; i >= 0; i--) {
    const hm = addMonths(m, -i);
    const hp = monthRange(hm);
    const ls = cohort(scopeLeads(ds.leads), hp);
    const spend = costs.filter((c) => c.month === hm).reduce((a, c) => a + c.amount_inr, 0);
    if (!ls.length && !spend) continue;
    history.push({
      month: hm.slice(0, 7),
      spend_inr: spend,
      closures: ls.filter((l) => l.stage === 'closed_won').length,
      site_visits: ls.filter((l) => maxOrd(l, evIdx.get(l.id)) >= 4).length,
      leads: ls.length,
    });
  }

  const current = monthOf(istDate(now));
  const prev = addMonths(current, -1);
  const paidBefore = new Set(costs.filter((c) => c.month === prev && c.amount_inr > 0).map((c) => c.source));
  const have = new Set(costs.filter((c) => c.month === current).map((c) => c.source));
  const missing_current_month = [...paidBefore].filter((s) => !have.has(s));

  return { month: m, rows, best_source: bestAndWorst(rows).best, history, missing_current_month, current_month: current };
}

/* ------------------------------------------------------------------ leaderboard */
export function computeLeaderboard(ds: Dataset, p: Period, now: Date, scope: Scope = {}): LeaderboardRow[] {
  const real = new Set(ds.leads.filter((l) => !l.is_test).map((l) => l.id));
  const evs = ds.events.filter((e) => real.has(e.lead_id) && e.agent_id != null && inPeriod(e.created_at, p));
  const ls = ds.leads.filter((l) => !l.is_test);
  const rows = ds.agents
    .filter((a) => a.active && (scope.agentId == null || a.id === scope.agentId))
    .map((a) => {
      const mine = evs.filter((e) => e.agent_id === a.id);
      const assigned = new Set(mine.filter((e) => e.event_type === 'assigned' || e.event_type === 'reassigned_stale').map((e) => e.lead_id)).size;
      const conversions = mine.filter((e) => e.event_type === 'stage_change' && e.to_stage === 'closed_won').length;
      const resp = ls
        .filter((l) => l.first_response_agent_id === a.id && inPeriod(l.created_at, p))
        .map(responseMinutes)
        .filter((x): x is number => x != null);
      return {
        agent_id: a.id, name: a.name, active: a.active,
        open_leads: ls.filter((l) => l.assigned_agent_id === a.id && isOpen(l.stage)).length,
        leads_assigned: assigned,
        avg_first_response_min: avg(resp),
        follow_ups_done: mine.filter((e) => e.event_type === 'called' || e.event_type === 'followup_done').length,
        visits_booked: mine.filter((e) => e.event_type === 'stage_change' && e.to_stage === 'site_visit_booked' && e.from_stage !== 'site_visit_booked').length,
        visits_done: mine.filter((e) => e.event_type === 'stage_change' && e.to_stage === 'visited').length,
        conversions,
        conversion_pct: ratio(conversions, assigned),
        stale_count: ls.filter((l) => l.assigned_agent_id === a.id && l.is_stale && isOpen(l.stage)).length,
      };
    });
  const sorted = [...rows].sort((a, b) => b.conversions - a.conversions || b.visits_booked - a.visits_booked || b.follow_ups_done - a.follow_ups_done);
  return sorted.map((r) => ({
    ...r,
    rank: 1 + sorted.filter((o) => o.conversions > r.conversions || (o.conversions === r.conversions && (o.visits_booked > r.visits_booked || (o.visits_booked === r.visits_booked && o.follow_ups_done > r.follow_ups_done)))).length,
  }));
}

/** The slowest agent, flagged when clearly slower than the team (2x the median of agent averages). */
export function needsCoaching(rows: LeaderboardRow[]): number | null {
  const withAvg = rows.filter((r) => r.avg_first_response_min != null);
  if (withAvg.length < 3) return null;
  const med = median(withAvg.map((r) => r.avg_first_response_min!))!;
  const slowest = [...withAvg].sort((a, b) => b.avg_first_response_min! - a.avg_first_response_min!)[0];
  return slowest.avg_first_response_min! >= Math.max(2 * med, 30) ? slowest.agent_id : null;
}

/* ------------------------------------------------------------------ overview */
export function computeTotals(ds: Dataset, p: Period, now: Date, cfg: Cfg, scope: Scope = {}) {
  const evIdx = indexEvents(ds.events);
  const leads = scopeLeads(ds.leads, scope);
  const real = new Set(leads.map((l) => l.id));
  const ls = cohort(leads, p);
  const answered = ls.filter((l) => l.stage !== 'junk');
  const rs = answered.map(responseMinutes).filter((x): x is number => x != null);
  const evs = ds.events.filter((e) => real.has(e.lead_id) && e.event_type === 'stage_change' && inPeriod(e.created_at, p));
  const asOf = new Date(Math.min(now.getTime(), endOfExclusive(p).getTime() - 1));
  const hot_open = leads.filter((l) => {
    if (l.score !== 'hot') return false;
    const s = stageAt(l, evIdx.get(l.id) ?? [], asOf);
    return s != null && isOpen(s);
  }).length;
  return {
    new_leads: ls.length,
    avg_first_response_min: avg(rs),
    median_first_response_min: median(rs),
    breaching_sla: answered.filter((l) => isBreaching(l, now, cfg.sla_first_response_min)).length,
    hot_open,
    visits_booked: evs.filter((e) => e.to_stage === 'site_visit_booked' && e.from_stage !== 'site_visit_booked').length,
    visits_done: evs.filter((e) => e.to_stage === 'visited').length,
    closures: evs.filter((e) => e.to_stage === 'closed_won').length,
    spend_inr: Math.round(spendInRange(ds.costs, p)),
  };
}

export function computeOverview(ds: Dataset, p: Period, now: Date, cfg: Cfg, scope: Scope = {}): OverviewResponse {
  const prev = previousPeriod(p);
  const totals = computeTotals(ds, p, now, cfg, scope);
  const previous = computeTotals(ds, prev, now, cfg, scope);
  const costs = ds.costs.filter((c) => !c.is_test);
  const rows = roiRows(ds, p, (s) => spendInRange(costs, p, s), cfg, scope);
  const { best, worst } = bestAndWorst(rows);

  const evIdx = indexEvents(ds.events);
  const leads = scopeLeads(ds.leads, scope);
  const ids = new Set(leads.map((l) => l.id));
  const stageEvs = ds.events.filter((e) => ids.has(e.lead_id) && e.event_type === 'stage_change');
  const series = dateRange(p).map((date) => {
    const day = leads.filter((l) => istDate(l.created_at) === date);
    const rs = day.filter((l) => l.stage !== 'junk').map(responseMinutes).filter((x): x is number => x != null);
    const dayEv = stageEvs.filter((e) => istDate(e.created_at) === date);
    const endOfDay = new Date(Math.min(now.getTime(), startOf(addDays(date, 1)).getTime() - 1));
    return {
      date,
      new_leads: day.length,
      avg_first_response_min: avg(rs),
      breaching_sla: day.filter((l) => l.stage !== 'junk' && isBreaching(l, now, cfg.sla_first_response_min)).length,
      hot_open: leads.filter((l) => {
        if (l.score !== 'hot') return false;
        const s = stageAt(l, evIdx.get(l.id) ?? [], endOfDay);
        return s != null && isOpen(s);
      }).length,
      visits_booked: dayEv.filter((e) => e.to_stage === 'site_visit_booked' && e.from_stage !== 'site_visit_booked').length,
      closures: dayEv.filter((e) => e.to_stage === 'closed_won').length,
      spend_inr: Math.round(spendInRange(costs, { from: date, to: date })),
    };
  });
  return { period: p, previous_period: prev, totals, previous, best_source: best, worst_source: worst, series };
}

export function delta(cur: number | null, prev: number | null): { abs: number; pct: number | null } | null {
  if (cur == null || prev == null) return null;
  return { abs: round1(cur - prev), pct: prev === 0 ? null : round1(((cur - prev) / prev) * 100) };
}

/* ------------------------------------------------------------------ inventory matching (sql: Matcher | Match Buyers To Listing) */
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();
export function matchScore(li: Pick<RawListing, 'location' | 'property_type' | 'bhk' | 'price'>, l: Pick<RawLead, 'location_pref' | 'property_type' | 'bhk' | 'budget_min' | 'budget_max'>, cfg: Cfg): number | null {
  let fLoc: number | null;
  const pref = norm(l.location_pref).trim();
  if (!pref) fLoc = 0.5;
  else {
    const loc = norm(li.location);
    fLoc = pref.split(',').map((t) => t.trim()).some((t) => t && (loc.includes(t) || t.includes(loc))) ? 1 : null;
  }
  const fType = l.property_type == null ? 0.5 : l.property_type === li.property_type ? 1 : null;
  const fBhk = l.bhk == null || li.bhk == null ? 0.5 : l.bhk === li.bhk ? 1 : null;
  let fBud: number | null;
  if (l.budget_min == null && l.budget_max == null) fBud = 0.5;
  else {
    const lo = l.budget_min ?? 0;
    const hi = l.budget_max ?? 1e15;
    const t = cfg.match_tolerance_pct / 100;
    fBud = li.price >= lo && li.price <= hi ? 1 : li.price >= lo * (1 - t) && li.price <= hi * (1 + t) ? 0.6 : null;
  }
  if (fLoc == null || fType == null || fBhk == null || fBud == null) return null;
  const w = cfg.match_weight_location + cfg.match_weight_property_type + cfg.match_weight_bhk + cfg.match_weight_budget;
  if (!w) return null;
  return round2((100 * (cfg.match_weight_location * fLoc + cfg.match_weight_property_type * fType + cfg.match_weight_bhk * fBhk + cfg.match_weight_budget * fBud)) / w);
}

/** New matches for a listing: open leads with a phone, not yet matched, at or above the threshold, best first, capped. */
export function matchListing(li: RawListing, leads: RawLead[], existing: RawMatch[], cfg: Cfg): { lead_id: number; match_score: number }[] {
  if (li.status !== 'open') return [];
  const taken = new Set(existing.filter((m) => m.listing_id === li.id).map((m) => m.lead_id));
  return leads
    // test listings only match test buyers, so a test run can never message a real buyer
    .filter((l) => l.phone && isOpen(l.stage) && !taken.has(l.id) && l.is_test === li.is_test)
    .map((l) => ({ lead_id: l.id, match_score: matchScore(li, l, cfg) }))
    .filter((m): m is { lead_id: number; match_score: number } => m.match_score != null && m.match_score >= cfg.match_threshold)
    .sort((a, b) => b.match_score - a.match_score || a.lead_id - b.lead_id)
    .slice(0, cfg.match_max_per_listing);
}

export function listingCounts(li: RawListing, matches: RawMatch[]) {
  const ms = matches.filter((m) => m.listing_id === li.id);
  return {
    matched: ms.length,
    messaged: ms.filter((m) => m.messaged_at).length,
    responded: ms.filter((m) => m.responded_at).length,
    interested: ms.filter((m) => m.interested === true).length,
  };
}

export type { RawAgent };
