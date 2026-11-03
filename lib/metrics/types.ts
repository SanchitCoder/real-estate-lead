import type { EventType, ListingStatus, PropertyType, Score, Source, Stage, Timeline } from '@contracts/realestate-api';

/** Raw records, shaped like the Postgres rows. Everything derived is computed from these. */
export interface RawAgent {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  round_robin_order: number;
  weight: number;
  max_open_leads: number;
  created_at: string;
}
export interface RawLead {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: Source;
  source_detail: string | null;
  campaign: string | null;
  budget_min: number | null;
  budget_max: number | null;
  location_pref: string | null;
  property_type: PropertyType | null;
  bhk: number | null;
  timeline: Timeline;
  score: Score | null;
  score_points: number | null;
  score_reason: string | null;
  priority: number;
  repeat_count: number;
  assigned_agent_id: number | null;
  assigned_at: string | null;
  reassign_count: number;
  stage: Stage;
  visit_at: string | null;
  lost_reason: string | null;
  created_at: string;
  first_response_at: string | null;
  first_response_agent_id: number | null;
  last_activity_at: string;
  is_stale: boolean;
  is_test: boolean;
}
export interface RawEvent {
  id: number;
  lead_id: number;
  agent_id: number | null;
  event_type: EventType;
  from_stage: Stage | null;
  to_stage: Stage | null;
  note: string | null;
  created_at: string;
}
export interface RawListing {
  id: number;
  title: string;
  project: string | null;
  location: string;
  property_type: PropertyType;
  bhk: number | null;
  price: number;
  status: ListingStatus;
  is_test: boolean;
  created_at: string;
}
export interface RawMatch {
  id: number;
  listing_id: number;
  lead_id: number;
  match_score: number;
  messaged_at: string | null;
  response: string | null;
  responded_at: string | null;
  interested: boolean | null;
  created_at: string;
}
export interface RawCost {
  id: number;
  source: Source;
  month: string; // YYYY-MM-01
  amount_inr: number;
  is_test: boolean;
}
export interface RawError {
  id: number;
  workflow: string;
  workflow_id: string | null;
  execution_id: string | null;
  node: string | null;
  error: string | null;
  payload: unknown;
  is_test: boolean;
  created_at: string;
}

/** Thresholds, exactly the keys of the backend `config` table. */
export interface Cfg {
  sla_first_response_min: number;
  escalate_owner_min: number;
  reassign_min: number;
  max_reassignments: number;
  stale_days_hot: number;
  stale_days_warm: number;
  stale_days_cold: number;
  match_tolerance_pct: number;
  match_threshold: number;
  match_hot_score: number;
  match_max_per_listing: number;
  match_weight_location: number;
  match_weight_property_type: number;
  match_weight_bhk: number;
  match_weight_budget: number;
  consider_cut_multiplier: number;
  visit_reminder_minutes: number;
}

export interface Dataset {
  agents: RawAgent[];
  leads: RawLead[];
  events: RawEvent[];
  listings: RawListing[];
  matches: RawMatch[];
  costs: RawCost[];
  errors: RawError[];
}

export interface Period {
  from: string; // YYYY-MM-DD (IST, inclusive)
  to: string; // YYYY-MM-DD (IST, inclusive)
}
