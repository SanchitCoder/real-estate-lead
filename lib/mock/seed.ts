/**
 * Deterministic sample data for "Skyline Realty, Lucknow".
 * Same seed => same people, budgets, outcomes. Timestamps are relative to `anchor` (server start)
 * so "currently stale" leads are always a few hours old.
 */
import type { EventType, Score, Source, Stage } from '@contracts/realestate-api';
import {
  DEFAULT_CFG, addDays, addMonths, deriveIsStale, indexEvents, istDate, istHour, matchListing, monthOf, startOf,
  type Cfg, type Dataset, type RawAgent, type RawCost, type RawError, type RawEvent, type RawLead, type RawListing, type RawMatch,
} from '../metrics';

/* ---------------------------------------------------------------- rng */
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  r: () => number;
  constructor(seed: number) { this.r = mulberry32(seed); }
  f() { return this.r(); }
  int(a: number, b: number) { return a + Math.floor(this.r() * (b - a + 1)); }
  range(a: number, b: number) { return a + this.r() * (b - a); }
  chance(p: number) { return this.r() < p; }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.r() * xs.length)]; }
  weighted<T>(xs: readonly (readonly [T, number])[]): T {
    const total = xs.reduce((a, [, w]) => a + w, 0);
    let x = this.r() * total;
    for (const [v, w] of xs) { x -= w; if (x <= 0) return v; }
    return xs[xs.length - 1][0];
  }
  normal() { return Math.sqrt(-2 * Math.log(1 - this.r())) * Math.cos(2 * Math.PI * this.r()); }
  poisson(l: number) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= this.r(); } while (p > L); return k - 1; }
}

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

/* ---------------------------------------------------------------- reference data */
export const LOCALITIES = ['Gomti Nagar', 'Gomti Nagar Extension', 'Sushant Golf City', 'Shaheed Path', 'Indira Nagar', 'Jankipuram', 'Sultanpur Road', 'Faizabad Road'] as const;
const LOC_W: [string, number][] = [['Gomti Nagar', 22], ['Gomti Nagar Extension', 16], ['Sushant Golf City', 14], ['Shaheed Path', 12], ['Indira Nagar', 9], ['Jankipuram', 9], ['Sultanpur Road', 9], ['Faizabad Road', 9]];
const FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Rohit', 'Rahul', 'Amit', 'Sanjay', 'Vikram', 'Manish', 'Deepak', 'Ankit', 'Saurabh', 'Pankaj', 'Nitin', 'Ashish', 'Gaurav', 'Mohit', 'Harsh', 'Shubham', 'Anurag', 'Rajeev', 'Suresh', 'Alok', 'Faisal', 'Zubair', 'Tariq', 'Kunal', 'Varun', 'Yash'];
const FIRST_F = ['Anjali', 'Priyanka', 'Pooja', 'Neha', 'Shweta', 'Ritu', 'Sunita', 'Meera', 'Kavya', 'Ishita', 'Divya', 'Swati', 'Nidhi', 'Richa', 'Komal', 'Aarti', 'Sana', 'Farah', 'Tanvi', 'Shruti'];
const LAST = ['Srivastava', 'Mishra', 'Verma', 'Tiwari', 'Dubey', 'Yadav', 'Gupta', 'Agarwal', 'Singh', 'Pandey', 'Shukla', 'Tripathi', 'Rastogi', 'Saxena', 'Khan', 'Siddiqui', 'Ansari', 'Chaturvedi', 'Awasthi', 'Bajpai', 'Kapoor', 'Mehrotra', 'Jaiswal', 'Maurya', 'Kushwaha', 'Pal', 'Chauhan', 'Bhatnagar'];
const PROJECTS = ['Skyline Heights', 'Gomti Greens', 'Sushant Orchid', 'Shaheed Path Residency', 'Indira Enclave', 'Jankipuram Vista', 'Faizabad Road Estates', 'Sultanpur Meadows', 'Skyline Crest', 'Nawab Court'];
const LOST_REASONS = [['Budget did not match', 24], ['Bought elsewhere', 22], ['Not responding after follow-ups', 26], ['Location not suitable', 10], ['Postponed the purchase', 11], ['Home loan not approved', 7]] as const;
const JUNK_NOTES = ['Fake enquiry, number not reachable', 'Broker enquiry, not a buyer', 'Wrong number', 'Only wanted rental options', 'Student, no budget'];
const CAMPAIGNS = ['Gomti Nagar 3BHK – Weekend Open House', 'Sushant Golf City Villas', 'Plots Under 60L', 'Ready-to-move 2BHK – Diwali Offer'];

interface Agentdef { name: string; resp: number; sigma: number; mult: number; win: number; active: boolean; max: number; email: string }
const AGENTS: Agentdef[] = [
  { name: 'Rohan Mishra', resp: 9, sigma: 0.7, mult: 1.6, win: 3.0, active: true, max: 60, email: 'rohan@skylinerealty.in' },
  { name: 'Priya Srivastava', resp: 14, sigma: 0.8, mult: 1.1, win: 1.1, active: true, max: 60, email: 'priya@skylinerealty.in' },
  { name: 'Aman Verma', resp: 3.5, sigma: 0.6, mult: 0.5, win: 0.5, active: true, max: 60, email: 'aman@skylinerealty.in' },
  { name: 'Neha Tiwari', resp: 75, sigma: 0.8, mult: 0.9, win: 0.9, active: true, max: 60, email: 'neha@skylinerealty.in' },
  { name: 'Imran Qureshi', resp: 20, sigma: 0.75, mult: 0.95, win: 0.9, active: true, max: 60, email: 'imran@skylinerealty.in' },
  { name: 'Kavita Dubey', resp: 15, sigma: 0.8, mult: 1.0, win: 1.0, active: true, max: 60, email: 'kavita@skylinerealty.in' },
  { name: 'Sandeep Yadav', resp: 28, sigma: 0.9, mult: 0.9, win: 0.9, active: false, max: 60, email: 'sandeep@skylinerealty.in' },
];

