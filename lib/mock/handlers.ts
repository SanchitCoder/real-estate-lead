/**
 * Mock backend. Implements every endpoint of the contract with the SAME request/response shapes,
 * and really mutates the in-memory store (a stage update moves the lead through the funnel, a reassignment
 * changes the owner, a new listing generates matches with the SQL matcher's rules, ...).
 * The rules mirror sql/03_functions.sql so mock and live behave alike.
 */
import {
  AGENT_COMMANDS, REJECT_REASONS, SOURCES, type EndpointKey, type EventType, type Meta, type Score, type Source, type Stage,
  type AddLeadResponse, type Lead, type LeadEvent, type ListingMatch, type ListingWithCounts, type Agent, type TestResponse,
} from '@contracts/realestate-api';
import { ApiError, type Actor } from '../api-error';
import { SOURCE_LABEL, STAGE_LABEL, istTime } from '../format';
import * as M from '../metrics';
import type { RawAgent, RawEvent, RawLead, RawListing } from '../metrics';
import { getStore, resetStore, type Store } from './store';

void AGENT_COMMANDS;
export interface MockResult { data: unknown; meta?: Meta }

const MIN = 60000;
const iso = (d: Date | number) => new Date(d).toISOString();

/* ---------------------------------------------------------------- mappers */
const agentName = (s: Store, id: number | null) => (id == null ? null : (s.agents.find((a) => a.id === id)?.name ?? null));

function toLead(l: RawLead, s: Store, now: Date): Lead {
  return {
    id: l.id, name: l.name, phone: l.phone, email: l.email, source: l.source, source_detail: l.source_detail, campaign: l.campaign,
    budget_min: l.budget_min, budget_max: l.budget_max, location_pref: l.location_pref, property_type: l.property_type, bhk: l.bhk,
    timeline: l.timeline, score: l.score, score_points: l.score_points, score_reason: l.score_reason, priority: l.priority,
    repeat_count: l.repeat_count, assigned_agent_id: l.assigned_agent_id, assigned_agent_name: agentName(s, l.assigned_agent_id),
    reassign_count: l.reassign_count, stage: l.stage, visit_at: l.visit_at, lost_reason: l.lost_reason, created_at: l.created_at,
    first_response_at: l.first_response_at, last_activity_at: l.last_activity_at, is_stale: l.is_stale, is_test: l.is_test,
    minutes_to_first_response: M.responseMinutes(l) == null ? null : Math.round(M.responseMinutes(l)! * 10) / 10,
    minutes_since_created: Math.round(M.minutesBetween(l.created_at, now)),
  };
}
const toEvent = (e: RawEvent, s: Store): LeadEvent => ({ ...e, agent_name: agentName(s, e.agent_id) });
function toMatch(m: Store['matches'][number], s: Store): ListingMatch {
  const l = s.leads.find((x) => x.id === m.lead_id)!;
  const li = s.listings.find((x) => x.id === m.listing_id)!;
  return {
    ...m, listing_title: li.title, lead_name: l.name, lead_phone: l.phone, lead_stage: l.stage, lead_score: l.score,
    assigned_agent_name: agentName(s, l.assigned_agent_id),
  };
}
const openLoad = (s: Store, id: number) => s.leads.filter((l) => !l.is_test && l.assigned_agent_id === id && M.isOpen(l.stage)).length;
const toAgent = (a: RawAgent, s: Store): Agent => ({ ...a, open_leads: openLoad(s, a.id) });
const toListing = (li: RawListing, s: Store): ListingWithCounts => ({ ...li, ...M.listingCounts(li, s.matches) });

