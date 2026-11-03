import { formatInTimeZone } from 'date-fns-tz';

export const IST = 'Asia/Kolkata';

/** ₹1,20,000 (full Indian grouping). */
export function inr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));
}

const trim = (n: number, d: number) => String(parseFloat(n.toFixed(d)));

/** ₹45L, ₹1.2Cr, ₹6,400 (short form for budgets and prices). */
export function inrShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${trim(n / 1e7, 2)}Cr`;
  if (a >= 1e5) return `₹${trim(n / 1e5, 1)}L`;
  return inr(n);
}

export function budgetRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Not given';
  if (min != null && max != null) return min === max ? inrShort(min) : `${inrShort(min)} – ${inrShort(max)}`;
  return max != null ? `up to ${inrShort(max)}` : `from ${inrShort(min)}`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${num(n, digits)}%`;
}

/** 12 min · 2h 05m · 1d 3h */
export function minutesHuman(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return '—';
  const r = Math.round(m);
  if (r < 1) return '<1 min';
  if (r < 60) return `${r} min`;
  if (r < 60 * 24) {
    const h = Math.floor(r / 60);
    const mm = r % 60;
    return mm ? `${h}h ${String(mm).padStart(2, '0')}m` : `${h}h`;
  }
  const d = Math.floor(r / 1440);
  const h = Math.floor((r % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** 2 Nov, 4:35 pm (IST) */
export function istTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatInTimeZone(new Date(iso), IST, 'd MMM, h:mm a').replace('AM', 'am').replace('PM', 'pm');
}
export function istDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatInTimeZone(new Date(iso), IST, 'd MMM yyyy');
}
export function istDay(iso: string): string {
  return formatInTimeZone(new Date(iso), IST, 'yyyy-MM-dd');
}
/** "5 min ago", "3h ago", "yesterday", else date */
export function timeAgo(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '—';
  const m = (now.getTime() - new Date(iso).getTime()) / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  if (m < 60 * 48) return 'yesterday';
  if (m < 60 * 24 * 14) return `${Math.floor(m / 1440)} days ago`;
  return istDateOnly(iso);
}

export function monthLabel(month: string): string {
  return formatInTimeZone(new Date(`${month.slice(0, 7)}-01T12:00:00Z`), 'UTC', 'MMM yyyy');
}

/** +91 98••• ••001 */
export function maskPhone(p: string | null | undefined): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '').slice(-10);
  if (d.length < 10) return '••••';
  return `+91 ${d.slice(0, 2)}••• ••${d.slice(-3)}`;
}
export function fullPhone(p: string | null | undefined): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '').slice(-10);
  if (d.length < 10) return p;
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}
export const telHref = (p: string) => `tel:+91${p.replace(/\D/g, '').slice(-10)}`;
export const waHref = (p: string, text?: string) =>
  `https://wa.me/91${p.replace(/\D/g, '').slice(-10)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

export const SOURCE_LABEL: Record<string, string> = {
  meta: 'Meta Ads',
  '99acres': '99acres',
  magicbricks: 'MagicBricks',
  website: 'Website',
  referral: 'Referral',
  walk_in: 'Walk-in',
  crm: 'CRM',
  other: 'Other',
};
export const STAGE_LABEL: Record<string, string> = {
  new: 'New',
  qualified: 'Qualified',
  site_visit_booked: 'Visit booked',
  visited: 'Visited',
  negotiation: 'Negotiation',
  closed_won: 'Closed – won',
  closed_lost: 'Closed – lost',
  junk: 'Junk',
};
export const SCORE_LABEL: Record<string, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };
export const PROPERTY_LABEL: Record<string, string> = { apartment: 'Apartment', villa: 'Villa', plot: 'Plot', commercial: 'Commercial', other: 'Other' };
export const TIMELINE_LABEL: Record<string, string> = {
  immediate: 'Immediately',
  within_1_month: 'Within 1 month',
  '1_3_months': '1–3 months',
  '3_6_months': '3–6 months',
  '6_plus_months': '6+ months',
  just_exploring: 'Just exploring',
  unknown: 'Not said',
};
export const EVENT_LABEL: Record<string, string> = {
  created: 'Lead captured',
  repeat_enquiry: 'Enquired again',
  scored: 'Scored',
  assigned: 'Assigned to agent',
  unassigned: 'No agent available',
  reassigned_stale: 'Auto-reassigned (no reply)',
  auto_response_sent: 'Instant WhatsApp sent to buyer',
  agent_alerted: 'Agent alerted on WhatsApp',
  sla_breached: 'Missed the 2-hour response target',
  owner_escalated: 'Owner alerted',
  stage_change: 'Stage changed',
  called: 'Agent called',
  followup_done: 'Follow-up done',
  note: 'Note',
  lead_reply: 'Buyer replied',
  visit_reminder_sent: 'Visit reminder sent',
  inactivity_nudge: 'Agent nudged: no activity',
  listing_matched: 'Matched to a listing',
  listing_response: 'Buyer answered a listing',
  command_rejected: 'Update rejected',
};