/** per source: monthly volume, junk rate, P(reach >= qualified, booked, visited, negotiation, won) among non-junk */
const SRC: Record<string, { vol: number; junk: number; reach: [number, number, number, number, number]; phone: number; budget: number }> = {
  '99acres': { vol: 105, junk: 0.07, reach: [0.72, 0.26, 0.19, 0.072, 0.03], phone: 1, budget: 0.9 },
  magicbricks: { vol: 140, junk: 0.12, reach: [0.56, 0.085, 0.042, 0.016, 0.007], phone: 1, budget: 0.9 },
  meta: { vol: 135, junk: 0.22, reach: [0.56, 0.25, 0.18, 0.07, 0.027], phone: 0.92, budget: 0.7 },
  website: { vol: 38, junk: 0.06, reach: [0.66, 0.22, 0.15, 0.065, 0.027], phone: 0.9, budget: 0.6 },
  referral: { vol: 42, junk: 0.02, reach: [0.9, 0.42, 0.34, 0.16, 0.085], phone: 1, budget: 0.85 },
};

const L = (n: number) => n * 100000;
const rnd5L = (n: number) => Math.round(n / L(1)) * L(1);

/* ---------------------------------------------------------------- generator */
export interface Seed extends Dataset {
  cfg: Cfg;
  configRows: { key: string; value: unknown; description: string }[];
  anchor: string;
}

interface Draft {
  lead: RawLead;
  evs: Omit<RawEvent, 'id'>[];
}