/* ---------------------------------------------------------------- helpers */
export function normalizePhone(p: string | undefined | null): string | null {
  const d = (p ?? '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `+91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  if (/^0091[6-9]\d{9}$/.test(d)) return `+${d.slice(2)}`;
  return null;
}

function pushEvent(s: Store, e: Partial<RawEvent> & { lead_id: number; event_type: EventType }, at: Date): RawEvent {
  const ev: RawEvent = { id: s.next.event++, agent_id: null, from_stage: null, to_stage: null, note: null, created_at: iso(at), ...e };
  s.events.push(ev);
  return ev;
}

function period(q: { from?: string; to?: string }, now: Date): M.Period {
  const d = M.defaultPeriod(now, 30);
  const to = q.to ?? d.to;
  const from = q.from ?? (q.to ? M.addDays(to, -29) : d.from);
  if (from > to) throw new ApiError(400, 'The start date is after the end date.', { field: 'from' });
  return { from, to };
}

/* ---------------------------------------------------------------- scoring + assignment (mock of WF2) */
function scoreLead(l: RawLead, s: Store): { score: Score; points: number; reason: string } {
  const srcQ: Record<string, number> = { referral: 90, walk_in: 85, '99acres': 70, magicbricks: 65, website: 60, crm: 60, meta: 50, other: 40 };
  const budget = l.budget_min != null || l.budget_max != null ? ((l.budget_max ?? l.budget_min ?? 0) >= 3500000 ? 30 : 18) : 0;
  const tl: Record<string, number> = { immediate: 30, within_1_month: 30, '1_3_months': 22, '3_6_months': 12, '6_plus_months': 5, just_exploring: 3, unknown: 8 };
  const spec = (l.location_pref ? 5 : 0) + (l.property_type ? 5 : 0) + (l.bhk ? 5 : 0);
  const src = Math.round((srcQ[l.source] ?? 40) * 0.15);
  const rep = l.repeat_count > 0 ? 10 : 0;
  const points = Math.min(100, budget + tl[l.timeline] + spec + src + rep);
  const score: Score = points >= s.cfg.match_threshold ? 'hot' : points >= 40 ? 'warm' : 'cold';
  const reason = `${score === 'hot' ? 'Strong fit' : score === 'warm' ? 'Decent fit' : 'Weak fit'}: ${budget ? 'budget stated' : 'no budget given'}; timeline ${l.timeline.replace(/_/g, ' ')}; ${spec >= 10 ? 'specific requirement' : 'vague requirement'}; ${SOURCE_LABEL[l.source]} source.`;
  return { score, points, reason };
}

/** assign_lead(): active agent with capacity, not already tried; hot leads prefer the best 30-day converter. */
function assignLead(s: Store, l: RawLead, now: Date, reason: 'initial' | 'stale' = 'initial', exclude: number[] = []): RawAgent | null {
  const since = now.getTime() - 30 * 86400000;
  const recent = s.events.filter((e) => (e.event_type === 'assigned' || e.event_type === 'reassigned_stale') && e.agent_id != null && new Date(e.created_at).getTime() >= since);
  const tried = new Set(s.events.filter((e) => e.lead_id === l.id && (e.event_type === 'assigned' || e.event_type === 'reassigned_stale') && e.agent_id != null).map((e) => e.agent_id));
  const won = s.events.filter((e) => e.event_type === 'stage_change' && e.to_stage === 'closed_won' && new Date(e.created_at).getTime() >= since);
  const conv = (id: number) => {
    const a = new Set(recent.filter((e) => e.agent_id === id).map((e) => e.lead_id)).size;
    return a ? new Set(won.filter((e) => e.agent_id === id).map((e) => e.lead_id)).size / a : 0;
  };
  const load = (id: number) => recent.filter((e) => e.agent_id === id).length;
  const elig = s.agents
    .filter((a) => a.active && openLoad(s, a.id) < a.max_open_leads && a.id !== l.assigned_agent_id && !exclude.includes(a.id) && !tried.has(a.id))
    .sort((a, b) => (l.score === 'hot' ? conv(b.id) - conv(a.id) : 0) || load(a.id) / a.weight - load(b.id) / b.weight || a.round_robin_order - b.round_robin_order || a.id - b.id);
  const pick = elig[0];
  if (!pick) {
    pushEvent(s, { lead_id: l.id, event_type: 'unassigned', note: `No active agent with capacity (${reason})` }, now);
    return null;
  }
  const prev = l.assigned_agent_id;
  l.assigned_agent_id = pick.id;
  l.assigned_at = iso(now);
  l.is_stale = false;
  l.last_activity_at = iso(now);
  if (reason === 'stale') l.reassign_count += 1;
  pushEvent(s, { lead_id: l.id, agent_id: pick.id, event_type: reason === 'initial' ? 'assigned' : 'reassigned_stale', note: prev == null ? `Assigned to ${pick.name}` : `Reassigned from ${agentName(s, prev)} to ${pick.name}` }, now);
  return pick;
}

/* ---------------------------------------------------------------- shared intake chain (normalise → dedupe → insert → score → assign → notify) */
export interface IntakeInput {
  name?: string; phone?: string; email?: string; source: Source; source_detail?: string; campaign?: string;
  budget_min?: number; budget_max?: number; location_pref?: string; property_type?: RawLead['property_type'] | undefined; bhk?: number;
  timeline?: RawLead['timeline']; is_test?: boolean; at?: Date;
}
export function intake(s: Store, input: IntakeInput, now: Date): AddLeadResponse {
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  let bmin = input.budget_min ?? null;
  let bmax = input.budget_max ?? null;
  if (bmin != null && bmax != null && bmin > bmax) [bmin, bmax] = [bmax, bmin];

  const existing = s.leads.find((l) => (phone && l.phone === phone) || (email && l.email?.toLowerCase() === email));
  if (existing) {
    pushEvent(s, { lead_id: existing.id, agent_id: existing.assigned_agent_id, event_type: 'repeat_enquiry', note: `Repeat enquiry via ${input.source}` }, now);
    existing.priority += 1; existing.repeat_count += 1; existing.last_activity_at = iso(now);
    existing.budget_min ??= bmin; existing.budget_max ??= bmax; existing.email ??= email; existing.phone ??= phone;
    return {
      lead_id: existing.id, is_new: false, repeat_logged: true, stage: existing.stage, assigned_agent_id: existing.assigned_agent_id,
      assigned_agent_name: agentName(s, existing.assigned_agent_id),
      message: `${existing.name ?? 'This buyer'} is already in the system (lead #${existing.id}). Logged as a repeat enquiry and alerted ${agentName(s, existing.assigned_agent_id) ?? 'the team'}.`,
    };
  }
  const junk = !phone && !email;
  const lead: RawLead = {
    id: s.next.lead++, name: input.name?.trim() || null, phone, email, source: input.source, source_detail: input.source_detail ?? null, campaign: input.campaign ?? null,
    budget_min: bmin, budget_max: bmax, location_pref: input.location_pref?.trim() || null, property_type: input.property_type ?? null, bhk: input.bhk ?? null,
    timeline: input.timeline ?? 'unknown', score: null, score_points: null, score_reason: null, priority: 0, repeat_count: 0, assigned_agent_id: null, assigned_at: null,
    reassign_count: 0, stage: junk ? 'junk' : 'new', visit_at: null, lost_reason: null, created_at: iso(input.at ?? now), first_response_at: null,
    first_response_agent_id: null, last_activity_at: iso(input.at ?? now), is_stale: false, is_test: !!input.is_test,
  };
  s.leads.push(lead);
  pushEvent(s, { lead_id: lead.id, event_type: 'created', to_stage: lead.stage, note: `Captured from ${input.source}` }, input.at ?? now);
  if (junk) return { lead_id: lead.id, is_new: true, repeat_logged: false, stage: 'junk', assigned_agent_id: null, assigned_agent_name: null, message: 'Saved as junk: no phone or email.' };

  const sc = scoreLead(lead, s);
  Object.assign(lead, { score: sc.score, score_points: sc.points, score_reason: sc.reason });
  pushEvent(s, { lead_id: lead.id, event_type: 'scored', note: `${sc.score} (${sc.points}/100): ${sc.reason}` }, now);
  const agent = assignLead(s, lead, now);
  if (agent) {
    if (lead.phone) pushEvent(s, { lead_id: lead.id, event_type: 'auto_response_sent', note: 'Welcome WhatsApp sent' }, now);
    pushEvent(s, { lead_id: lead.id, agent_id: agent.id, event_type: 'agent_alerted', note: 'New-lead alert sent to agent' }, now);
  }
  return {
    lead_id: lead.id, is_new: true, repeat_logged: false, stage: lead.stage, assigned_agent_id: agent?.id ?? null, assigned_agent_name: agent?.name ?? null,
    message: agent
      ? `Lead added, scored ${sc.score}, and assigned to ${agent.name}.${lead.phone ? ' An instant WhatsApp reply went to the buyer.' : ''}`
      : 'Lead added and scored, but no agent has capacity. The owner has been alerted.',
  };
}

/* ---------------------------------------------------------------- shared stage-update chain (mock of apply_agent_command) */
interface StageResult { ok: boolean; reason: string; firstTouch: boolean; from: Stage; to: Stage; visitAt: string | null }
export function applyCommand(s: Store, lead: RawLead, agentId: number, eventType: EventType, toStage: Stage | null, note: string | null, visitAt: string | null, now: Date): StageResult {
  const reject = (reason: string): StageResult => {
    pushEvent(s, { lead_id: lead.id, agent_id: agentId, event_type: 'command_rejected', note: `${reason}: ${note ?? ''}` }, now);
    return { ok: false, reason, firstTouch: false, from: lead.stage, to: toStage ?? lead.stage, visitAt: null };
  };
  if (lead.assigned_agent_id !== agentId) return { ok: false, reason: 'not_your_lead', firstTouch: false, from: lead.stage, to: lead.stage, visitAt: null };
  if (['closed_won', 'closed_lost', 'junk'].includes(lead.stage) && eventType !== 'note') return reject('lead_closed');
  if (toStage) {
    if (toStage === 'site_visit_booked' && (!visitAt || new Date(visitAt) < now)) return reject('visit_time_missing_or_past');
    if (toStage === 'junk' && !['new', 'qualified'].includes(lead.stage)) return reject('junk_only_before_visit');
    if (toStage === 'closed_lost' && !note?.trim()) return reject('lost_reason_required');
    if (!['closed_lost', 'junk'].includes(toStage) && !(M.stageOrd(toStage) > M.stageOrd(lead.stage) || (toStage === 'site_visit_booked' && lead.stage === 'site_visit_booked'))) return reject('invalid_transition');
  }
  const touch = eventType !== 'note';
  const first = touch && !lead.first_response_at;
  const from = lead.stage;
  if (toStage) lead.stage = toStage;
  if (first) { lead.first_response_at = iso(now); lead.first_response_agent_id = agentId; }
  lead.last_activity_at = iso(now);
  lead.is_stale = false;
  if (toStage === 'site_visit_booked') lead.visit_at = visitAt;
  if (toStage === 'closed_lost') lead.lost_reason = note;
  pushEvent(s, { lead_id: lead.id, agent_id: agentId, event_type: eventType, from_stage: from, to_stage: toStage ?? from, note }, now);
  return { ok: true, reason: 'ok', firstTouch: first, from, to: toStage ?? from, visitAt: toStage === 'site_visit_booked' ? visitAt : lead.visit_at };
}

/* ---------------------------------------------------------------- listing matching (mock of WF5 chain) */
function matchAndMessage(s: Store, li: RawListing, now: Date): number {
  const found = M.matchListing(li, s.leads, s.matches, s.cfg);
  for (const m of found) {
    s.matches.push({ id: s.next.match++, listing_id: li.id, lead_id: m.lead_id, match_score: m.match_score, created_at: iso(now), messaged_at: iso(now), response: null, responded_at: null, interested: null });
    pushEvent(s, { lead_id: m.lead_id, event_type: 'listing_matched', note: `Matched ${li.title} (${Math.round(m.match_score)}%)` }, now);
  }
  return found.length;
}

/* ---------------------------------------------------------------- guards */
function leadOr404(s: Store, id: number): RawLead {
  const l = s.leads.find((x) => x.id === id);
  if (!l) throw new ApiError(404, 'That lead no longer exists.', { code: 'lead_not_found' });
  return l;
}
function ownOr403(l: RawLead, actor: Actor) {
  if (actor.role === 'agent' && l.assigned_agent_id !== actor.agentId) throw new ApiError(403, REJECT_REASONS.not_your_lead, { code: 'not_your_lead' });
}
const scopeOf = (actor: Actor) => ({ agentId: actor.role === 'agent' ? actor.agentId : undefined });

/* ---------------------------------------------------------------- main dispatcher */
export function handleMock(key: EndpointKey, query: any, body: any, actor: Actor, now = new Date()): MockResult {
  const s = getStore();
  const cfg = s.cfg;
  const q = query ?? {};

  switch (key) {
    /* ------------------------------ reads */
    case 'overview': {
      const p = period(q, now);
      const o = M.computeOverview(s, p, now, cfg, scopeOf(actor));
      return { data: o };
    }
    case 'leads': {
      const agentId = actor.role === 'agent' ? actor.agentId : q.agent_id;
      let rows = M.scopeLeads(s.leads, { includeTest: q.include_test === 'true', agentId });
      if (q.source) rows = rows.filter((l) => l.source === q.source);
      if (q.score) rows = rows.filter((l) => l.score === q.score);
      if (q.stage) rows = rows.filter((l) => l.stage === q.stage);
      if (q.stale) rows = rows.filter((l) => l.is_stale === (q.stale === 'true'));
      if (q.untouched === 'true') rows = rows.filter((l) => !l.first_response_at && l.stage !== 'junk');
      if (q.breaching === 'true') rows = rows.filter((l) => l.stage !== 'junk' && M.isBreaching(l, now, cfg.sla_first_response_min));
      if (q.visits_this_week === 'true') {
        const end = now.getTime() + 7 * 86400000;
        rows = rows.filter((l) => l.stage === 'site_visit_booked' && l.visit_at && new Date(l.visit_at).getTime() >= now.getTime() - 3600000 && new Date(l.visit_at).getTime() <= end);
      }
      if (q.from || q.to) rows = rows.filter((l) => { const d = M.istDate(l.created_at); return (!q.from || d >= q.from) && (!q.to || d <= q.to); });
      if (q.search) {
        const t = String(q.search).toLowerCase().trim();
        const digits = t.replace(/\D/g, '');
        rows = rows.filter((l) => `${l.name ?? ''} ${l.email ?? ''} ${l.location_pref ?? ''} ${l.source_detail ?? ''}`.toLowerCase().includes(t) || (digits.length >= 3 && (l.phone ?? '').includes(digits)) || String(l.id) === t.replace('#', ''));
      }
      const sort = q.sort ?? 'created_desc';
      const resp = (l: RawLead) => M.responseMinutes(l) ?? M.minutesBetween(l.created_at, now);
      const so: Record<string, (a: RawLead, b: RawLead) => number> = {
        created_desc: (a, b) => b.created_at.localeCompare(a.created_at),
        created_asc: (a, b) => a.created_at.localeCompare(b.created_at),
        last_activity_desc: (a, b) => b.last_activity_at.localeCompare(a.last_activity_at),
        response_desc: (a, b) => resp(b) - resp(a),
        score_desc: (a, b) => ({ hot: 0, warm: 1, cold: 2 } as any)[a.score ?? 'cold'] - ({ hot: 0, warm: 1, cold: 2 } as any)[b.score ?? 'cold'] || (b.score_points ?? 0) - (a.score_points ?? 0),
      };
      rows = [...rows].sort(so[sort]);
      const page_size = q.page_size ?? 25;
      const page = q.page ?? 1;
      return { data: rows.slice((page - 1) * page_size, page * page_size).map((l) => toLead(l, s, now)), meta: { page, page_size, total: rows.length } };
    }
    case 'lead': {
      const l = leadOr404(s, q.id);
      ownOr403(l, actor);
      const a = l.assigned_agent_id != null ? s.agents.find((x) => x.id === l.assigned_agent_id) : null;
      const evs = (M.indexEvents(s.events).get(l.id) ?? []).map((e) => toEvent(e, s));
      return { data: { lead: toLead(l, s, now), agent: a ? toAgent(a, s) : null, events: evs, matches: s.matches.filter((m) => m.lead_id === l.id).map((m) => toMatch(m, s)) } };
    }
    case 'speed': {
      const agentId = actor.role === 'agent' ? actor.agentId : q.agent_id;
      return { data: M.computeSpeed(s, period(q, now), now, cfg, { agentId }) };
    }
    case 'stale': {
      const agentId = actor.role === 'agent' ? actor.agentId : q.agent_id;
      return { data: M.computeStale(s, now, cfg, { agentId }) };
    }
    case 'funnel': {
      const agentId = actor.role === 'agent' ? actor.agentId : q.agent_id;
      return { data: M.computeFunnel(s, period(q, now), now, { agentId, source: q.source }) };
    }
    case 'sourceRoi': {
      const month = q.month ? `${String(q.month).slice(0, 7)}-01` : M.addMonths(M.monthOf(M.istDate(now)), -1);
      return { data: M.computeSourceRoi(s, month, now, cfg) };
    }
    case 'leaderboard': {
      const all = M.computeLeaderboard(s, period(q, now), now);
      return { data: actor.role === 'agent' ? all.filter((r) => r.agent_id === actor.agentId) : all };
    }
    case 'agents': {
      const list = actor.role === 'agent' ? s.agents.filter((a) => a.id === actor.agentId) : s.agents;
      return { data: list.map((a) => toAgent(a, s)) };
    }
    case 'listings': {
      let rows = s.listings.filter((l) => q.include_test === 'true' || !l.is_test);
      if (q.status) rows = rows.filter((l) => l.status === q.status);
      return { data: [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((l) => toListing(l, s)) };
    }
    case 'listing': {
      const li = s.listings.find((x) => x.id === q.id);
      if (!li) throw new ApiError(404, 'That listing no longer exists.');
      let ms = s.matches.filter((m) => m.listing_id === li.id);
      if (actor.role === 'agent') ms = ms.filter((m) => s.leads.find((l) => l.id === m.lead_id)?.assigned_agent_id === actor.agentId);
      return { data: { listing: toListing(li, s), matches: ms.sort((a, b) => b.match_score - a.match_score).map((m) => toMatch(m, s)) } };
    }
    case 'costs': {
      let rows = s.costs.filter((c) => q.include_test === 'true' || !c.is_test);
      if (q.from) rows = rows.filter((c) => c.month >= `${q.from.slice(0, 7)}-01`);
      if (q.to) rows = rows.filter((c) => c.month <= q.to);
      return { data: [...rows].sort((a, b) => b.month.localeCompare(a.month) || a.source.localeCompare(b.source)) };
    }
    case 'config':
      return { data: s.configRows };
    case 'errors': {
      const rows = s.errors.filter((e) => q.include_test === 'true' || !e.is_test).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const page = q.page ?? 1;
      return { data: rows.slice((page - 1) * 20, page * 20), meta: { page, page_size: 20, total: rows.length } };
    }

    /* ------------------------------ actions */
    case 'addLead': {
      const r = intake(s, { ...body, phone: body.phone || undefined, email: body.email || undefined, at: now }, now);
      if (body.notes?.trim()) pushEvent(s, { lead_id: r.lead_id, event_type: 'note', note: body.notes.trim() }, now);
      return { data: r };
    }
    case 'updateStage': {
      const l = leadOr404(s, body.lead_id);
      ownOr403(l, actor);
      const agentId = l.assigned_agent_id;
      if (agentId == null) throw new ApiError(422, 'Assign this lead to an agent first.', { code: 'unassigned' });
      const r = applyCommand(s, l, agentId, 'stage_change', body.to_stage, body.note?.trim() || null, body.visit_at ? iso(new Date(body.visit_at)) : null, now);
      if (!r.ok) throw new ApiError(422, REJECT_REASONS[r.reason] ?? 'The update was rejected.', { code: r.reason });
      const booked = body.to_stage === 'site_visit_booked';
      return {
        data: {
          lead_id: l.id, from_stage: r.from, to_stage: r.to, visit_at: r.visitAt, first_touch: r.firstTouch, calendar_event_created: booked,
          message: booked
            ? `Site visit booked for ${istTime(r.visitAt)}. Calendar event created and reminders scheduled for the agent and the buyer.`
            : `${l.name ?? 'Lead'} moved to "${STAGE_LABEL[r.to]}".${r.firstTouch ? ' First response logged.' : ''}`,
        },
      };
    }
    case 'reassign': {
      const l = leadOr404(s, body.lead_id);
      const to = s.agents.find((a) => a.id === body.agent_id);
      if (!to || !to.active) throw new ApiError(422, 'Pick an active agent.', { field: 'agent_id' });
      if (to.id === l.assigned_agent_id) throw new ApiError(422, `${to.name} already owns this lead.`, { field: 'agent_id' });
      if (openLoad(s, to.id) >= to.max_open_leads) throw new ApiError(422, `${to.name} is at capacity (${to.max_open_leads} open leads).`, { field: 'agent_id' });
      const from = l.assigned_agent_id;
      l.assigned_agent_id = to.id; l.assigned_at = iso(now); l.reassign_count += 1; l.is_stale = false; l.last_activity_at = iso(now);
      if (!l.first_response_at) l.first_response_agent_id = null;
      pushEvent(s, { lead_id: l.id, agent_id: to.id, event_type: 'assigned', note: `Reassigned by owner from ${agentName(s, from) ?? 'nobody'} to ${to.name}: ${body.reason}` }, now);
      pushEvent(s, { lead_id: l.id, agent_id: to.id, event_type: 'agent_alerted', note: 'New-lead alert sent to agent' }, now);
      const notified = [to.name, ...(from != null ? [agentName(s, from)!] : [])];
      return { data: { lead_id: l.id, from_agent_id: from, to_agent_id: to.id, to_agent_name: to.name, notified, message: `Reassigned to ${to.name}. ${notified.join(' and ')} ${notified.length > 1 ? 'were' : 'was'} notified on WhatsApp.` } };
    }
    case 'addNote': {
      const l = leadOr404(s, body.lead_id);
      ownOr403(l, actor);
      const agentId = actor.role === 'agent' ? actor.agentId : l.assigned_agent_id;
      const ev = pushEvent(s, { lead_id: l.id, agent_id: agentId, event_type: 'note', note: body.note.trim() }, now);
      l.last_activity_at = iso(now);
      return { data: { lead_id: l.id, event_id: ev.id, message: 'Note added.' } };
    }
    case 'saveAgent': {
      if (body.action === 'create') {
        const phone = normalizePhone(body.phone);
        if (!phone) throw new ApiError(422, 'Enter a valid 10-digit Indian mobile number.', { field: 'phone' });
        const clash = s.agents.find((a) => a.phone === phone);
        if (clash) throw new ApiError(422, `That number already belongs to ${clash.name}.`, { field: 'phone' });
        const a: RawAgent = { id: s.next.agent++, name: body.name, phone, email: body.email || null, active: true, round_robin_order: body.round_robin_order ?? 100, weight: body.weight ?? 1, max_open_leads: body.max_open_leads ?? 30, created_at: iso(now) };
        s.agents.push(a);
        return { data: { agent: toAgent(a, s), message: `${a.name} added. They'll start getting leads in the next round-robin.` } };
      }
      const a = s.agents.find((x) => x.id === body.id);
      if (!a) throw new ApiError(404, 'That agent no longer exists.');
      if (body.action === 'deactivate') {
        a.active = false;
        const n = openLoad(s, a.id);
        return { data: { agent: toAgent(a, s), message: `${a.name} deactivated and won't get new leads.${n ? ` ${n} open lead${n === 1 ? '' : 's'} are still assigned to them: reassign them from the lead feed.` : ''}` } };
      }
      if (body.action === 'activate') { a.active = true; return { data: { agent: toAgent(a, s), message: `${a.name} is active again.` } }; }
      if (body.phone) {
        const phone = normalizePhone(body.phone);
        if (!phone) throw new ApiError(422, 'Enter a valid 10-digit Indian mobile number.', { field: 'phone' });
        const clash = s.agents.find((x) => x.phone === phone && x.id !== a.id);
        if (clash) throw new ApiError(422, `That number already belongs to ${clash.name}.`, { field: 'phone' });
        a.phone = phone;
      }
      if (body.name) a.name = body.name;
      if (body.email !== undefined) a.email = body.email || null;
      if (body.round_robin_order != null) a.round_robin_order = body.round_robin_order;
      if (body.weight != null) a.weight = body.weight;
      if (body.max_open_leads != null) a.max_open_leads = body.max_open_leads;
      return { data: { agent: toAgent(a, s), message: `${a.name} updated.` } };
    }
    case 'saveListing': {
      let li: RawListing;
      if (body.id != null) {
        const found = s.listings.find((x) => x.id === body.id);
        if (!found) throw new ApiError(404, 'That listing no longer exists.');
        li = found;
        Object.assign(li, { title: body.title, project: body.project ?? null, location: body.location, property_type: body.property_type, bhk: body.bhk ?? null, price: body.price, status: body.status ?? li.status });
      } else {
        li = { id: s.next.listing++, title: body.title, project: body.project ?? null, location: body.location, property_type: body.property_type, bhk: body.bhk ?? null, price: body.price, status: body.status ?? 'open', is_test: !!body.is_test, created_at: iso(now) };
        s.listings.push(li);
      }
      const added = li.status === 'open' ? matchAndMessage(s, li, now) : 0;
      const total = s.matches.filter((m) => m.listing_id === li.id).length;
      return {
        data: {
          listing: toListing(li, s), new_matches: added,
          message: li.status !== 'open' ? 'Listing saved. Only open listings are matched to buyers.' : added ? `Listing saved. ${added} new buyer${added === 1 ? '' : 's'} matched and messaged on WhatsApp (${total} in total).` : total ? `Listing saved. No new buyers matched (${total} already matched).` : 'Listing saved. No buyers match yet. They will be matched as new leads arrive.',
        },
      };
    }
    case 'saveCost': {
      const month = `${String(body.month).slice(0, 7)}-01`;
      const ex = s.costs.find((c) => c.source === body.source && c.month === month);
      if (ex) ex.amount_inr = body.amount_inr;
      const row = ex ?? { id: s.next.cost++, source: body.source as Source, month, amount_inr: body.amount_inr, is_test: false };
      if (!ex) s.costs.push(row);
      return { data: { cost: row, replaced: !!ex, message: `${SOURCE_LABEL[row.source]} cost for ${M.monthOf(month).slice(0, 7)} ${ex ? 'updated' : 'saved'}.` } };
    }
    case 'runTest':
      return { data: runScenario(s, body.scenario, now) };
  }
}

/* ---------------------------------------------------------------- test harness: pushes data through the REAL chains above */
function runScenario(s: Store, scenario: string, now: Date): TestResponse {
  const created = { leads: 0, events: 0, listings: 0, matches: 0, costs: 0 };
  const lead_ids: number[] = [];
  const steps: string[] = [];
  const e0 = s.events.length;
  const tag = String(Date.now()).slice(-5);
  const mkPhone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const finish = (chain: string, message: string, extra: Partial<TestResponse> = {}): TestResponse => ({
    scenario: scenario as TestResponse['scenario'], chain, created: { ...created, events: s.events.length - e0 }, lead_ids, steps, message, ...extra,
  });
  const add = (input: IntakeInput) => {
    const r = intake(s, { ...input, is_test: true }, now);
    if (r.is_new) { created.leads++; lead_ids.push(r.lead_id); } else if (!lead_ids.includes(r.lead_id)) lead_ids.push(r.lead_id);
    return r;
  };

  switch (scenario) {
    case 'portal_email_lead': {
      steps.push('Gmail trigger (99acres sender filter) received a sample enquiry email', 'Prepare Portal Email → Extract Lead From Email (AI) → Map Portal Lead', 'Parse Budget → Normalise Fields → Upsert Lead');
      const r = add({ name: `TEST Portal Buyer ${tag}`, phone: mkPhone(), email: `test.portal.${tag}@example.com`, source: '99acres', source_detail: 'Project enquiry: Skyline Heights', budget_min: 6000000, budget_max: 8000000, location_pref: 'Gomti Nagar', property_type: 'apartment', bhk: 3, timeline: 'within_1_month' });
      steps.push(`Score → Assign Agent → WhatsApp: ${r.message}`);
      return finish('Intake: 99acres Lead Email → shared intake chain', r.message);
    }
    case 'meta_lead': {
      steps.push('Facebook Lead Ads trigger received a sample lead form', 'Map Meta Lead → Parse Budget → Normalise Fields → Upsert Lead');
      const r = add({ name: `TEST Meta Buyer ${tag}`, phone: mkPhone(), source: 'meta', campaign: 'TEST – Weekend Open House', budget_max: 9000000, location_pref: 'Sushant Golf City', property_type: 'villa', bhk: 3, timeline: '1_3_months' });
      steps.push(`Score → Assign Agent → WhatsApp: ${r.message}`);
      return finish('Intake: Meta Lead Ads → shared intake chain', r.message);
    }
    case 'referral_form': {
      steps.push('Referral and Walk-in form submitted', 'Map Form Lead → Parse Budget → Normalise Fields → Upsert Lead');
      const r = add({ name: `TEST Referral Buyer ${tag}`, phone: mkPhone(), source: 'referral', source_detail: 'Referred by an existing client', budget_min: 12000000, budget_max: 15000000, location_pref: 'Shaheed Path', property_type: 'apartment', bhk: 4, timeline: 'immediate' });
      steps.push(`Score → Assign Agent → WhatsApp: ${r.message}`);
      return finish('Intake: Referral and Walk-in Form → shared intake chain', r.message);
    }
    case 'duplicate_lead': {
      const phone = mkPhone();
      steps.push('Webhook delivery #1 (website)');
      const a = add({ name: `TEST Duplicate ${tag}`, phone, source: 'website', budget_max: 5500000, location_pref: 'Indira Nagar', property_type: 'apartment', bhk: 2, timeline: 'within_1_month' });
      steps.push(`  → ${a.message}`, 'Webhook delivery #2: same phone, different source (magicbricks)');
      const b = add({ name: `TEST Duplicate ${tag}`, phone, source: 'magicbricks' });
      steps.push(`  → ${b.message}`);
      return finish('Intake: Website and CRM Webhook → Upsert Lead (dedupe on phone)', b.is_new ? 'Unexpected: a second lead was created.' : 'Duplicate detected: logged as a repeat enquiry, no second lead created.');
    }
    case 'stale_lead_escalation': {
      const old = new Date(now.getTime() - 250 * MIN);
      const r = add({ name: `TEST Stale Buyer ${tag}`, phone: mkPhone(), source: 'meta', budget_max: 7000000, location_pref: 'Gomti Nagar Extension', property_type: 'apartment', bhk: 3, timeline: 'immediate', at: old });
      const l = s.leads.find((x) => x.id === r.lead_id)!;
      steps.push(`Created a test lead ${250} minutes old with no first response (assigned to ${r.assigned_agent_name})`);
      const prev = l.assigned_agent_id!;
      pushEvent(s, { lead_id: l.id, agent_id: prev, event_type: 'sla_breached', note: 'No first response after 120 minutes' }, new Date(old.getTime() + 120 * MIN));
      steps.push('Watchdog tick: tier = nudge → agent nudged, lead flagged stale');
      pushEvent(s, { lead_id: l.id, agent_id: prev, event_type: 'owner_escalated', note: 'Owner alerted on WhatsApp' }, new Date(old.getTime() + 180 * MIN));
      steps.push('Watchdog tick: tier = escalate → owner alerted');
      l.is_stale = true;
      const to = assignLead(s, l, now, 'stale');
      steps.push(`Watchdog tick: tier = reassign → ${to ? `moved to ${to.name}` : 'no agent available'}`);
      return finish('Watchdog: Every 15 Minutes → Find Overdue → Route By Tier', to ? `Escalation ladder ran: agent nudged → owner alerted → reassigned to ${to.name}.` : 'Escalation ran but no agent had capacity.');
    }
    case 'visit_booking': {
      const r = add({ name: `TEST Visit Buyer ${tag}`, phone: mkPhone(), source: 'website', budget_max: 6500000, location_pref: 'Gomti Nagar', property_type: 'apartment', bhk: 3, timeline: 'within_1_month' });
      const l = s.leads.find((x) => x.id === r.lead_id)!;
      const a = l.assigned_agent_id!;
      const t1 = applyCommand(s, l, a, 'called', null, 'Test call', null, now);
      steps.push(`CALLED → ${t1.ok ? 'first response logged' : t1.reason}`);
      const t2 = applyCommand(s, l, a, 'stage_change', 'qualified', null, null, now);
      steps.push(`QUALIFY → ${t2.ok ? 'qualified' : t2.reason}`);
      const when = new Date(now.getTime() + 26 * 3600000);
      const t3 = applyCommand(s, l, a, 'stage_change', 'site_visit_booked', 'Test visit', iso(when), now);
      steps.push(`VISIT ${istTime(iso(when))} → ${t3.ok ? 'booked' : t3.reason}`, 'Get Visit Details → Create Calendar Event → Save Calendar Event Id', 'Visit Messages → confirmation WhatsApp to buyer; reminder scheduled (Wait node)');
      return finish('Agent Actions: Valid Format? → Apply Command → calendar + reminder', `Visit booked for ${istTime(iso(when))} on lead #${l.id}; calendar event and reminders created.`);
    }
    case 'listing_match': {
      const phone = () => mkPhone();
      for (let i = 0; i < 3; i++) add({ name: `TEST Matcher Buyer ${tag}-${i + 1}`, phone: phone(), source: 'website', budget_min: 6500000, budget_max: 7800000, location_pref: 'Gomti Nagar', property_type: 'apartment', bhk: 3, timeline: 'within_1_month' });
      steps.push('Created 3 test buyers who want a 3 BHK in Gomti Nagar around ₹65–78L');
      const li: RawListing = { id: s.next.listing++, title: `TEST 3 BHK flat, Test Towers ${tag}`, project: 'Test Towers', location: 'Gomti Nagar', property_type: 'apartment', bhk: 3, price: 7000000, status: 'open', is_test: true, created_at: iso(now) };
      s.listings.push(li);
      created.listings++;
      const n = matchAndMessage(s, li, now);
      created.matches = n;
      steps.push('Listing Changed Webhook → Get Pending Listings → Match Buyers To Listing (±15% budget, location, BHK, type)', `Matched ${n} test buyer${n === 1 ? '' : 's'}; real buyers are never matched to test listings`);
      return finish('Inventory Matcher: Listing Changed Webhook → Match Buyers', `Test listing matched ${n} buyers.`);
    }
    case 'cost_entry': {
      const month = M.monthOf(M.istDate(now));
      const ex = s.costs.find((c) => c.source === 'other' && c.month === month);
      if (ex) ex.amount_inr = 1000 + Math.round(Math.random() * 500);
      else { s.costs.push({ id: s.next.cost++, source: 'other', month, amount_inr: 1000, is_test: true }); created.costs++; }
      steps.push('Cost Entry Form submitted: source = other, amount = ₹1,000', 'Normalise Entry → Valid Entry? → Upsert Source Cost → Confirm To Owner');
      return finish('Cost Entry: form → Upsert Source Cost', 'Test cost saved for the current month (source "other").');
    }
    case 'cleanup': {
      const testLeads = new Set(s.leads.filter((l) => l.is_test).map((l) => l.id));
      const testListings = new Set(s.listings.filter((l) => l.is_test).map((l) => l.id));
      const before = testLeads.size + testListings.size + s.costs.filter((c) => c.is_test).length + s.errors.filter((e) => e.is_test).length;
      s.events = s.events.filter((e) => !testLeads.has(e.lead_id));
      s.matches = s.matches.filter((m) => !testLeads.has(m.lead_id) && !testListings.has(m.listing_id));
      s.leads = s.leads.filter((l) => !l.is_test);
      s.listings = s.listings.filter((l) => !l.is_test);
      s.costs = s.costs.filter((c) => !c.is_test);
      s.errors = s.errors.filter((e) => !e.is_test);
      steps.push(`Removed ${testLeads.size} test leads (and their events and matches), ${testListings.size} test listings, test costs and test errors`);
      return finish('Test Harness: cleanup', before ? `Removed ${before} test record${before === 1 ? '' : 's'}.` : 'Nothing to clean up.', { removed: before });
    }
  }
  throw new ApiError(400, `Unknown scenario "${scenario}".`);
}

export { resetStore, SOURCES };
