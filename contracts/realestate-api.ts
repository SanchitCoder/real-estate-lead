/**
 * Real Estate Lead Command Center: API contract (single source of truth).
 *
 * Every dashboard endpoint is an n8n webhook inside the ONE consolidated workflow
 * "Real Estate Lead Command Center", reachable at  {N8N_BASE_URL}/webhook/re/<path>.
 * The browser never calls n8n: it calls /api/n8n/<path>, a Next.js route handler that
 *   1. checks the path/method/role against `endpoints` below (the allow-list),
 *   2. validates the query/body with `request`,
 *   3. forwards (live) or serves seeded data (mock) and validates the reply with `response`.
 *
 * ----- Differences between the brief and the REAL backend (the real backend wins) -----
 *  1. Sources: backend has 8 (meta, 99acres, magicbricks, website, referral, walk_in, crm, other), not 5.
 *  2. Timeline enum is immediate | within_1_month | 1_3_months | 3_6_months | 6_plus_months | just_exploring | unknown.
 *  3. property_type enum: apartment | villa | plot | commercial | other.  listing status: open | under_offer | sold | withdrawn.
 *  4. lead_events.event_type values are the backend's: created, repeat_enquiry, scored, assigned, unassigned,
 *     reassigned_stale, auto_response_sent, agent_alerted, sla_breached, owner_escalated, stage_change, called,
 *     followup_done, note, lead_reply, visit_reminder_sent, inactivity_nudge, listing_matched, listing_response,
 *     command_rejected.  There is NO visit_booked / match_sent / inbound_reply / follow_up event: a booking is a
 *     stage_change into site_visit_booked, and the lead's reply is lead_reply.
 *  5. "Site visit" in the backend views = lead REACHED `visited` (v_source_roi_monthly.site_visits). So
 *     cost_per_site_visit = cost / visits DONE. The brief's "cost ÷ visits booked" is exposed as the extra
 *     field cost_per_visit_booked. Both are returned; the consider-cut rule uses the backend definition.
 *  6. consider_cut (monthly_roi_report): a PAID source (cost > 0) is flagged when site_visits = 0 OR its
 *     cost_per_site_visit > 2x the best PAID source that has site visits. Free sources (referral) are never the
 *     benchmark and are never flagged. The 2x multiplier was hard-coded in SQL; it is exposed as config key
 *     `consider_cut_multiplier` by migration sql/05_dashboard.sql (default 2).
 *  7. Funnel "reached" = highest stage ever reached (events + current stage); junk is excluded from the funnel.
 *  8. Existing public webhooks answer immediately ("Workflow got started.", responseMode onReceived). They are NOT
 *     Respond-to-Webhook and return no lead id. The new /re/* endpoints DO respond with the envelope below.
 *  9. No is_test column exists in the backend schema. Migration sql/05_dashboard.sql adds it to leads, listings,
 *     source_costs and workflow_errors (lead_events/listing_matches inherit through their lead/listing).
 * 10. Config is the `config` table (key, value jsonb), not n8n Variables. "digest time" is digest_hour_ist,
 *     "owner number" is owner_phone, there is no single "consider cutting" key in the original seed.
 * 11. IDs are bigint. n8n's Postgres node returns bigint/numeric as strings, so the schemas coerce numerics
 *     (`id`, money, scores) instead of assuming JSON numbers.
 * 12. Agents also have `weight` (weighted round-robin) which the brief did not list.
 * 13. Original external paths kept as-is (see `legacyWebhooks`): lead-intake, agent-action, listing-changed,
 *     referral-walkin-lead (form), source-cost-entry (form). Facebook, Gmail and WhatsApp are app triggers.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ primitives */
/** Numeric that may arrive as a string (pg bigint/numeric through n8n). */
export const num = z.coerce.number();
/** Nullable numeric: null stays null (z.coerce would turn it into 0). */
export const numNull = z.preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable());
export const isoDate = z.string().min(10); // ISO-8601 timestamp or date; tolerant of n8n formatting
export const isoDateNull = z.string().min(10).nullable();

export const SOURCES = ['meta', '99acres', 'magicbricks', 'website', 'referral', 'walk_in', 'crm', 'other'] as const;
export const Source = z.enum(SOURCES);
export type Source = z.infer<typeof Source>;