export const SEED_NUMBER = 7;
export function buildSeed(anchorIn: Date = new Date(), seedNumber: number = SEED_NUMBER): Seed {
  const rng = new Rng(seedNumber);
  const anchor = new Date(Math.floor(anchorIn.getTime() / (15 * MIN)) * 15 * MIN);
  const nowMs = anchor.getTime();
  const cfg = { ...DEFAULT_CFG };
  const today = istDate(anchor);
  const firstMonth = addMonths(monthOf(today), -3);
  const startDay = firstMonth;

  /* agents */
  const agents: RawAgent[] = AGENTS.map((a, i) => ({
    id: i + 1, name: a.name, phone: `+91981110000${i + 1}`, email: a.email, active: a.active, round_robin_order: i + 1,
    weight: 1, max_open_leads: a.max, created_at: new Date(nowMs - 400 * DAY).toISOString(),
  }));
  const deactivatedAt = nowMs - 24 * DAY;

  /* ---- lead skeletons */
  const usedPhones = new Set<string>();
  const phone = () => { for (;;) { const p = `+91${rng.pick(['9', '9', '9', '8', '8', '7', '6'])}${String(rng.int(0, 999999999)).padStart(9, '0')}`; if (!usedPhones.has(p)) { usedPhones.add(p); return p; } } };
  const hourW = [1, 0.5, 0.3, 0.2, 0.3, 0.8, 2, 3, 5, 7, 9, 10, 9, 7, 6, 6, 7, 8, 9, 9, 7, 5, 3, 2];

  interface Skel { createdMs: number; source: Source }
  const skels: Skel[] = [];
  for (let day = startDay; day <= today; day = addDays(day, 1)) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const wk = dow === 0 ? 1.25 : dow === 6 ? 1.2 : 0.95;
    for (const source of Object.keys(SRC)) {
      const n = rng.poisson((SRC[source].vol / 30.4) * wk);
      for (let k = 0; k < n; k++) {
        const hour = rng.weighted(hourW.map((w, h) => [h, w] as const));
        const ms = startOf(day).getTime() + hour * HOUR + rng.int(0, 3599) * 1000;
        if (ms < nowMs - 2 * MIN) skels.push({ createdMs: ms, source: source as Source });
      }
    }
  }
  skels.sort((a, b) => a.createdMs - b.createdMs);

  /* ---- assignment state */
  const assignedCount = agents.map(() => 0);
  const pickAgent = (atMs: number, exclude: number[] = []): number => {
    const elig = agents.filter((a) => !exclude.includes(a.id) && (a.active || atMs < deactivatedAt));
    elig.sort((a, b) => assignedCount[a.id - 1] / a.weight - assignedCount[b.id - 1] / b.weight || a.round_robin_order - b.round_robin_order);
    const a = elig[0];
    assignedCount[a.id - 1]++;
    return a.id;
  };

  const drafts: Draft[] = [];
  let nextLeadId = 1;
  // low-discrepancy draws per source keep monthly counts close to expectation (a story, not noise)
  const srcN: Record<string, number> = {};
  const qr = (n: number, a: number) => (0.5 + n * a) % 1;

  const makeProfile = (source: Source) => {
    const female = rng.chance(0.42);
    const first = rng.pick(female ? FIRST_F : FIRST_M);
    const last = rng.pick(LAST);
    const ptype = rng.weighted([['apartment', 62], ['villa', 18], ['plot', 17], ['commercial', 3]] as const);
    const bhk = ptype === 'apartment' ? rng.weighted([[2, 38], [3, 45], [4, 17]] as const) : ptype === 'villa' ? rng.weighted([[3, 50], [4, 50]] as const) : null;
    let base: number;
    if (ptype === 'apartment') base = bhk === 2 ? rng.range(L(38), L(68)) : bhk === 3 ? rng.range(L(70), L(125)) : rng.range(L(125), L(195));
    else if (ptype === 'villa') base = rng.range(L(150), L(250));
    else if (ptype === 'plot') base = rng.range(L(35), L(150));
    else base = rng.range(L(60), L(200));
    const stated = rng.chance(SRC[source].budget);
    const loc1 = rng.weighted(LOC_W);
    const locs = rng.chance(0.12) ? '' : rng.chance(0.2) ? `${loc1}, ${rng.weighted(LOC_W)}` : loc1;
    return { first, last, ptype, bhk, base, stated, locs };
  };

  const buildLead = (sk: Skel, forced?: { agentId: number }): Draft => {
    const id = nextLeadId++;
    const prof = makeProfile(sk.source);
    const cfgS = SRC[sk.source];
    const created = sk.createdMs;
    const ageMs = nowMs - created;

    const hasPhone = rng.chance(cfgS.phone);
    const qn = (srcN[sk.source] = (srcN[sk.source] ?? 0) + 1);
    const isJunk = qr(qn, 0.41421356) < cfgS.junk;
    const junkAtIntake = isJunk && rng.chance(0.3);
    const phoneVal = junkAtIntake ? null : hasPhone || isJunk ? phone() : null;
    const emailVal = junkAtIntake ? null : rng.chance(phoneVal ? 0.55 : 1) ? `${prof.first}.${prof.last}${rng.int(1, 99)}@${rng.pick(['gmail.com', 'gmail.com', 'yahoo.in', 'outlook.com'])}`.toLowerCase() : null;
    const agentId = junkAtIntake ? null : (forced?.agentId ?? pickAgent(created));
    const agent = agentId != null ? AGENTS[agentId - 1] : null;

    /* progression */
    const mult = agent?.mult ?? 1;
    const r = cfgS.reach;
    const pq = r[0], pb = Math.min(0.95, r[1] * mult), pv = Math.min(0.95, r[2] * mult), pn = Math.min(0.95, r[3] * mult * (agent ? Math.sqrt(agent.win) : 1)), pw = Math.min(0.9, r[4] * mult * (agent?.win ?? 1));
    const u = qr(qn, 0.61803399);
    let target = isJunk ? 0 : u < pw ? 6 : u < pn ? 5 : u < pv ? 4 : u < pb ? 3 : u < pq ? 2 : 1;

    /* first response */
    let R: number | null = null;
    if (agent && !junkAtIntake) {
      const wdSlow = new Date(created).getUTCDay() === 0 ? 1.3 : 1;
      R = Math.max(1.2, agent.resp * wdSlow * Math.exp(agent.sigma * rng.normal()));
      const hr = istHour(new Date(created));
      if ((hr >= 22 || hr < 7) && rng.chance(0.15)) {
        const toMorning = ((8.5 - ((hr + 24) % 24 + (hr >= 22 ? -24 : 0))) * 60) + rng.int(0, 40);
        R = Math.max(R, Math.min(toMorning, 600));
      }
      R = Math.min(R, 900);
      // very recent regular leads are answered quickly (the designated stale ones are added separately)
      if (ageMs < 6 * HOUR) R = Math.min(R, Math.max(1, (ageMs / MIN) * 0.5));
      if (ageMs / MIN < 6) R = ageMs / MIN + 1; // still inside the first minutes: unanswered
    }

    const evs: Omit<RawEvent, 'id'>[] = [];
    const ev = (t: number, event_type: EventType, o: Partial<Omit<RawEvent, 'id' | 'lead_id' | 'created_at' | 'event_type'>> = {}) =>
      evs.push({ lead_id: id, agent_id: null, from_stage: null, to_stage: null, note: null, ...o, event_type, created_at: new Date(t).toISOString() });

    const t0 = created;
    ev(t0, 'created', { to_stage: junkAtIntake ? 'junk' : 'new', note: `Captured from ${sk.source}` });
    if (junkAtIntake) {
      ev(t0 + 5000, 'unassigned', { note: 'No phone or email, held as junk' });
    }
    let stage: Stage = junkAtIntake ? 'junk' : 'new';
    let assigned = agentId;
    let assignedAt = t0 + 35000;
    let reassign = 0;
    let firstTouchMs: number | null = null;
    let firstTouchAgent: number | null = null;
    let lastHuman = t0;

    if (agent && agentId != null) {
      ev(t0 + 35000, 'assigned', { agent_id: agentId, note: `Assigned to ${agent.name}` });
      if (phoneVal) ev(t0 + 40000, 'auto_response_sent', { note: 'Welcome WhatsApp sent' });
      ev(t0 + 45000, 'agent_alerted', { agent_id: agentId, note: 'New-lead alert sent to agent' });

      if (R != null) {
        const touchAt = t0 + R * MIN;
        const sla = cfg.sla_first_response_min * MIN;
        // escalation ladder events while the lead waited
        if (touchAt - t0 > sla && t0 + sla < nowMs) ev(t0 + sla, 'sla_breached', { agent_id: agentId, note: `No first response after ${cfg.sla_first_response_min} minutes` });
        if (touchAt - t0 > cfg.escalate_owner_min * MIN && t0 + cfg.escalate_owner_min * MIN < nowMs) ev(t0 + cfg.escalate_owner_min * MIN, 'owner_escalated', { agent_id: agentId, note: 'Owner alerted on WhatsApp' });
        if (touchAt - t0 > cfg.reassign_min * MIN && t0 + cfg.reassign_min * MIN < nowMs) {
          const to = pickAgent(t0 + cfg.reassign_min * MIN, [agentId]);
          ev(t0 + cfg.reassign_min * MIN, 'reassigned_stale', { agent_id: to, note: `Reassigned from ${agent.name} to ${AGENTS[to - 1].name}` });
          assigned = to; assignedAt = t0 + cfg.reassign_min * MIN; reassign = 1;
        }
        if (touchAt < nowMs) {
          firstTouchMs = touchAt;
          firstTouchAgent = assigned;
          ev(touchAt, 'called', { agent_id: assigned, note: rng.chance(0.4) ? rng.pick(['Spoke to buyer, shared brochure', 'Buyer asked for a call back in the evening', 'Discussed budget and location', 'Left voicemail, will retry']) : null });
          lastHuman = touchAt;
        }
      }
    }

    /* stage progression with maturity clipping */
    let cursor = firstTouchMs ?? t0;
    let visitAt: number | null = null;
    const move = (to: Stage, atMs: number, note: string | null = null) => {
      if (atMs >= nowMs) return false;
      ev(atMs, 'stage_change', { agent_id: assigned, from_stage: stage, to_stage: to, note });
      stage = to; cursor = atMs; lastHuman = atMs;
      return true;
    };
    if (firstTouchMs != null && !isJunk && assigned != null) {
      if (target >= 2 && !(target >= 3 && rng.chance(0.08))) { if (!move('qualified', cursor + rng.range(0.5, 20) * HOUR)) target = 1; }
      if (target >= 3) {
        const bookAt = cursor + rng.range(0.1, 2.8) * DAY;
        const vAt = bookAt + rng.range(1, 7) * DAY;
        if (target >= 3 && move('site_visit_booked', bookAt, `Visit booked for ${istDate(new Date(vAt))}`)) {
          visitAt = vAt;
          // in the last day: some bookings are for the future
        } else target = Math.min(target, 2);
      }
      if (target >= 4 && visitAt != null) { if (!move('visited', visitAt + rng.range(0.5, 6) * HOUR, 'Buyer visited the site')) target = 3; }
      if (target >= 5) { if (!move('negotiation', cursor + rng.range(1, 6) * DAY, null)) target = 4; }
      if (target >= 6) { if (!move('closed_won', cursor + rng.range(3, 25) * DAY, 'Deal closed')) target = 5; }
      // follow-ups sprinkled between first touch and last move
      const span = Math.max(0, lastHuman - (firstTouchMs ?? lastHuman));
      if (span > 6 * HOUR) {
        const nF = rng.int(0, Math.min(4, 1 + Math.floor(span / DAY / 3)));
        for (let k = 0; k < nF; k++) ev(firstTouchMs + rng.range(0.1, 1) * span, 'followup_done', { agent_id: assigned, note: rng.pick([null, 'Sent site photos on WhatsApp', 'Called, buyer is comparing two projects', 'Asked for documents', 'Shared payment plan']) });
      }
      if (rng.chance(0.25)) ev(firstTouchMs + rng.range(0.05, 0.9) * Math.max(span, HOUR), 'lead_reply', { note: rng.pick(['Please call after 6 pm', 'Can you share the brochure?', 'Interested, what is the best price?', 'Send location on WhatsApp']) });
      if (rng.chance(0.3)) ev(firstTouchMs + rng.range(0.05, 1) * Math.max(span, HOUR), 'note', { agent_id: assigned, note: rng.pick(['Buyer wants ready possession', 'Prefers higher floor', 'Needs home loan, salaried', 'Decision maker is spouse', 'Wants vastu-compliant unit']) });
    }

    /* junk after contact */
    if (isJunk && !junkAtIntake && firstTouchMs != null && assigned != null) {
      move('junk', firstTouchMs + rng.range(0.2, 6) * HOUR, rng.pick(JUNK_NOTES));
    }

    /* closed lost for stalled leads */
    const lastActivityAge = nowMs - lastHuman;
    let lostReason: string | null = null;
    if (isOpen2(stage) && assigned != null && firstTouchMs != null) {
      const stalled = lastActivityAge > (stage === 'new' ? 4 : stage === 'qualified' ? 6 : stage === 'site_visit_booked' ? 3 : 8) * DAY;
      if (stalled && rng.chance(stage === 'new' || stage === 'qualified' ? 0.93 : 0.85)) {
        lostReason = rng.weighted(LOST_REASONS.map(([k, w]) => [k as string, w] as const));
        move('closed_lost', lastHuman + rng.range(1, 6) * DAY > nowMs ? lastHuman + (nowMs - lastHuman) * 0.5 : lastHuman + rng.range(1, 6) * DAY, lostReason);
      }
    }
    if (isOpen2(stage) && assigned != null && firstTouchMs == null && ageMs > 3 * DAY) {
      // never reached: written off
      lostReason = 'Not responding after follow-ups';
      stage = 'closed_lost';
    }

    /* repeat enquiries */
    let repeat = 0;
    if (phoneVal && rng.chance(0.06) && ageMs > 2 * DAY) {
      repeat = rng.int(1, 2);
      for (let k = 0; k < repeat; k++) ev(t0 + rng.range(0.3, Math.min(ageMs / DAY, 20)) * DAY, 'repeat_enquiry', { agent_id: assigned, note: `Repeat enquiry via ${rng.pick(['99acres', 'magicbricks', 'website', 'meta'])}` });
    }

    /* score */
    const prog = Math.max(target, stage === 'junk' ? 0 : 1);
    const hot = prog >= 4 ? 0.45 : prog === 3 ? 0.3 : prog === 2 ? 0.15 : 0.07;
    const warm = prog >= 4 ? 0.45 : prog === 3 ? 0.52 : prog === 2 ? 0.57 : 0.45;
    const sc = isJunk ? 'cold' : (() => { const x = rng.f(); return x < hot ? 'hot' : x < hot + warm ? 'warm' : 'cold'; })() as Score;
    const timeline = sc === 'hot' ? rng.weighted([['immediate', 40], ['within_1_month', 60]] as const) : sc === 'warm' ? rng.weighted([['1_3_months', 55], ['3_6_months', 30], ['within_1_month', 15]] as const) : rng.weighted([['6_plus_months', 35], ['just_exploring', 35], ['unknown', 30]] as const);
    const points = isJunk ? rng.int(4, 18) : sc === 'hot' ? rng.int(71, 96) : sc === 'warm' ? rng.int(42, 68) : rng.int(12, 38);
    const budgetMin = prof.stated ? rnd5L(prof.base * 0.85) : null;
    const budgetMax = prof.stated ? rnd5L(prof.base * 1.1) : null;
    const reason = scoreReason({ sc, isJunk, prof, source: sk.source, timeline, repeat, hasPhone: !!phoneVal });

    const lastEv = evs.filter((e) => ['created', 'assigned', 'reassigned_stale', 'repeat_enquiry', 'called', 'followup_done', 'stage_change', 'note', 'lead_reply'].includes(e.event_type)).map((e) => Date.parse(e.created_at));
    const lastActivity = Math.max(...lastEv);
    const lead: RawLead = {
      id, name: junkAtIntake && rng.chance(0.5) ? null : `${prof.first} ${prof.last}`, phone: phoneVal, email: emailVal, source: sk.source,
      source_detail: sourceDetail(sk.source, rng), campaign: sk.source === 'meta' ? rng.pick(CAMPAIGNS) : null,
      budget_min: budgetMin, budget_max: budgetMax, location_pref: prof.locs || null, property_type: prof.ptype, bhk: prof.bhk,
      timeline, score: sc, score_points: points, score_reason: reason,
      priority: repeat, repeat_count: repeat, assigned_agent_id: assigned, assigned_at: assigned != null ? new Date(assignedAt).toISOString() : null,
      reassign_count: reassign, stage, visit_at: visitAt != null && ['site_visit_booked', 'visited', 'negotiation', 'closed_won'].includes(stage as Stage) ? new Date(visitAt).toISOString() : null,
      lost_reason: stage === 'closed_lost' ? lostReason : null,
      created_at: new Date(created).toISOString(),
      first_response_at: firstTouchMs != null ? new Date(firstTouchMs).toISOString() : null,
      first_response_agent_id: firstTouchAgent,
      last_activity_at: new Date(lastActivity).toISOString(),
      is_stale: false, is_test: false,
    };
    if (stage === 'closed_lost') {
      ev(Date.parse(lead.last_activity_at), 'note', { agent_id: assigned, note: `Lost: ${lostReason}` });
    }
    return { lead, evs };
  };

  for (const sk of skels) drafts.push(buildLead(sk));

  /* ---- designated live-stale leads */
  const activeIds = [1, 2, 3, 4, 5, 6];
  const designate = (ageMin: number, agentId: number, level: 'nudge' | 'escalate' | 'reassigned') => {
    const created = nowMs - ageMin * MIN;
    const d = buildLead({ createdMs: created, source: rng.pick(['99acres', 'magicbricks', 'meta', 'meta', 'website']) as Source }, { agentId });
    // wipe any generated touches: this lead is still waiting
    d.evs = d.evs.filter((e) => ['created', 'assigned', 'auto_response_sent', 'agent_alerted'].includes(e.event_type));
    d.evs.forEach((e) => { if (e.event_type === 'created') e.to_stage = 'new'; });
    d.lead.stage = 'new'; d.lead.first_response_at = null; d.lead.first_response_agent_id = null; d.lead.visit_at = null; d.lead.lost_reason = null;
    d.lead.name = d.lead.name ?? 'Rakesh Kumar';
    if (!d.lead.phone) { d.lead.phone = phone(); }
    d.lead.assigned_agent_id = agentId; d.lead.reassign_count = 0; d.lead.assigned_at = new Date(created + 35000).toISOString();
    d.lead.last_activity_at = new Date(created + 35000).toISOString();
    if (!d.evs.some((e) => e.event_type === 'assigned')) d.evs.push({ lead_id: d.lead.id, agent_id: agentId, event_type: 'assigned', from_stage: null, to_stage: null, note: `Assigned to ${AGENTS[agentId - 1].name}`, created_at: new Date(created + 35000).toISOString() });
    const push = (t: number, event_type: EventType, agent_id: number | null, note: string) => d.evs.push({ lead_id: d.lead.id, agent_id, event_type, from_stage: null, to_stage: null, note, created_at: new Date(t).toISOString() });
    if (level !== 'nudge' || ageMin >= cfg.sla_first_response_min) push(created + cfg.sla_first_response_min * MIN, 'sla_breached', agentId, `No first response after ${cfg.sla_first_response_min} minutes`);
    if (level === 'escalate' || level === 'reassigned') push(created + cfg.escalate_owner_min * MIN, 'owner_escalated', agentId, 'Owner alerted on WhatsApp');
    if (level === 'reassigned') {
      const to = pickAgent(created + cfg.reassign_min * MIN, [agentId]);
      const at = created + cfg.reassign_min * MIN;
      push(at, 'reassigned_stale', to, `Reassigned from ${AGENTS[agentId - 1].name} to ${AGENTS[to - 1].name}`);
      d.lead.assigned_agent_id = to; d.lead.assigned_at = new Date(at).toISOString(); d.lead.reassign_count = 1;
      d.lead.last_activity_at = new Date(at).toISOString();
    }
    d.lead.is_stale = true;
    d.lead.score = d.lead.score === 'cold' ? 'warm' : d.lead.score; d.lead.score_points = Math.max(d.lead.score_points ?? 0, 45);
    d.lead.score_reason = d.lead.score === 'hot' ? d.lead.score_reason : 'Budget stated and timeline within 3 months; waiting for first call.';
    drafts.push(d);
  };
  // levels by minutes waiting: nudged 125-170, owner 185-235, reassigned: created 5-9h ago but reassigned ~2-3h ago
  [128, 135, 142, 150, 158, 168].forEach((m, i) => designate(m, [4, 4, 4, 5, 2, 6][i], 'nudge'));
  [188, 205, 220, 232].forEach((m, i) => designate(m, [4, 1, 5, 6][i], 'escalate'));
  [400, 470, 540].forEach((m, i) => designate(m, [4, 4, 5][i], 'reassigned'));
  // a few fresh leads still inside the SLA
  [4, 22, 47, 71, 96].forEach((m, i) => {
    const d = buildLead({ createdMs: nowMs - m * MIN, source: rng.pick(['99acres', 'meta', 'magicbricks', 'website', 'referral']) as Source }, { agentId: activeIds[i % 6] });
    d.evs = d.evs.filter((e) => ['created', 'assigned', 'auto_response_sent', 'agent_alerted'].includes(e.event_type));
    d.evs.forEach((e) => { if (e.event_type === 'created') e.to_stage = 'new'; });
    Object.assign(d.lead, { stage: 'new', first_response_at: null, first_response_agent_id: null, visit_at: null, lost_reason: null, reassign_count: 0, last_activity_at: new Date(nowMs - m * MIN + 35000).toISOString() });
    if (!d.lead.phone) d.lead.phone = phone();
    drafts.push(d);
  });

  /* ---- inactive-stale leads: pick open leads, push their last activity back past the threshold */
  const inactiveCandidates = drafts.filter((d) => ['qualified', 'negotiation'].includes(d.lead.stage) && d.lead.assigned_agent_id && agents[d.lead.assigned_agent_id - 1].active && d.lead.score !== 'cold' && d.lead.first_response_at && nowMs - Date.parse(d.lead.created_at) < 20 * DAY && nowMs - Date.parse(d.lead.created_at) > 6 * DAY);
  const chosen = new Set<number>();
  const usedAgents = new Set<number>();
  for (const [n, sc] of [[3, 'hot'], [2, 'warm']] as const) {
    const pool = inactiveCandidates.filter((d) => d.lead.score === sc && !chosen.has(d.lead.id));
    for (let k = 0; k < n; k++) {
      const d = pool.find((x) => !chosen.has(x.lead.id) && !usedAgents.has(x.lead.assigned_agent_id!));
      if (!d) break;
      usedAgents.add(d.lead.assigned_agent_id!);
      chosen.add(d.lead.id);
      const idle = sc === 'hot' ? rng.range(1.3, 2.4) : rng.range(3.4, 5);
      const at = nowMs - idle * DAY;
      d.evs = d.evs.filter((e) => Date.parse(e.created_at) <= at);
      d.lead.last_activity_at = new Date(Math.max(at, Date.parse(d.lead.created_at) + 60 * MIN)).toISOString();
      const lastStage = [...d.evs].reverse().find((e) => e.to_stage && (e.event_type === 'created' || e.event_type === 'stage_change'))?.to_stage ?? 'new';
      d.lead.stage = lastStage;
      if (d.lead.stage === 'new' || d.lead.stage === 'qualified') d.lead.visit_at = null;
      d.lead.lost_reason = null;
    }
  }

  /* ---- reconcile stale flag + keep every other open lead alive */
  const stalledOk = new Set([...chosen]);
  for (const d of drafts) {
    const l = d.lead;
    if (!isOpen2(l.stage) || l.assigned_agent_id == null || stalledOk.has(l.id)) continue;
    const designated = !l.first_response_at && l.stage === 'new';
    if (designated) continue;
    const active = agents[l.assigned_agent_id - 1].active;
    if (!active) {
      // inactive agent's open leads were handed to an active agent at deactivation
      const to = pickAgent(deactivatedAt, [l.assigned_agent_id]);
      d.evs.push({ lead_id: l.id, agent_id: to, event_type: 'reassigned_stale', from_stage: null, to_stage: null, note: `Reassigned to ${AGENTS[to - 1].name} (agent deactivated)`, created_at: new Date(Math.max(deactivatedAt, Date.parse(l.created_at) + HOUR)).toISOString() });
      l.assigned_agent_id = to; l.reassign_count += 1;
    }
    if (deriveIsStale(l, true, anchor, cfg)) {
      const thr = (l.score === 'hot' ? cfg.stale_days_hot : l.score === 'warm' ? cfg.stale_days_warm : cfg.stale_days_cold) * DAY;
      const at = nowMs - rng.range(0.1, 0.85) * thr;
      d.evs.push({ lead_id: l.id, agent_id: l.assigned_agent_id, event_type: 'followup_done', from_stage: null, to_stage: null, note: 'Checked in with buyer', created_at: new Date(Math.max(at, Date.parse(l.created_at) + 1000)).toISOString() });
      l.last_activity_at = new Date(Math.max(at, Date.parse(l.created_at) + 1000)).toISOString();
    }
  }
  for (const d of drafts) {
    const l = d.lead;
    l.is_stale = isOpen2(l.stage) && deriveIsStale(l, l.assigned_agent_id != null && agents[l.assigned_agent_id - 1].active, anchor, cfg);
    if (l.is_stale && l.first_response_at) {
      const idle = Math.floor((nowMs - Date.parse(l.last_activity_at)) / DAY);
      d.evs.push({ lead_id: l.id, agent_id: l.assigned_agent_id, event_type: 'inactivity_nudge', from_stage: null, to_stage: null, note: `No activity for ${idle} day(s) on a ${l.score} lead in stage ${l.stage}`, created_at: new Date(nowMs - rng.range(0.5, 6) * HOUR).toISOString() });
    }
  }

  /* ---- test rows (hidden by default) */
  const testLead = (name: string, source: Source, agentId: number, minutesAgo: number): Draft => {
    const id = nextLeadId++;
    const created = nowMs - minutesAgo * MIN;
    const iso = (t: number) => new Date(t).toISOString();
    return {
      lead: { id, name, phone: phone(), email: null, source, source_detail: 'Test harness', campaign: null, budget_min: L(60), budget_max: L(80), location_pref: 'Gomti Nagar', property_type: 'apartment', bhk: 3, timeline: 'within_1_month', score: 'warm', score_points: 55, score_reason: 'Test record created by the test harness.', priority: 0, repeat_count: 0, assigned_agent_id: agentId, assigned_at: iso(created + 30000), reassign_count: 0, stage: 'qualified', visit_at: null, lost_reason: null, created_at: iso(created), first_response_at: iso(created + 6 * MIN), first_response_agent_id: agentId, last_activity_at: iso(created + 20 * MIN), is_stale: false, is_test: true },
      evs: [
        { lead_id: id, agent_id: null, event_type: 'created', from_stage: null, to_stage: 'new', note: 'Captured from ' + source, created_at: iso(created) },
        { lead_id: id, agent_id: agentId, event_type: 'assigned', from_stage: null, to_stage: null, note: 'Assigned', created_at: iso(created + 30000) },
        { lead_id: id, agent_id: agentId, event_type: 'called', from_stage: null, to_stage: null, note: null, created_at: iso(created + 6 * MIN) },
        { lead_id: id, agent_id: agentId, event_type: 'stage_change', from_stage: 'new', to_stage: 'qualified', note: null, created_at: iso(created + 20 * MIN) },
      ],
    };
  };
  drafts.push(testLead('TEST Portal Buyer', '99acres', 2, 60 * 30), testLead('TEST Meta Buyer', 'meta', 5, 60 * 31), testLead('TEST Referral Buyer', 'referral', 1, 60 * 32));

  /* ---- finalise leads + events with global ids in time order */
  drafts.sort((a, b) => a.lead.created_at.localeCompare(b.lead.created_at));
  const remap = new Map<number, number>();
  drafts.forEach((d, i) => remap.set(d.lead.id, i + 1));
  const leads: RawLead[] = drafts.map((d) => ({ ...d.lead, id: remap.get(d.lead.id)! }));
  const rawEvents: Omit<RawEvent, 'id'>[] = drafts.flatMap((d) => d.evs.map((e) => ({ ...e, lead_id: remap.get(d.lead.id)! })));

  /* ---- listings */
  const listings: RawListing[] = [];
  const mkListing = (i: number): RawListing => {
    const project = PROJECTS[i % PROJECTS.length];
    const loc = LOCALITIES[(i * 3 + 1) % LOCALITIES.length];
    const kind = i % 9 === 0 || i % 9 === 5 ? 'plot' : i % 9 === 3 ? 'villa' : 'apartment';
    const bhk = kind === 'apartment' ? [2, 3, 3, 4, 2, 3][i % 6] : kind === 'villa' ? [3, 4][i % 2] : null;
    const price = kind === 'apartment' ? (bhk === 2 ? L(45 + (i * 5) % 22) : bhk === 3 ? L(74 + (i * 7) % 48) : L(130 + (i * 9) % 60)) : kind === 'villa' ? L(160 + (i * 11) % 85) : L(38 + (i * 13) % 100);
    return {
      id: i + 1, title: kind === 'plot' ? `${(i % 3 + 1) * 1000} sq ft plot, ${project}` : `${bhk} BHK ${kind === 'villa' ? 'villa' : 'flat'}, ${project}`,
      project, location: loc, property_type: kind, bhk, price, status: 'open', is_test: false,
      created_at: new Date(nowMs - (86 - i * 3.3) * DAY + rng.range(0, 8) * HOUR).toISOString(),
    };
  };
  for (let i = 0; i < 25; i++) listings.push(mkListing(i));
  listings[4].status = 'under_offer'; listings[11].status = 'under_offer'; listings[17].status = 'under_offer';
  listings[2].status = 'sold'; listings[8].status = 'sold'; listings[20].status = 'withdrawn';
  listings.push({ id: 26, title: 'TEST 3 BHK flat, Test Towers', project: 'Test Towers', location: 'Gomti Nagar', property_type: 'apartment', bhk: 3, price: L(70), status: 'open', is_test: true, created_at: new Date(nowMs - 29 * HOUR).toISOString() });

  /* ---- matches (same rules as the SQL matcher) */
  const matches: RawMatch[] = [];
  let mid = 1;
  for (const li of listings.filter((x) => !x.is_test)) {
    const asOpen = { ...li, status: 'open' as const };
    const found = matchListing(asOpen, leads, matches, cfg);
    for (const m of found) {
      const lead = leads[m.lead_id - 1];
      const created = Math.max(Date.parse(li.created_at), Date.parse(lead.created_at));
      const messaged = created + rng.int(2, 15) * MIN;
      const sentOk = messaged < nowMs && (li.status !== 'open' || messaged < nowMs - 10 * MIN);
      const responded = sentOk && rng.chance(0.42);
      const interested = responded ? rng.chance(0.6) : null;
      const respAt = responded ? Math.min(nowMs - MIN, messaged + rng.range(5, 600) * MIN) : null;
      matches.push({
        id: mid++, listing_id: li.id, lead_id: m.lead_id, match_score: m.match_score, created_at: new Date(created).toISOString(),
        messaged_at: sentOk ? new Date(messaged).toISOString() : null,
        response: responded ? (interested ? 'Interested' : 'Not interested') : null,
        responded_at: respAt != null ? new Date(respAt).toISOString() : null, interested,
      });
    }
  }
  // test listing matched only to test buyers
  for (const m of matchListing(listings[25], leads, matches, cfg)) {
    matches.push({ id: mid++, listing_id: 26, lead_id: m.lead_id, match_score: m.match_score, created_at: new Date(nowMs - 28 * HOUR).toISOString(), messaged_at: new Date(nowMs - 28 * HOUR + 8 * MIN).toISOString(), response: null, responded_at: null, interested: null });
  }
  for (const m of matches) {
    if (m.messaged_at) rawEvents.push({ lead_id: m.lead_id, agent_id: null, event_type: 'listing_matched', from_stage: null, to_stage: null, note: `Matched ${listings[m.listing_id - 1].title} (${Math.round(m.match_score)}%)`, created_at: m.messaged_at });
    if (m.responded_at) rawEvents.push({ lead_id: m.lead_id, agent_id: null, event_type: 'listing_response', from_stage: null, to_stage: null, note: `${m.response}: ${listings[m.listing_id - 1].title}`, created_at: m.responded_at });
  }

  rawEvents.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const events: RawEvent[] = rawEvents.map((e, i) => ({ ...e, id: i + 1 }));

  /* ---- visit reminders (2h before every booked visit that has passed) */
  const evIdx = indexEvents(events);
  let extra = events.length;
  for (const l of leads) {
    if (!l.visit_at || !(evIdx.get(l.id) ?? []).some((e) => e.to_stage === 'site_visit_booked')) continue;
    const at = Date.parse(l.visit_at) - cfg.visit_reminder_minutes * MIN;
    if (at < nowMs) events.push({ id: ++extra, lead_id: l.id, agent_id: l.assigned_agent_id, event_type: 'visit_reminder_sent', from_stage: null, to_stage: null, note: 'Reminder sent to agent and buyer', created_at: new Date(at).toISOString() });
  }
  events.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  events.forEach((e, i) => (e.id = i + 1));

  /* ---- costs: 3 months, current month intentionally missing */
  const costs: RawCost[] = [];
  const cm = monthOf(today);
  const amounts: Record<string, number[]> = { '99acres': [45000, 45000, 45000], magicbricks: [40000, 40000, 40000], meta: [57500, 60000, 62000], website: [14000, 14000, 14000] };
  let cid = 1;
  for (let k = 3; k >= 1; k--) for (const [source, arr] of Object.entries(amounts)) costs.push({ id: cid++, source: source as Source, month: addMonths(cm, -k), amount_inr: arr[3 - k], is_test: false });
  costs.push({ id: cid++, source: 'other', month: cm, amount_inr: 1000, is_test: true });

  /* ---- errors */
  const errs: [string, string, string, string][] = [
    ['Real Estate Lead Command Center', 'Score | Lead Welcome: Send', '(#132001) Template name does not exist in the translation: lead_welcome / en', '5h'],
    ['Real Estate Lead Command Center', 'Intake | 99acres Lead Email', 'Gmail: Invalid Credentials (token expired). Reconnect the Gmail account.', '31h'],
    ['Real Estate Lead Command Center', 'Reports | Build Digest', 'Cannot read properties of undefined (reading \'map\')', '52h'],
    ['Real Estate Lead Command Center', 'Agent | Create Calendar Event', 'Google Calendar: Rate Limit Exceeded', '78h'],
    ['Real Estate Lead Command Center', 'Intake | Upsert Lead', 'connect ETIMEDOUT database host: connection timed out', '121h'],
  ];
  const errors: RawError[] = errs.map(([workflow, node, error, ago], i) => ({
    id: i + 1, workflow, workflow_id: 'grnMWb9jCffGgRW6', execution_id: String(41200 + i * 17), node, error, payload: { mode: 'trigger', retryOf: null }, is_test: false,
    created_at: new Date(nowMs - parseInt(ago) * HOUR).toISOString(),
  }));
  errors.push({ id: 6, workflow: 'Real Estate Lead Command Center', workflow_id: 'grnMWb9jCffGgRW6', execution_id: '41999', node: 'Cost | Reject Invalid Entry', error: 'TEST: invalid cost entry rejected on purpose', payload: { test: true }, is_test: true, created_at: new Date(nowMs - 30 * HOUR).toISOString() });

  const configRows = buildConfigRows(cfg);
  return { agents, leads, events, listings, matches, costs, errors, cfg, configRows, anchor: anchor.toISOString() };
}

