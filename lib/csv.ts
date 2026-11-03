import type { Lead } from '@contracts/realestate-api';
import { SOURCE_LABEL, STAGE_LABEL, TIMELINE_LABEL, PROPERTY_LABEL } from './format';

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function leadsToCsv(leads: Lead[]): string {
  const head = ['Lead ID', 'Name', 'Phone', 'Email', 'Source', 'Score', 'Stage', 'Agent', 'Budget min (INR)', 'Budget max (INR)', 'Area', 'Property type', 'BHK', 'Timeline', 'Created (UTC)', 'First response (min)', 'Last activity (UTC)', 'Repeat enquiries', 'Needs attention'];
  const rows = leads.map((l) => [
    l.id, l.name, l.phone, l.email, SOURCE_LABEL[l.source], l.score, STAGE_LABEL[l.stage], l.assigned_agent_name, l.budget_min, l.budget_max, l.location_pref,
    l.property_type ? PROPERTY_LABEL[l.property_type] : '', l.bhk, TIMELINE_LABEL[l.timeline], l.created_at, l.minutes_to_first_response, l.last_activity_at, l.repeat_count, l.is_stale ? 'yes' : 'no',
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}