export const SCORES = ['hot', 'warm', 'cold'] as const;
export const Score = z.enum(SCORES);
export type Score = z.infer<typeof Score>;

export const STAGES = ['new', 'qualified', 'site_visit_booked', 'visited', 'negotiation', 'closed_won', 'closed_lost', 'junk'] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;
/** Funnel order (lost and junk sit outside). Mirrors stage_ord() in SQL. */
export const FUNNEL_STAGES = ['new', 'qualified', 'site_visit_booked', 'visited', 'negotiation', 'closed_won'] as const;
export const OPEN_STAGES = ['new', 'qualified', 'site_visit_booked', 'visited', 'negotiation'] as const;

export const PropertyType = z.enum(['apartment', 'villa', 'plot', 'commercial', 'other']);
export type PropertyType = z.infer<typeof PropertyType>;
export const Timeline = z.enum(['immediate', 'within_1_month', '1_3_months', '3_6_months', '6_plus_months', 'just_exploring', 'unknown']);
export type Timeline = z.infer<typeof Timeline>;
export const ListingStatus = z.enum(['open', 'under_offer', 'sold', 'withdrawn']);
export type ListingStatus = z.infer<typeof ListingStatus>;

export const EVENT_TYPES = [
  'created', 'repeat_enquiry', 'scored', 'assigned', 'unassigned', 'reassigned_stale', 'auto_response_sent',
  'agent_alerted', 'sla_breached', 'owner_escalated', 'stage_change', 'called', 'followup_done', 'note',
  'lead_reply', 'visit_reminder_sent', 'inactivity_nudge', 'listing_matched', 'listing_response', 'command_rejected',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const EscalationLevel = z.enum(['agent_nudged', 'owner_escalated', 'auto_reassigned', 'inactive']);
export type EscalationLevel = z.infer<typeof EscalationLevel>;

/* ------------------------------------------------------------------ envelope */
export const Meta = z.object({ page: num, page_size: num, total: num });
export type Meta = z.infer<typeof Meta>;
export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ status: z.literal('ok'), data, meta: Meta.optional() });
export const ErrorEnvelope = z.object({
  status: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
  field: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/* ------------------------------------------------------------------ entities */
export const Agent = z.object({
  id: num,
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  active: z.boolean(),
  round_robin_order: num,
  weight: num,
  max_open_leads: num,
  open_leads: num,
  created_at: isoDate,
});
export type Agent = z.infer<typeof Agent>;

export const Lead = z.object({
  id: num,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: Source,
  source_detail: z.string().nullable(),
  campaign: z.string().nullable(),
  budget_min: numNull,
  budget_max: numNull,
  location_pref: z.string().nullable(),
  property_type: PropertyType.nullable(),
  bhk: numNull,
  timeline: Timeline,
  score: Score.nullable(),
  score_points: numNull,
  score_reason: z.string().nullable(),
  priority: num,
  repeat_count: num,
  assigned_agent_id: numNull,
  assigned_agent_name: z.string().nullable(),
  reassign_count: num,
  stage: Stage,
  visit_at: isoDateNull,
  lost_reason: z.string().nullable(),
  created_at: isoDate,
  first_response_at: isoDateNull,
  last_activity_at: isoDate,
  is_stale: z.boolean(),
  is_test: z.boolean(),
  /** computed by the backend: first_response_at - created_at, minutes (null while unanswered) */
  minutes_to_first_response: numNull,
  /** computed by the backend: now() - created_at, minutes */
  minutes_since_created: num,
});
export type Lead = z.infer<typeof Lead>;

export const LeadEvent = z.object({
  id: num,
  lead_id: num,
  agent_id: numNull,
  agent_name: z.string().nullable(),
  event_type: EventType,
  from_stage: Stage.nullable(),
  to_stage: Stage.nullable(),
  note: z.string().nullable(),
  created_at: isoDate,
});
export type LeadEvent = z.infer<typeof LeadEvent>;

export const Listing = z.object({
  id: num,
  title: z.string(),
  project: z.string().nullable(),
  location: z.string(),
  property_type: PropertyType,
  bhk: numNull,
  price: num,
  status: ListingStatus,
  is_test: z.boolean(),
  created_at: isoDate,
});
export type Listing = z.infer<typeof Listing>;

export const ListingWithCounts = Listing.extend({
  matched: num,
  messaged: num,
  responded: num,
  interested: num,
});
export type ListingWithCounts = z.infer<typeof ListingWithCounts>;

export const ListingMatch = z.object({
  id: num,
  listing_id: num,
  listing_title: z.string(),
  lead_id: num,
  lead_name: z.string().nullable(),
  lead_phone: z.string().nullable(),
  lead_stage: Stage,
  lead_score: Score.nullable(),
  assigned_agent_name: z.string().nullable(),
  match_score: num,
  messaged_at: isoDateNull,
  response: z.string().nullable(),
  responded_at: isoDateNull,
  interested: z.boolean().nullable(),
  created_at: isoDate,
});
export type ListingMatch = z.infer<typeof ListingMatch>;

export const CostRow = z.object({
  id: num,
  source: Source,
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  amount_inr: num,
  is_test: z.boolean(),
});
export type CostRow = z.infer<typeof CostRow>;

export const ErrorRow = z.object({
  id: num,
  workflow: z.string(),
  workflow_id: z.string().nullable(),
  execution_id: z.string().nullable(),
  node: z.string().nullable(),
  error: z.string().nullable(),
  payload: z.unknown().nullable(),
  is_test: z.boolean(),
  created_at: isoDate,
});
export type ErrorRow = z.infer<typeof ErrorRow>;

/* ------------------------------------------------------------------ shared query helpers */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const boolStr = z.enum(['true', 'false']);
const range = { from: dateStr.optional(), to: dateStr.optional() };

/* ------------------------------------------------------------------ READ endpoints */
// ---- GET /re/overview
export const Totals = z.object({
  new_leads: num,
  avg_first_response_min: numNull,
  median_first_response_min: numNull,
  breaching_sla: num,
  hot_open: num,
  visits_booked: num,
  visits_done: num,
  closures: num,
  spend_inr: num,
});
export type Totals = z.infer<typeof Totals>;
export const SourceCpsv = z.object({ source: Source, cost_per_site_visit: num });
export const OverviewResponse = z.object({
  period: z.object({ from: dateStr, to: dateStr }),
  previous_period: z.object({ from: dateStr, to: dateStr }),
  totals: Totals,
  previous: Totals,
  best_source: SourceCpsv.nullable(),
  worst_source: SourceCpsv.nullable(),
  series: z.array(
    z.object({
      date: dateStr,
      new_leads: num,
      avg_first_response_min: numNull,
      breaching_sla: num,
      hot_open: num,
      visits_booked: num,
      closures: num,
      spend_inr: num,
    }),
  ),
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;

// ---- GET /re/leads
export const LEAD_SORTS = ['created_desc', 'created_asc', 'last_activity_desc', 'response_desc', 'score_desc'] as const;
export const LeadsQuery = z.object({
  source: Source.optional(),
  score: Score.optional(),
  stage: Stage.optional(),
  agent_id: z.coerce.number().int().optional(),
  stale: boolStr.optional(),
  /** no first response yet */
  untouched: boolStr.optional(),
  /** first response took longer than the SLA, or still waiting past it */
  breaching: boolStr.optional(),
  /** visit_at within the next 7 days */
  visits_this_week: boolStr.optional(),
  search: z.string().max(100).optional(),
  include_test: boolStr.optional(),
  ...range,
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
  sort: z.enum(LEAD_SORTS).optional(),
});
export type LeadsQuery = z.infer<typeof LeadsQuery>;
export const LeadsResponse = z.array(Lead);

// ---- GET /re/lead?id=
export const LeadQuery = z.object({ id: z.coerce.number().int() });
export const LeadDetailResponse = z.object({
  lead: Lead,
  agent: Agent.nullable(),
  events: z.array(LeadEvent),
  matches: z.array(ListingMatch),
});
export type LeadDetailResponse = z.infer<typeof LeadDetailResponse>;

// ---- GET /re/speed
const SpeedStat = z.object({ leads: num, responded: num, avg_min: numNull, median_min: numNull, breaches: num });
export const SpeedResponse = z.object({
  overall: SpeedStat.extend({
    pct_within_5: numNull,
    pct_within_30: numNull,
    pct_within_120: numNull,
  }),
  by_agent: z.array(SpeedStat.extend({ agent_id: numNull, agent_name: z.string() })),
  by_source: z.array(SpeedStat.extend({ source: Source })),
  by_hour: z.array(z.object({ hour: num, leads: num, avg_min: numNull })),
  heatmap: z.array(z.object({ weekday: num, hour: num, leads: num, avg_min: numNull })),
  breach_trend: z.array(z.object({ date: dateStr, leads: num, breaches: num })),
  escalation: z.array(z.object({ level: EscalationLevel, count: num })),
});
export type SpeedResponse = z.infer<typeof SpeedResponse>;

// ---- GET /re/stale
export const StaleLead = z.object({
  lead_id: num,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  score: Score.nullable(),
  stage: Stage,
  source: Source,
  agent_id: numNull,
  agent_name: z.string().nullable(),
  level: EscalationLevel,
  reason: z.string(),
  minutes_waiting: num,
  idle_days: num,
  created_at: isoDate,
  last_activity_at: isoDate,
});
export type StaleLead = z.infer<typeof StaleLead>;
export const StaleResponse = z.array(StaleLead);

// ---- GET /re/funnel
export const FunnelResponse = z.object({
  stages: z.array(
    z.object({
      stage: z.enum(FUNNEL_STAGES),
      reached: num,
      currently_in: num,
      conv_from_prev_pct: numNull,
      conv_from_top_pct: numNull,
      drop_off: num,
      avg_days_in_stage: numNull,
    }),
  ),
  lost_reasons: z.array(z.object({ reason: z.string(), count: num })),
  junk_by_source: z.array(z.object({ source: Source, leads: num, junk: num, junk_rate_pct: numNull })),
  totals: z.object({ leads: num, junk: num, closed_lost: num, open: num }),
});
export type FunnelResponse = z.infer<typeof FunnelResponse>;

// ---- GET /re/source-roi
export const RoiRow = z.object({
  source: Source,
  cost_inr: num,
  leads: num,
  junk: num,
  qualified: num,
  visits_booked: num,
  site_visits: num,
  closures: num,
  cost_per_lead: numNull,
  cost_per_visit_booked: numNull,
  cost_per_site_visit: numNull,
  cost_per_closure: numNull,
  consider_cut: z.boolean(),
  advice: z.string(),
});
export type RoiRow = z.infer<typeof RoiRow>;
export const SourceRoiResponse = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  rows: z.array(RoiRow),
  best_source: SourceCpsv.nullable(),
  history: z.array(z.object({ month: z.string(), spend_inr: num, closures: num, site_visits: num, leads: num })),
  /** paid sources (those with a cost in any of the last months) with no cost row for the CURRENT month */
  missing_current_month: z.array(Source),
  current_month: z.string(),
});
export type SourceRoiResponse = z.infer<typeof SourceRoiResponse>;

// ---- GET /re/agents/leaderboard
export const LeaderboardRow = z.object({
  rank: num,
  agent_id: num,
  name: z.string(),
  active: z.boolean(),
  open_leads: num,
  leads_assigned: num,
  avg_first_response_min: numNull,
  follow_ups_done: num,
  visits_booked: num,
  visits_done: num,
  conversions: num,
  conversion_pct: numNull,
  stale_count: num,
});
export type LeaderboardRow = z.infer<typeof LeaderboardRow>;
export const LeaderboardResponse = z.array(LeaderboardRow);

// ---- GET /re/agents
export const AgentsResponse = z.array(Agent);

// ---- GET /re/listings, /re/listing
export const ListingsQuery = z.object({ status: ListingStatus.optional(), include_test: boolStr.optional() });
export const ListingsResponse = z.array(ListingWithCounts);
export const ListingQuery = z.object({ id: z.coerce.number().int() });
export const ListingDetailResponse = z.object({ listing: ListingWithCounts, matches: z.array(ListingMatch) });
export type ListingDetailResponse = z.infer<typeof ListingDetailResponse>;

// ---- GET /re/costs, /re/config, /re/errors
export const CostsResponse = z.array(CostRow);
export const ConfigRow = z.object({ key: z.string(), value: z.unknown(), description: z.string().nullable() });
export type ConfigRow = z.infer<typeof ConfigRow>;
export const ConfigResponse = z.array(ConfigRow);
export const ErrorsResponse = z.array(ErrorRow);

/* ------------------------------------------------------------------ ACTION endpoints */
const phoneIn = z
  .string()
  .trim()
  .regex(/^(\+?91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

// ---- POST /re/lead  (into the shared intake chain)
export const AddLeadRequest = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    phone: phoneIn.optional().or(z.literal('')),
    email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
    source: Source,
    source_detail: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    budget_min: z.coerce.number().min(0).optional(),
    budget_max: z.coerce.number().min(0).optional(),
    location_pref: z.string().max(200).optional(),
    property_type: PropertyType.optional(),
    bhk: z.coerce.number().int().min(1).max(10).optional(),
    timeline: Timeline.optional(),
    notes: z.string().max(1000).optional(),
    is_test: z.boolean().optional(),
  })
  .refine((v) => !!v.phone || !!v.email, { message: 'Add a phone or an email', path: ['phone'] })
  .refine((v) => v.budget_min == null || v.budget_max == null || v.budget_min <= v.budget_max, {
    message: 'Minimum budget must not exceed maximum',
    path: ['budget_min'],
  });
export type AddLeadRequest = z.infer<typeof AddLeadRequest>;
export const AddLeadResponse = z.object({
  lead_id: num,
  is_new: z.boolean(),
  repeat_logged: z.boolean(),
  stage: Stage,
  assigned_agent_id: numNull,
  assigned_agent_name: z.string().nullable(),
  message: z.string(),
});
export type AddLeadResponse = z.infer<typeof AddLeadResponse>;

// ---- POST /re/lead/stage  (into the shared stage-update chain, incl. calendar + reminder)
export const StageRequest = z
  .object({
    lead_id: z.coerce.number().int(),
    to_stage: Stage,
    note: z.string().max(500).optional(),
    /** required when to_stage = site_visit_booked. ISO timestamp, interpreted as absolute time. */
    visit_at: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to_stage === 'site_visit_booked' && !v.visit_at)
      ctx.addIssue({ code: 'custom', path: ['visit_at'], message: 'Pick a date and time for the site visit' });
    if (v.to_stage === 'closed_lost' && !v.note?.trim())
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say why the lead was lost' });
  });
export type StageRequest = z.infer<typeof StageRequest>;
export const StageResponse = z.object({
  lead_id: num,
  from_stage: Stage,
  to_stage: Stage,
  visit_at: isoDateNull,
  first_touch: z.boolean(),
  calendar_event_created: z.boolean(),
  message: z.string(),
});
export type StageResponse = z.infer<typeof StageResponse>;

// ---- POST /re/lead/reassign
export const ReassignRequest = z.object({
  lead_id: z.coerce.number().int(),
  agent_id: z.coerce.number().int(),
  reason: z.string().trim().min(3, 'Add a short reason').max(300),
});
export type ReassignRequest = z.infer<typeof ReassignRequest>;
export const ReassignResponse = z.object({
  lead_id: num,
  from_agent_id: numNull,
  to_agent_id: num,
  to_agent_name: z.string(),
  notified: z.array(z.string()),
  message: z.string(),
});

// ---- POST /re/lead/note
export const NoteRequest = z.object({ lead_id: z.coerce.number().int(), note: z.string().trim().min(1, 'Write a note').max(1000) });
export const NoteResponse = z.object({ lead_id: num, event_id: num, message: z.string() });

// ---- POST /re/agent
export const AgentRequest = z
  .object({
    action: z.enum(['create', 'update', 'deactivate', 'activate']),
    id: z.coerce.number().int().optional(),
    name: z.string().trim().min(2, 'Name is required').max(120).optional(),
    phone: phoneIn.optional(),
    email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
    round_robin_order: z.coerce.number().int().min(1).max(999).optional(),
    weight: z.coerce.number().int().min(1).max(10).optional(),
    max_open_leads: z.coerce.number().int().min(0).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'create') {
      if (!v.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required' });
      if (!v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Phone is required' });
    } else if (v.id == null) ctx.addIssue({ code: 'custom', path: ['id'], message: 'Missing agent id' });
  });
export type AgentRequest = z.infer<typeof AgentRequest>;
export const AgentActionResponse = z.object({ agent: Agent, message: z.string() });

// ---- POST /re/listing  (create / update; into the shared matcher chain)
export const ListingRequest = z.object({
  id: z.coerce.number().int().optional(),
  title: z.string().trim().min(3, 'Give the listing a title').max(160),
  project: z.string().max(160).optional(),
  location: z.string().trim().min(2, 'Location is required').max(160),
  property_type: PropertyType,
  bhk: z.coerce.number().int().min(1).max(10).optional(),
  price: z.coerce.number().positive('Enter the asking price'),
  status: ListingStatus.default('open'),
  is_test: z.boolean().optional(),
});
export type ListingRequest = z.input<typeof ListingRequest>;
export const ListingActionResponse = z.object({ listing: ListingWithCounts, new_matches: num, message: z.string() });
export type ListingActionResponse = z.infer<typeof ListingActionResponse>;

// ---- POST /re/cost (upsert)
export const CostRequest = z.object({
  source: Source,
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Pick a month'),
  amount_inr: z.coerce.number().min(0, 'Amount cannot be negative'),
});
export type CostRequest = z.infer<typeof CostRequest>;
export const CostActionResponse = z.object({ cost: CostRow, replaced: z.boolean(), message: z.string() });

// ---- POST /re/test
export const TEST_SCENARIOS = [
  'portal_email_lead', 'meta_lead', 'referral_form', 'duplicate_lead', 'stale_lead_escalation',
  'visit_booking', 'listing_match', 'cost_entry', 'cleanup',
] as const;
export const TestRequest = z.object({ scenario: z.enum(TEST_SCENARIOS) });
export type TestRequest = z.infer<typeof TestRequest>;
export const TestResponse = z.object({
  scenario: z.enum(TEST_SCENARIOS),
  /** which real trigger chain the data was pushed through */
  chain: z.string(),
  created: z.object({ leads: num, events: num, listings: num, matches: num, costs: num }),
  lead_ids: z.array(num),
  removed: num.optional(),
  steps: z.array(z.string()),
  message: z.string(),
});
export type TestResponse = z.infer<typeof TestResponse>;

/* ------------------------------------------------------------------ endpoint map (allow-list) */
export type Role = 'owner' | 'agent';
export interface EndpointDef<Q extends z.ZodTypeAny = z.ZodTypeAny, B extends z.ZodTypeAny = z.ZodTypeAny, R extends z.ZodTypeAny = z.ZodTypeAny> {
  method: 'GET' | 'POST';
  /** path under /webhook/re/ */
  path: string;
  /** plain-language purpose, shown on the System page */
  label: string;
  roles: readonly Role[];
  query?: Q;
  body?: B;
  response: R;
  paginated?: boolean;
  /** the n8n lane/branch that serves it (documentation + System page) */
  lane: 'Dashboard API – Reads' | 'Dashboard API – Actions' | 'Test Harness';
  /** which shared chain an action connects into */
  sharedChain?: string;
}

const both: readonly Role[] = ['owner', 'agent'];
const owner: readonly Role[] = ['owner'];
const emptyQuery = z.object({});
const rangeQuery = z.object(range);

export const endpoints = {
  overview: { method: 'GET', path: 'overview', label: 'Command Center totals', roles: both, query: rangeQuery, response: OverviewResponse, lane: 'Dashboard API – Reads' },
  leads: { method: 'GET', path: 'leads', label: 'Lead feed', roles: both, query: LeadsQuery, response: LeadsResponse, paginated: true, lane: 'Dashboard API – Reads' },
  lead: { method: 'GET', path: 'lead', label: 'One lead with timeline', roles: both, query: LeadQuery, response: LeadDetailResponse, lane: 'Dashboard API – Reads' },
  speed: { method: 'GET', path: 'speed', label: 'Speed to lead', roles: both, query: rangeQuery.extend({ agent_id: z.coerce.number().int().optional() }), response: SpeedResponse, lane: 'Dashboard API – Reads' },
  stale: { method: 'GET', path: 'stale', label: 'Stale leads and escalation level', roles: both, query: z.object({ agent_id: z.coerce.number().int().optional() }), response: StaleResponse, lane: 'Dashboard API – Reads' },
  funnel: { method: 'GET', path: 'funnel', label: 'Sales funnel', roles: both, query: rangeQuery.extend({ source: Source.optional(), agent_id: z.coerce.number().int().optional() }), response: FunnelResponse, lane: 'Dashboard API – Reads' },
  sourceRoi: { method: 'GET', path: 'source-roi', label: 'Source ROI', roles: owner, query: z.object({ month: z.string().regex(/^\d{4}-\d{2}(-01)?$/).optional(), ...range }), response: SourceRoiResponse, lane: 'Dashboard API – Reads' },
  leaderboard: { method: 'GET', path: 'agents/leaderboard', label: 'Agent leaderboard', roles: both, query: rangeQuery, response: LeaderboardResponse, lane: 'Dashboard API – Reads' },
  agents: { method: 'GET', path: 'agents', label: 'Agents', roles: both, query: emptyQuery, response: AgentsResponse, lane: 'Dashboard API – Reads' },
  listings: { method: 'GET', path: 'listings', label: 'Listings with match counts', roles: both, query: ListingsQuery, response: ListingsResponse, lane: 'Dashboard API – Reads' },
  listing: { method: 'GET', path: 'listing', label: 'One listing with matched buyers', roles: both, query: ListingQuery, response: ListingDetailResponse, lane: 'Dashboard API – Reads' },
  costs: { method: 'GET', path: 'costs', label: 'Monthly source costs', roles: owner, query: rangeQuery.extend({ include_test: boolStr.optional() }), response: CostsResponse, lane: 'Dashboard API – Reads' },
  config: { method: 'GET', path: 'config', label: 'Settings', roles: owner, query: emptyQuery, response: ConfigResponse, lane: 'Dashboard API – Reads' },
  errors: { method: 'GET', path: 'errors', label: 'Workflow errors', roles: owner, query: z.object({ page: z.coerce.number().int().min(1).optional(), include_test: boolStr.optional() }), response: ErrorsResponse, paginated: true, lane: 'Dashboard API – Reads' },

  addLead: { method: 'POST', path: 'lead', label: 'Add a lead', roles: both, body: AddLeadRequest, response: AddLeadResponse, lane: 'Dashboard API – Actions', sharedChain: 'Intake → Score | Lead To Process (normalise, dedupe, insert, score, assign, WhatsApp)' },
  updateStage: { method: 'POST', path: 'lead/stage', label: 'Update lead stage', roles: both, body: StageRequest, response: StageResponse, lane: 'Dashboard API – Actions', sharedChain: 'Agent | Valid Format? → Apply Command → calendar + visit reminder' },
  reassign: { method: 'POST', path: 'lead/reassign', label: 'Reassign lead', roles: owner, body: ReassignRequest, response: ReassignResponse, lane: 'Dashboard API – Actions', sharedChain: 'Watchdog | Build Reassign Fields → New Agent Alert / Old Agent Notice' },
  addNote: { method: 'POST', path: 'lead/note', label: 'Add a note', roles: both, body: NoteRequest, response: NoteResponse, lane: 'Dashboard API – Actions', sharedChain: 'Agent | Valid Format? → Apply Command (event_type = note)' },
  saveAgent: { method: 'POST', path: 'agent', label: 'Create / edit / deactivate agent', roles: owner, body: AgentRequest, response: AgentActionResponse, lane: 'Dashboard API – Actions' },
  saveListing: { method: 'POST', path: 'listing', label: 'Create / edit listing', roles: owner, body: ListingRequest, response: ListingActionResponse, lane: 'Dashboard API – Actions', sharedChain: 'Matcher | Load Config → Get Pending Listings → Match Buyers' },
  saveCost: { method: 'POST', path: 'cost', label: 'Enter monthly cost', roles: owner, body: CostRequest, response: CostActionResponse, lane: 'Dashboard API – Actions', sharedChain: 'Cost | Normalise Entry → Valid Entry? → Upsert Source Cost' },
  runTest: { method: 'POST', path: 'test', label: 'Run a test scenario', roles: owner, body: TestRequest, response: TestResponse, lane: 'Test Harness' },
} as const satisfies Record<string, EndpointDef>;

export type EndpointKey = keyof typeof endpoints;
export type EndpointQuery<K extends EndpointKey> = (typeof endpoints)[K] extends { query: infer Q extends z.ZodTypeAny } ? z.input<Q> : never;
export type EndpointBody<K extends EndpointKey> = (typeof endpoints)[K] extends { body: infer B extends z.ZodTypeAny } ? z.input<B> : never;
export type EndpointData<K extends EndpointKey> = z.infer<(typeof endpoints)[K]['response']>;
export const GET_ENDPOINTS = (Object.keys(endpoints) as EndpointKey[]).filter((k) => endpoints[k].method === 'GET');

/** Look up an endpoint by method + path (the allow-list check used by the proxy). */
export function findEndpoint(method: string, path: string): { key: EndpointKey; def: (typeof endpoints)[EndpointKey] } | null {
  const clean = path.replace(/^\/+|\/+$/g, '');
  for (const key of Object.keys(endpoints) as EndpointKey[]) {
    const def = endpoints[key];
    if (def.method === method.toUpperCase() && def.path === clean) return { key, def };
  }
  return null;
}

/* ------------------------------------------------------------------ pre-existing public webhooks (unchanged paths) */
export const legacyWebhooks = [
  { name: 'Website and CRM lead', method: 'POST', path: 'lead-intake', auth: 'Header Auth', fields: ['name|full_name', 'phone|mobile', 'email', 'source', 'source_detail|page', 'campaign|utm_campaign', 'budget|budget_min|budget_max', 'location|city', 'property_type', 'bhk', 'timeline', 'id|lead_id|submission_id'], responds: '{"message":"Workflow got started."} (responseMode onReceived)' },
  { name: 'Agent action (WhatsApp-style command)', method: 'POST', path: 'agent-action', auth: 'Header Auth', fields: ['from (agent phone)', 'text (CALLED|FOLLOWUP|NOTE|QUALIFY|VISIT|VISITED|NEGO|WON|LOST|JUNK|HELP <lead id> ...)', 'id'], responds: '{"message":"Workflow got started."}' },
  { name: 'Listing changed', method: 'POST', path: 'listing-changed', auth: 'Header Auth', fields: [], responds: '{"message":"Workflow got started."}' },
  { name: 'Referral and walk-in form', method: 'GET/POST', path: 'form/referral-walkin-lead', auth: 'Basic Auth', fields: ['Lead type', 'Name', 'Phone', 'Email', 'Budget minimum (INR)', 'Budget maximum (INR)', 'Preferred location', 'Property type', 'BHK', 'Timeline', 'Referred by or walk-in note'], responds: 'form success page' },
  { name: 'Monthly source cost form', method: 'GET/POST', path: 'form/source-cost-entry', auth: 'Basic Auth', fields: ['Source', 'Any date in the month', 'Amount (INR)'], responds: 'form success page' },
] as const;

/** WhatsApp commands an agent can send (shown on the System page). */
export const AGENT_COMMANDS = [
  { cmd: 'CALLED <id> [note]', does: 'Log that you called the lead. The first one stops the 2-hour clock.' },
  { cmd: 'FOLLOWUP <id> [note]', does: 'Log a follow-up touch.' },
  { cmd: 'NOTE <id> text', does: 'Add a note. A note does not count as contacting the buyer.' },
  { cmd: 'QUALIFY <id>', does: 'Mark the lead as qualified.' },
  { cmd: 'VISIT <id> 2026-11-02 11:00 [note]', does: 'Book a site visit (IST). Creates a calendar event and reminders.' },
  { cmd: 'VISITED <id>', does: 'The buyer came for the site visit.' },
  { cmd: 'NEGO <id>', does: 'Negotiation has started.' },
  { cmd: 'WON <id>', does: 'Deal closed.' },
  { cmd: 'LOST <id> reason', does: 'Lead lost. A reason is required.' },
  { cmd: 'JUNK <id>', does: 'Not a real enquiry (only before a visit).' },
  { cmd: 'HELP', does: 'Get this list on WhatsApp.' },
] as const;

/** Plain-language messages for the backend's apply_agent_command rejection reasons. */
export const REJECT_REASONS: Record<string, string> = {
  lead_not_found: 'That lead no longer exists.',
  not_your_lead: 'This lead is assigned to a different agent.',
  lead_closed: 'This lead is already closed. Only notes can be added.',
  visit_time_missing_or_past: 'Pick a visit time in the future.',
  junk_only_before_visit: 'A lead can only be marked junk before a site visit.',
  lost_reason_required: 'Say why the lead was lost.',
  invalid_transition: 'A lead cannot move backwards. Pick a later stage.',
};