function isOpen2(s: Stage) { return s === 'new' || s === 'qualified' || s === 'site_visit_booked' || s === 'visited' || s === 'negotiation'; }

function sourceDetail(source: Source, rng: Rng): string | null {
  switch (source) {
    case '99acres': return `Project enquiry: ${rng.pick(PROJECTS)}`;
    case 'magicbricks': return `Property ID MB-${rng.int(1000000, 9999999)}`;
    case 'meta': return 'Lead form: Weekend Open House';
    case 'website': return rng.pick(['Contact page', 'Brochure download', 'Project page enquiry']);
    case 'referral': return `Referred by ${rng.pick(FIRST_M)} ${rng.pick(LAST)}`;
    default: return null;
  }
}

function scoreReason(o: { sc: Score; isJunk: boolean; prof: { locs: string; ptype: string; bhk: number | null; stated: boolean; base: number }; source: Source; timeline: string; repeat: number; hasPhone: boolean }): string {
  if (o.isJunk) return 'Contact details look invalid and the enquiry is vague, so it is treated as low quality.';
  const when: Record<string, string> = { immediate: 'wants to buy immediately', within_1_month: 'plans to buy within a month', '1_3_months': 'plans to buy in 1–3 months', '3_6_months': 'plans to buy in 3–6 months', '6_plus_months': 'is 6+ months away from buying', just_exploring: 'is just exploring', unknown: 'has not said when they will buy' };
  const kind = o.prof.ptype === 'plot' ? 'a plot' : o.prof.bhk ? `a ${o.prof.bhk} BHK ${o.prof.ptype}` : `a ${o.prof.ptype}`;
  const where = o.prof.locs ? ` in ${o.prof.locs}` : '';
  const budget = o.prof.stated ? 'Budget is stated and realistic for our stock' : 'No budget given';
  const src = o.source === 'referral' ? 'referrals close best' : o.source === '99acres' ? 'portal buyers are usually serious' : o.source === 'meta' ? 'ad leads are the least qualified' : o.source === 'magicbricks' ? 'portal enquiry' : 'web enquiry';
  const rep = o.repeat ? '; enquired more than once' : '';
  const head = o.sc === 'hot' ? 'Strong fit' : o.sc === 'warm' ? 'Decent fit' : 'Weak fit';
  return `${head}: ${budget}; wants ${kind}${where}; ${when[o.timeline]}; ${src}${rep}.`;
}

function buildConfigRows(cfg: Cfg) {
  const r = (key: string, value: unknown, description: string) => ({ key, value, description });
  return [
    r('sla_first_response_min', cfg.sla_first_response_min, 'Minutes without a human first response before the agent is nudged and is_stale is set'),
    r('escalate_owner_min', cfg.escalate_owner_min, 'Minutes without a first response before the owner is alerted'),
    r('reassign_min', cfg.reassign_min, 'Minutes without a first response before the lead moves to the next agent'),
    r('max_reassignments', cfg.max_reassignments, 'Stop reassigning a lead after this many moves'),
    r('stale_days_hot', cfg.stale_days_hot, 'Days without activity before a hot lead is flagged'),
    r('stale_days_warm', cfg.stale_days_warm, 'Days without activity before a warm lead is flagged'),
    r('stale_days_cold', cfg.stale_days_cold, 'Days without activity before a cold lead is flagged'),
    r('score_weight_budget_fit', 30, 'Rubric points: budget stated and realistic for the inventory'),
    r('score_weight_timeline', 30, 'Rubric points: purchase timeline (under 3 months scores in the top band)'),
    r('score_weight_specificity', 15, 'Rubric points: location, type and BHK are specific'),
    r('score_weight_source_quality', 15, 'Rubric points: quality of the source'),
    r('score_weight_repeat_enquiry', 10, 'Rubric points: repeat enquiry'),
    r('score_hot_min', 70, 'Total points at or above this are hot'),
    r('score_warm_min', 40, 'Total points at or above this are warm, below is cold'),
    r('source_quality', { referral: 90, walk_in: 85, '99acres': 70, magicbricks: 65, website: 60, crm: 60, meta: 50, other: 40 }, 'Source quality on a 0-100 scale, shown to the scoring agent'),
    r('match_tolerance_pct', cfg.match_tolerance_pct, 'Budget tolerance either side of the buyer budget, in percent'),
    r('match_threshold', cfg.match_threshold, 'Minimum match score (0-100) before a buyer is messaged'),
    r('match_hot_score', cfg.match_hot_score, 'Match score at or above this notifies the agent even for non-hot leads'),
    r('match_max_per_listing', cfg.match_max_per_listing, 'Maximum buyers messaged per listing per run'),
    r('match_weight_location', cfg.match_weight_location, 'Match score points for location'),
    r('match_weight_property_type', cfg.match_weight_property_type, 'Match score points for property type'),
    r('match_weight_bhk', cfg.match_weight_bhk, 'Match score points for BHK'),
    r('match_weight_budget', cfg.match_weight_budget, 'Match score points for budget'),
    r('consider_cut_multiplier', cfg.consider_cut_multiplier, 'A paid source is flagged when its cost per site visit is more than this many times the best paid source'),
    r('visit_reminder_minutes', cfg.visit_reminder_minutes, 'Reminder is sent this many minutes before a site visit'),
    r('visit_duration_min', 60, 'Calendar event length for a site visit'),
    r('digest_hour_ist', 9, 'Hour (0-23, IST) when the daily digest and the monthly report go out'),
    r('metrics_window_days', 30, 'Rolling window for speed, funnel and leaderboard metrics'),
    r('owner_phone', '+919811100099', 'Owner WhatsApp number in +91 format'),
    r('owner_email', 'owner@skylinerealty.in', 'Owner email for digests and reports'),
    r('admin_phone', '+919811100098', 'Admin WhatsApp number for error alerts'),
    r('admin_email', 'admin@skylinerealty.in', 'Admin email for error alerts'),
    r('company_name', 'Skyline Realty, Lucknow', 'Name used in messages'),
    r('google_calendar_id', 'primary', 'Calendar that receives site visit events'),
  ];
}
